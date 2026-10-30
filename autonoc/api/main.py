"""
FastAPI layer.

THREE v1 bugs are structurally impossible here:

1. GET no longer mutates state. v1's `/api/delta` advanced the simulation as a
   side effect, so two browser tabs ran the sim at 2x speed and closing the
   browser stopped time entirely.

2. Time is owned by a server clock in a lifespan task, not by the request
   path. v1 moved the tick into the handler and called it an optimisation;
   the work did not disappear, it just landed on the client's latency path.

3. The legacy tick-cursor endpoint sends bounded full snapshots (resync=True).
   Physical changes, same-tick controls and warning flips reach every reader;
   no global dirty flags are consumed by GET requests.
"""
from __future__ import annotations

import asyncio
import copy
import json
import os
import re
import shutil
import threading
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from autonoc.engine import config as C
from autonoc.engine.engine import NOCEngine

from . import presentation as P
from . import schemas as S
from .run_history import RunSummaryStore
from . import wave_local
from .wave_ai import (
    WaveAIError,
    answer_question as answer_wave_question,
    build_context as build_wave_context,
    stream_answer as stream_wave_answer,
)
from .wave_ai import provider_status as wave_provider_status
from .sessions import (Session, SessionRegistry, SessionCapacityError,
                       COOKIE_NAME, requires_session, serves_shared)

BASE_TICK_SECONDS = 1.0
RUN_DAYS = 30
RUN_TICKS = C.TICKS_PER_DAY * RUN_DAYS

# Capacity defaults for the demo. Benchmarked on the deployment target: one
# engine.step() costs ~2 ms and eight live engines hold ~100 MB RSS, so the old
# limit of 8 was well below what a single shared vCPU can serve. The cap is a
# safety rail against runaway concurrency, not the hardware ceiling. Orphaned
# sessions (a visitor who lost their cookie) are reclaimed rather than locked
# out, and idle ones expire quickly, so raising the cap does not weaken the
# protection it was added for. See docs/archive/SESSION_CAPACITY_FIX.md.
DEFAULT_MAX_SESSIONS = 16
DEFAULT_SESSION_IDLE_SECONDS = 180.0
# A dashboard silent for this long may have its slot handed to a new visitor.
DEFAULT_SESSION_RECLAIM_GRACE = 15.0

# Sent by the dashboard when it is retrying after a capacity refusal. A waiting
# visitor must always end up with a working dashboard, so such a request may
# adopt the least recently seen session instead of being refused again.
RETRY_HEADER = "x-autonoc-retry"
SESSION_HEADER = "x-autonoc-session"


def _env_int(name: str, default: int) -> int:
    try:
        return int(str(os.environ.get(name, default)).strip())
    except (TypeError, ValueError):
        return default


def _env_float(name: str, default: float) -> float:
    try:
        return float(str(os.environ.get(name, default)).strip())
    except (TypeError, ValueError):
        return default


# M8 — demo support. The "Storm over Goizha" demo runs a cast seed:
#   $env:AUTONOC_SEED=131; python -m uvicorn autonoc.api.main:app
# AUTONOC_AI=1 auto-enables the Commander at boot for a hands-free demo.
_DEFAULT_SEED = int(os.environ.get("AUTONOC_SEED", "42"))
_DEFAULT_AI = os.environ.get("AUTONOC_AI", "0") == "1"
_DEFAULT_AUTO_APPROVE = float(os.environ.get("AUTONOC_AUTO_APPROVE", "0"))

engine = NOCEngine(seed=_DEFAULT_SEED, ai_enabled=_DEFAULT_AI,
                   horizon=RUN_TICKS)
_lock = threading.Lock()
_speed = 1.0
_slow_ticks = 0

# M6 — live inference worker. Created in lifespan (needs the engine + lock);
# None until then so module import never starts threads.
worker = None

# The identifier changes on every successful Day 30 reset and on process
# start. Every browser control is bound to the identifier it was rendered for.
_run_id = uuid.uuid4().hex
_reset_notice = False
_run_error: str | None = None
_history = P.History()
_history.reset(engine)
_summary_store = RunSummaryStore()

# Session registry is deliberately process-local: Fly runs one shared-CPU
# machine and live state is not checkpointed. Requests are activated one at a
# time while rendering, so the legacy API implementation remains small while
# each session retains its own engine, lock, history, controls and worker.
_dispatch_lock = threading.RLock()
# Serialises every activation of a session. A threading lock is re-entrant on the
# event-loop thread, so two tasks could interleave across awaits and read or step
# each other's engine. This asyncio lock is held across the awaits instead.
#
# An asyncio.Lock binds itself to the loop that first has to wait on it. One
# server process has exactly one loop, so the gate is (re)created in lifespan —
# a lock inherited from a finished loop (the next test client, an embedded
# runner) can then never be handed to a new one.
_gate = asyncio.Lock()
# A simulation step takes ~2 ms. If one ever stalls, release the shared gate after this
# long so every other request is not held behind it.
STEP_TIMEOUT_S = 30.0
_registry: SessionRegistry | None = None
_shared_bundle = None

# ------------------------------------------------------- warm engine pool
# ``NOCEngine()`` costs ~640 ms of pure CPU (300 sites, 30 days of timelines) and
# holds ~10 MB. Building it inside a request blocked the event loop, so a single
# new visitor stalled every other dashboard — health probes included — and three
# new visitors served one at a time. Worlds are therefore built ahead of time by
# a background thread and handed over at tick 0. A pooled world is identical to a
# fresh one: same seed, never stepped, never registered, never owned by anyone.
_WARM_ENGINES = _env_int("AUTONOC_WARM_ENGINES", 3)
_pool: list = []
_pool_lock = threading.Lock()
_pool_building = False
# Visitors that had to build their own world because the pool was empty. The
# refill thread yields to them: a visitor's first page load matters more than a
# spare engine.
_cold_claims = 0
_cold_lock = threading.Lock()


def _build_engine():
    """One deterministic tick-0 world, identical for every visitor."""
    return NOCEngine(seed=_DEFAULT_SEED, ai_enabled=_DEFAULT_AI, horizon=RUN_TICKS)


def _take_warm_engine():
    """Hand out a pre-built world (or None) and top the pool back up."""
    with _pool_lock:
        warm = _pool.pop() if _pool else None
    _refill_pool()
    return warm


def _refill_pool() -> None:
    """Build toward ``_WARM_ENGINES`` in one background thread.

    Never called from a request path and never blocks: a burst that empties the
    pool waits for the old cold build, not for the refill.
    """
    global _pool_building
    with _pool_lock:
        if _pool_building or len(_pool) >= _WARM_ENGINES:
            return
        _pool_building = True

    def build():
        global _pool_building
        try:
            while True:
                with _pool_lock:
                    if len(_pool) >= _WARM_ENGINES:
                        return
                with _cold_lock:
                    busy = _cold_claims > 0
                if busy:
                    # A visitor is building right now; one world at a time on one
                    # vCPU, and the visitor goes first.
                    time.sleep(0.05)
                    continue
                fresh = _build_engine()
                with _pool_lock:
                    if len(_pool) >= _WARM_ENGINES:
                        return
                    _pool.append(fresh)
                # Give the loop and any visitor a turn before the next build.
                time.sleep(0.25)
        finally:
            with _pool_lock:
                _pool_building = False

    threading.Thread(target=build, name="warm-engine", daemon=True).start()


def _make_session(token: str) -> Session:
    global _cold_claims
    e = _take_warm_engine()
    if e is None:
        # Pool empty (a burst): build this visitor's world here. The refill thread
        # backs off while this is happening.
        with _cold_lock:
            _cold_claims += 1
        try:
            e = _build_engine()
        finally:
            with _cold_lock:
                _cold_claims -= 1
    h = P.History(); h.reset(e)
    # Completed summaries remain durable, but each cookie gets its own small
    # SQLite namespace; live engine state is never checkpointed or restored.
    summary_root = Path(os.environ.get("AUTONOC_DATA_DIR", "./data")) / "sessions" / token
    session = Session(token, e, threading.Lock(), 1.0, h, uuid.uuid4().hex,
                      summary_store=RunSummaryStore(summary_root),
                      data_dir=str(summary_root))
    from autonoc.ai.serve import InferenceWorker
    session.worker = InferenceWorker(e, session.lock,
        auto_approve_seconds=_DEFAULT_AUTO_APPROVE,
        run_id=session.run_id, bundle=_shared_bundle)
    session.worker.start()
    return session


def _claim_session(token: str | None, retrying: bool) -> tuple[Session, bool]:
    """Resolve (or create) this request's session — always off the event loop.

    A cold claim builds a whole world. Running that on the loop made every other
    request wait behind it, so a burst of new visitors looked like a dashboard
    stall. The registry itself is thread-safe, so the claim runs in a worker
    thread while the loop keeps answering.
    """
    return (_registry.get_or_default(token) if retrying
            else _registry.get(token))


def _drop_session_assets(session: Session) -> None:
    """Release the disk a retired session owned.

    Every reclaim creates a fresh token, so without this the per-session
    summary directories would accumulate on the 1 GB Fly volume for as long as
    the demo runs. Best-effort: a failure here must never affect capacity.
    """
    if session.data_dir:
        shutil.rmtree(session.data_dir, ignore_errors=True)


def _shared_session() -> Session:
    """A detached session that fronts the shared default engine.

    Session-free paths (``/api/health``, HTML, static assets) are answered from
    the module-level engine. This object is never registered, so such requests
    can never occupy, leak or exhaust a browser slot.
    """
    with _dispatch_lock:
        return Session(
            token="__shared__", engine=engine, lock=_lock, speed=_speed,
            history=_history, run_id=_run_id, reset_notice=_reset_notice,
            run_error=_run_error, worker=worker, summary_store=_summary_store,
            slow_ticks=_slow_ticks,
        )


async def _serve_shared(request: Request, call_next):
    """Answer this request from the shared default engine, in no session.

    Used for traffic that cannot hold a cookie (probes, crawlers, assets) and for
    token-less read-only API reads. Nothing here is registered, so such a request
    can never occupy, leak or exhaust a browser slot — and never builds an engine.
    """
    async with _gate:         # one session active at a time
        session = _shared_session()
        _activate(session)
        try:
            return await call_next(request)
        finally:
            _deactivate(session)


def _cookie_secure(request: Request) -> bool:
    """Whether the session cookie carries the ``Secure`` flag.

    "auto" (the default) follows the request, so the flag is on wherever TLS
    terminates — including behind Fly's proxy header — and local http previews
    keep working. ``AUTONOC_COOKIE_SECURE=1`` or ``=0`` forces it.
    """
    mode = os.environ.get("AUTONOC_COOKIE_SECURE", "auto").strip().lower()
    if mode in {"0", "false", "no", "off"}:
        return False
    if mode in {"1", "true", "yes", "on"}:
        return True
    forwarded = request.headers.get("x-forwarded-proto", "").split(",")[0].strip()
    return (forwarded or request.url.scheme) == "https"


def _attach_session_cookie(response, request: Request, session: Session, created: bool) -> None:
    if not created:
        return
    response.headers[SESSION_HEADER] = session.token
    # The console is often embedded cross-site (the preview frame), and a
    # SameSite=Lax cookie is then never sent back. Over HTTPS use None; Secure.
    secure = _cookie_secure(request)
    response.set_cookie(
        COOKIE_NAME,
        session.token,
        httponly=True,
        samesite="none" if secure else "lax",
        secure=secure,
        max_age=int(_registry.idle_timeout) if _registry else 180,
    )


def _activate(s: Session) -> None:
    global engine, _lock, _speed, _slow_ticks, _run_id, _reset_notice, _run_error, _history, _summary_store, worker
    engine, _lock, _speed, _slow_ticks = s.engine, s.lock, s.speed, s.slow_ticks
    _run_id, _reset_notice, _run_error, _history, worker = s.run_id, s.reset_notice, s.run_error, s.history, s.worker
    _summary_store = s.summary_store or _summary_store

def _deactivate(s: Session) -> None:
    s.engine, s.speed, s.slow_ticks = engine, _speed, _slow_ticks
    s.run_id, s.reset_notice, s.run_error, s.history, s.worker = _run_id, _reset_notice, _run_error, _history, worker
    s.summary_store = _summary_store



def _assert_current_run(run_id: str) -> None:
    """Reject commands created against a world that has already been reset."""
    if run_id != _run_id:
        raise HTTPException(
            status_code=409,
            detail="This control belongs to an earlier demo. Refresh the dashboard and try again.",
        )


def _run_summary(source) -> dict:
    """Capture aggregate results only; no simulation state is checkpointed."""
    kpis = source.kpis()
    ai = source.ai_payload()
    return {
        "completed_at": datetime.now(timezone.utc).isoformat(timespec="microseconds").replace("+00:00", "Z"),
        "simulated_days": RUN_DAYS,
        "completed_sim_time": source.sim_time,
        "seed": source.seed,
        "availability": kpis["availability"],
        "injected": kpis["injected"],
        "masked": kpis["masked"],
        "repairs": kpis["repairs"],
        "mttr_min": kpis["mttr_min"],
        "ats_failures": kpis["ats_failures"],
        "fuel_thefts": kpis["fuel_thefts"],
        "active_incidents": len(P.incidents(source)),
        "ai_enabled": bool(source.ai_enabled),
        "ai_mode": source.ai_mode,
        "pre_empted": int(ai["pre_empted"]),
        "acted_upon": int(ai["acted_upon"]),
        "false_dispatches": int(ai["false_dispatches"]),
        "crew_hours_saved": float(ai["crew_hours_saved"]),
        "precision": ai["precision"],
    }


def _new_engine_like(source, paused: bool):
    """Build the next deterministic world without mutating the current one."""
    fresh = NOCEngine(
        seed=source.seed,
        ai_enabled=source.ai_enabled,
        horizon=source.horizon,
    )
    fresh.ai_policy = source.ai_policy
    fresh.ai_mode = source.ai_mode
    fresh.paused = paused
    return fresh


def _reset_completed_run_locked() -> bool:
    """Atomically persist the summary and replace a completed world.

    The caller owns `_lock`. Candidate initialization and durable summary save
    both happen before publishing the candidate. Any exception leaves the
    completed world untouched except that it is paused and reports the error.
    """
    global engine, _run_id, _reset_notice, _run_error
    previous = engine
    previous_run_id = _run_id
    keep_paused = previous.paused
    try:
        summary = _run_summary(previous)
        candidate = _new_engine_like(previous, paused=keep_paused)
        candidate_initial_sample = P.sample(candidate)
        _summary_store.save(previous_run_id, summary)
        next_run_id = uuid.uuid4().hex
    except Exception as exc:
        previous.paused = True
        detail = str(exc).strip() or type(exc).__name__
        _run_error = (
            "Demo restart failed. The completed world was preserved and paused. "
            f"{detail[:300]}"
        )
        return False

    # The worker snapshots the engine and run id together under the same lock;
    # results produced from the previous world are rejected when it resumes.
    if worker is not None:
        worker.replace_engine(candidate, next_run_id)
    engine = candidate
    _run_id = next_run_id
    _history.reset(candidate, candidate_initial_sample)
    _reset_notice = True
    _run_error = None
    return True


def _step_locked(automatic: bool = True, expected_run_id: str | None = None) -> dict:
    """Advance one server tick, or safely complete/reset at the run boundary."""
    global _slow_ticks
    t0 = time.perf_counter()
    with _lock:
        if expected_run_id is not None:
            _assert_current_run(expected_run_id)
        if automatic and engine.paused:
            return {"advanced": False, "tick": engine.tick, "run_id": _run_id}
        if not automatic and not engine.paused:
            raise HTTPException(status_code=409, detail="Pause the simulation before stepping.")

        # tick 8639 is D30 23:55. The next 5-minute transition would display
        # Day 31, so complete the 30-day summary and reset instead of exposing
        # a Day 31 frame. A paused/manual step takes this same path and stays
        # paused in the new world.
        if engine.tick >= engine.horizon - 1:
            reset = _reset_completed_run_locked()
            result = {
                "advanced": False,
                "reset": reset,
                "tick": engine.tick,
                "run_id": _run_id,
                "paused": engine.paused,
                "error": _run_error,
            }
        else:
            engine.step()
            _history.record(engine)
            result = {"advanced": True, "tick": engine.tick, "run_id": _run_id}

    dt = (time.perf_counter() - t0) * 1000
    if dt > 100.0:
        _slow_ticks += 1
    return result


async def simulation_loop() -> None:
    """Advance every active browser session on its own clock.

    Each session keeps its own deadline, set from its own speed, so one visitor
    at 10x does not speed up another visitor's simulation. A session that falls
    behind is stepped once and rescheduled from now rather than replaying missed
    ticks, so the clock never bursts. A single short poll keeps the loop cheap
    with many sessions; a session is only stepped when its own deadline has passed.
    """
    due: dict[str, float] = {}
    poll = 0.02
    while True:
        try:
            with _dispatch_lock:
                sessions = list(_registry._sessions.values()) if _registry else []
            now = time.monotonic()
            live = set()
            for session in sessions:
                live.add(session.token)
                deadline = due.get(session.token, now)
                if now < deadline:
                    continue
                if _registry is not None and not _registry.holds(session):
                    continue        # reclaimed while this cycle was running
                interval = BASE_TICK_SECONDS / max(session.speed, 0.1)
                async with _gate:
                    _activate(session)
                    try:
                        await asyncio.wait_for(asyncio.to_thread(_step_locked, True), STEP_TIMEOUT_S)
                    finally:
                        _deactivate(session)
                # Normally the next deadline is one interval after this one. If the
                # session fell behind by more than that, restart its cadence a full
                # interval from now instead of stepping again straight away.
                next_due = deadline + interval
                after = time.monotonic()
                due[session.token] = next_due if next_due > after else after + interval
            if not sessions:
                # No registry (unit tests, teardown): legacy single-engine clock.
                deadline = due.get("__legacy__", now)
                if now >= deadline:
                    async with _gate:
                        await asyncio.wait_for(asyncio.to_thread(_step_locked, True), STEP_TIMEOUT_S)
                    legacy_interval = BASE_TICK_SECONDS / max(_speed, 0.1)
                    next_due = deadline + legacy_interval
                    after = time.monotonic()
                    due["__legacy__"] = next_due if next_due > after else after + legacy_interval
            for token in list(due):
                if token not in live and token != "__legacy__":
                    del due[token]
        except asyncio.CancelledError:
            raise
        except Exception:
            import traceback; traceback.print_exc()
        await asyncio.sleep(poll)


@asynccontextmanager
async def lifespan(app: FastAPI):
    global worker, _registry, _shared_bundle, _gate
    _gate = asyncio.Lock()          # belongs to this loop (see _gate above)
    from autonoc.ai.serve import ModelBundle
    # Models load in the background so the port opens at once. Sessions created
    # before they finish share this object and pick the models up as they arrive.
    _shared_bundle = ModelBundle(load=False)
    threading.Thread(target=_shared_bundle.load, name="model-load", daemon=True).start()
    _registry = SessionRegistry(
        _make_session,
        max_sessions=max(1, _env_int("AUTONOC_MAX_SESSIONS", DEFAULT_MAX_SESSIONS)),
        idle_timeout=_env_float("AUTONOC_SESSION_IDLE_SECONDS",
                                DEFAULT_SESSION_IDLE_SECONDS),
        reclaim_grace=_env_float("AUTONOC_SESSION_RECLAIM_GRACE",
                                 DEFAULT_SESSION_RECLAIM_GRACE),
        reclaim=os.environ.get("AUTONOC_SESSION_RECLAIM", "1").strip().lower()
        not in {"0", "false", "no", "off"},
        on_drop=_drop_session_assets)
    # Build the first spare worlds while the machine has nothing else to do, so
    # the first visitors after a deploy are not the cold ones.
    _refill_pool()
    task = asyncio.create_task(simulation_loop())
    yield
    _registry.clear()
    _registry = None
    _shared_bundle = None
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass


app = FastAPI(title="SuliNOC", version="3.0", lifespan=lifespan)
app.add_middleware(GZipMiddleware, minimum_size=1000)
# Same-origin only by default: the dashboard is served by this app (and the
# Vite dev server proxies /api), so cross-origin browser access is not a
# supported surface. Cookies are session-scoped (samesite=lax); do not widen
# this without also revisiting session/auth. AUTONOC_ALLOWED_ORIGINS is a
# comma-separated escape hatch for deliberate cross-origin deployments.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in
                   os.environ.get("AUTONOC_ALLOWED_ORIGINS", "").split(",")
                   if o.strip()],
    allow_methods=["*"],
    allow_headers=["*"],
)


_FINGERPRINTED_ASSET = re.compile(r"-[A-Za-z0-9_-]{8}[.][A-Za-z0-9]+$")


def _cache_control_for_path(path: str) -> str:
    if path.startswith("/assets/"):
        filename = Path(path).name
        if filename.lower().endswith(".html"):
            return "no-store"
        if _FINGERPRINTED_ASSET.search(filename):
            return "public, max-age=31536000, immutable"
        return "no-cache, max-age=0, must-revalidate"
    if path.startswith("/static/"):
        return "no-cache, max-age=0, must-revalidate"
    return "no-store"


@app.middleware("http")
async def no_cache_dashboard(request, call_next):
    """Keep entry points fresh and cache only content-fingerprinted assets.

    The old blanket immutable rule for ``/assets/`` also covered stable names
    such as ``hero-source.html``. Safari can keep those responses for a year,
    so a deployment could not replace the welcome page on an existing device.
    HTML and unversioned assets must revalidate; only Vite's fingerprinted
    output is safe to cache immutably.
    """
    response = await call_next(request)
    response.headers["Cache-Control"] = _cache_control_for_path(request.url.path)
    return response


@app.middleware("http")
async def browser_session(request: Request, call_next):
    """Bind this request to its server-issued high-entropy session cookie.

    Session-free traffic is served by the shared default engine. Health probes,
    crawlers and asset requests cannot keep a cookie, so counting them against
    dashboard capacity let a single uptime monitor fill the demo — that was the
    root cause of the "at capacity" lockout. They are also the payload for this
    documented failure:
    ``{"detail": "SuliNOC is at capacity …", "code": "session_capacity"}``.
    """
    if _registry is None:
        return await call_next(request)

    if not requires_session(request.url.path):
        return await _serve_shared(request, call_next)

    # Prefer the cookie; fall back to the session header that the console keeps
    # in sessionStorage. Some embedded previews drop cross-site cookies even with
    # SameSite=None, and a header always arrives.
    token = request.cookies.get(COOKIE_NAME) or request.headers.get(SESSION_HEADER)
    retrying = request.headers.get(RETRY_HEADER, "").strip().lower() in {
        "1", "true", "yes", "on"}

    # Look the token up without creating anything. A crawler, an uptime probe or
    # a reader with a stale token asks for a read-only endpoint: answering that
    # from the shared engine costs milliseconds instead of building a private
    # engine (~700 ms) that is abandoned on the next request. The dashboard claims
    # its own run through POST /api/session before it polls.
    session = _registry.peek(token)
    created = False
    if session is None and serves_shared(request.url.path, request.method):
        return await _serve_shared(request, call_next)

    try:
        # A retrying dashboard is a visitor who is demonstrably waiting, so it
        # may adopt the oldest session; a first-time request only takes a slot
        # that has been idle past the grace window.
        if session is None:
            session, created = await asyncio.to_thread(_claim_session, token, retrying)
    except SessionCapacityError as exc:
        # Only reachable when every slot is genuinely in use and reclaiming is
        # disabled. Retry-After tells clients (and the dashboard) to back off
        # instead of hammering a full demo.
        return JSONResponse(
            {"detail": str(exc), "code": "session_capacity"},
            status_code=503,
            headers={
                "Retry-After": str(max(1, int(round(exc.retry_after)))),
                "Cache-Control": "no-store",
            },
        )
    request.state.session_token = session.token

    if request.url.path in ("/api/wave/chat", "/api/wave/chat/stream"):
        # Wave needs the same session-aware state as /api/delta, but its provider
        # request can take seconds. Capture an immutable snapshot while this
        # session is active, then release BOTH the session gate and engine lock
        # before call_next reaches OpenAI so polling and controls keep flowing.
        async with _gate:
            _activate(session)
            try:
                with _lock:
                    request.state.wave_snapshot = copy.deepcopy(_snapshot(resync=True))
            finally:
                _deactivate(session)

        response = await call_next(request)
        _attach_session_cookie(response, request, session, created)
        return response

    async with _gate:
        _activate(session)
        try:
            response = await call_next(request)
            _attach_session_cookie(response, request, session, created)
            return response
        finally:
            _deactivate(session)

# ------------------------------------------------------------------ Wave AI
def _wave_local_result(
    error: WaveAIError,
    question: str,
    snapshot: dict,
    *,
    run_restarted: bool = False,
) -> dict | None:
    """Degrade to Wave's deterministic snapshot reader, or None to fail hard.

    A missing key, a rejected key, a provider timeout or a rate-limited demo
    are conditions no visitor can fix. Wave answers those from the captured
    snapshot instead of going silent; genuine abuse controls (429) and the
    context-size guard still fail with their proper status.
    """
    if error.code not in wave_local.RECOVERABLE_CODES:
        return None
    answer = wave_local.answer(
        question, build_wave_context(snapshot, question), code=error.code
    )
    return {
        "answer": answer[: S.WAVE_ANSWER_MAX_CHARS],
        "provider": "local",
        "model": "wave-local-fallback",
        "ai_connected": False,
        "tick": snapshot.get("tick"),
        "sim_time": (snapshot.get("kpis") or {}).get("sim_time"),
        "run_id": snapshot.get("run_id"),
        "run_restarted": run_restarted,
    }


def _request_snapshot(request: Request) -> dict:
    snapshot = getattr(request.state, "wave_snapshot", None)
    if snapshot is None:
        # Useful for direct unit tests and deployments that call the route
        # without the lifespan registry; normal dashboard traffic takes the
        # session-aware middleware branch.
        with _lock:
            snapshot = copy.deepcopy(_snapshot(resync=True))
    return snapshot


def _wave_history(payload: S.WaveChatRequest) -> list[dict[str, str]]:
    return [{"role": turn.role, "content": turn.content} for turn in payload.history]


def _sse_response(events) -> StreamingResponse:
    async def sse():
        async for kind, value in events:
            if kind == "delta":
                yield (f"event: delta\ndata: "
                       f"{json.dumps({'text': value}, ensure_ascii=False)}\n\n")
            elif kind == "error":
                yield ("event: error\ndata: "
                       f"{json.dumps({'code': value.code, 'detail': value.detail}, ensure_ascii=False)}\n\n")
                return
            elif kind == "done":
                yield (f"event: done\ndata: "
                       f"{json.dumps(value, ensure_ascii=False)}\n\n")

    return StreamingResponse(
        sse(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"},
    )


@app.get("/api/wave/status")
async def wave_status():
    """Expose safe setup/verification state, never a provider credential."""
    return wave_provider_status()


@app.post("/api/wave/chat", response_model=S.WaveChatResponse)
async def wave_chat(payload: S.WaveChatRequest, request: Request):
    """Read-only generative chat grounded in this browser's current run.

    The session middleware snapshots the selected session under its gate, then
    releases it before this handler makes any provider request. The assistant
    never receives engine objects or control tools.
    """
    snapshot = _request_snapshot(request)
    # A Day-30 rollover between the browser's poll and this question is not an
    # error worth losing the answer over: answer from the live run and tell the
    # browser the world moved underneath it.
    run_restarted = payload.run_id != snapshot.get("run_id")

    try:
        result = await answer_wave_question(
            payload.question,
            snapshot,
            session_id=getattr(request.state, "session_token", "__shared__"),
            history=_wave_history(payload),
        )
    except WaveAIError as exc:
        result = _wave_local_result(
            exc, payload.question, snapshot, run_restarted=run_restarted
        )
        if result is None:
            return JSONResponse(
                status_code=exc.status_code,
                content={"code": exc.code, "detail": exc.detail},
                headers=exc.headers,
            )
    return S.WaveChatResponse(**{**result, "run_restarted": run_restarted})


@app.post("/api/wave/chat/stream")
async def wave_chat_stream(payload: S.WaveChatRequest, request: Request):
    """Server-sent-events variant of /api/wave/chat: the provider's answer
    streams to the browser as `delta` events, ending with one `done` event
    carrying the same metadata as the JSON reply.

    Pre-flight failures that Wave can absorb (missing key, provider outage)
    become a local answer streamed the same way. Anything it cannot absorb —
    our own rate limits, an oversized context — keeps its proper HTTP status
    before the stream starts, and a failure after the stream has started
    becomes an in-stream `error` event.
    """
    snapshot = _request_snapshot(request)
    run_restarted = payload.run_id != snapshot.get("run_id")

    try:
        events = await stream_wave_answer(
            payload.question,
            snapshot,
            session_id=getattr(request.state, "session_token", "__shared__"),
            history=_wave_history(payload),
        )
    except WaveAIError as exc:
        fallback = _wave_local_result(
            exc, payload.question, snapshot, run_restarted=run_restarted
        )
        if fallback is None:
            return JSONResponse(
                status_code=exc.status_code,
                content={"code": exc.code, "detail": exc.detail},
                headers=exc.headers,
            )

        async def local_events():
            yield ("delta", fallback["answer"])
            yield ("done", fallback)

        return _sse_response(local_events())

    async def absorbed_events():
        """Relay provider events, absorbing a mid-answer provider failure."""
        answer_chars = 0
        async for kind, value in events:
            if kind == "delta":
                answer_chars += len(value)
                yield (kind, value)
            elif kind == "error":
                fallback = (
                    _wave_local_result(
                        value,
                        payload.question,
                        snapshot,
                        run_restarted=run_restarted,
                    )
                    if answer_chars == 0
                    else None
                )
                if fallback is None:
                    yield (kind, value)
                    return
                yield ("delta", fallback["answer"])
                yield ("done", fallback)
                return
            else:
                yield (kind, {**value, "run_restarted": run_restarted})

    return _sse_response(absorbed_events())


# ----------------------------------------------------------------- session
@app.post("/api/session", response_model=S.SessionStartResponse)
async def start_session():
    """Explicit handshake: bind this browser tab to its own simulation run.

    Read-only GETs without a session are answered from the shared engine, so a
    dashboard announces itself once per page load before polling. The middleware
    has already created (or reused) this request's session and attached both the
    cookie and the ``x-autonoc-session`` header, so the body only names the run.
    """
    with _lock:
        return S.SessionStartResponse(run_id=_run_id, tick=engine.tick)


# ------------------------------------------------------------------ config
@app.get("/api/config", response_model=S.ConfigResponse)
async def get_config():
    """Everything the frontend needs to render. It hard-codes none of it."""
    return S.ConfigResponse(
        status_names=C.STATUS_NAMES,
        status_colors=C.STATUS_COLORS,
        thresholds={
            "rsrp": C.THRESH_RSRP, "s11": C.THRESH_S11,
            "s11_high_wind": C.THRESH_S11_HIGH_WIND, "temp": C.THRESH_TEMP,
            "packet_loss": C.THRESH_PACKET_LOSS, "cpu": C.THRESH_CPU,
        },
        metric_labels=dict(C.METRIC_LABELS),
        gauges={k: dict(v) for k, v in C.GAUGE_SPECS.items()},
        x733_severity=dict(C.X733_SEVERITY),
        power_configs=dict(C.POWER_CONFIG_NAMES),
        vswr_alarm=C.VSWR_ALARM_THRESHOLD,
        rapp_roles=dict(C.RAPP_ROLES),
        map_center=[(C.LAT_MIN + C.LAT_MAX) / 2, (C.LON_MIN + C.LON_MAX) / 2],
        map_zoom=12,
        bounds={"lat_min": C.LAT_MIN, "lat_max": C.LAT_MAX,
                "lon_min": C.LON_MIN, "lon_max": C.LON_MAX},
        core={
            "name": C.CORE_NAME,
            "place": C.CORE_PLACE,
            "lat": C.CORE_LAT,
            "lon": C.CORE_LON,
            "status_label": "Operational · simulated EPC",
            "epc": [{"id": el[0], "name": el[1]} for el in C.CORE_EPC],
            "clusters": [
                {
                    "id": cid,
                    "name": C.CLUSTER_NAMES[cid - 1],
                    "rings": sorted(r for r, c in C.RING_CLUSTERS.items()
                                    if c == cid),
                    # sites inherit their cluster from their ring, so count
                    # by ring membership, not by district placement
                    "sites": sum(1 for n in engine.net.nodes
                                 if n.cluster == cid),
                }
                for cid in (1, 2, 3)
            ],
        },
        depot={"lat": C.DEPOT_LAT, "lon": C.DEPOT_LON},
        agg_sites=[{"id": s[0], "name": s[1], "lat": s[2], "lon": s[3],
                    "cluster": C.RING_CLUSTERS[s[0]],
                    "nodes": len(engine.net.agg_sites[s[0]].node_ids), "clutter": s[5], "color": s[6]}
                   for s in C.AGG_SITES],
        num_nodes=C.NUM_NODES,
        num_teams=C.NUM_TEAMS,
        tick_minutes=C.TICK_MINUTES,
        break_even_precision=round(C.BREAK_EVEN_PRECISION, 4),
        presentation=P.config_payload(),
    )


# ------------------------------------------------------------------ data
def _agg_payload() -> list[dict]:
    out = []
    w_now = engine.weather_timeline[min(engine.tick, engine.horizon - 1)]
    for site in engine.net.agg_sites:
        nodes = [engine.net.by_id[i] for i in site.node_ids]
        ok = sum(1 for n in nodes if n.status == C.STATUS_HEALTHY)
        w = w_now[site.agg_id]
        out.append({
            "id": site.agg_id, "name": site.name, "lat": site.lat,
            "lon": site.lon, "color": site.color,
            "cluster": C.RING_CLUSTERS[site.agg_id],
            "node_count": len(nodes),
            "health": round(ok / len(nodes) * 100.0, 1) if nodes else 100.0,
            "weather": w["type"], "wind": round(w["wind"], 1),
            "clutter": site.clutter_c,
            # every node in a district shares its grid tier, so the site
            # power architecture (A/B/C) is a district-level label
            "pwr": C.POWER_CONFIG_BY_TIER[C.GRID_TIER[site.agg_id]],
        })
    return out


def _node_dicts(only_changed_since: int | None = None) -> list[dict]:
    """Complete current node readouts, independent of who polled before us.

    Physical telemetry changes each tick without last_changed_tick updates.
    For 300 nodes, bounded snapshots are safer than a lossy dirty-flag delta.
    This also delivers warning flips and controls performed while paused.
    """
    out = []
    for n in engine.nodes:
        v = engine.ai_verdicts.get(n.node_id) if engine.ai_enabled else None
        warn = bool(v and n.status == C.STATUS_HEALTHY
                    and float(v.get("p_fail", 0.0)) > C.BREAK_EVEN_PRECISION)
        out.append({**n.to_dict(), "warn": warn})
    return out


def _ring_payload() -> list[dict]:
    out = []
    for ring in engine.net.rings:
        path = [[s.from_lat, s.from_lon] for s in ring.segments]
        if ring.segments:
            path.append([ring.segments[-1].to_lat, ring.segments[-1].to_lon])
        cut = None
        if ring.cuts:
            c = ring.cuts[0]
            cut = {"lat": c.lat, "lon": c.lon, "seg": c.segment.seg_id,
                   "cause": c.cause}
        out.append({"id": ring.ring_id, "cluster": ring.cluster,
                    "node_count": len(ring.node_ids), "path": path,
                    "circumference_km": round(ring.circumference_km, 2),
                    "cut": cut, "isolated": ring.is_isolated,
                    "cuts": [{"lat": c.lat, "lon": c.lon,
                              "seg": c.segment.seg_id, "cause": c.cause,
                              "path": [[c.segment.from_lat, c.segment.from_lon],
                                       [c.segment.to_lat, c.segment.to_lon]]}
                             for c in ring.cuts]})
    return out


def _ai_payload() -> dict:
    """M6 — Commander panel, enriched with live auto-approve countdowns."""
    p = engine.ai_payload()
    if worker is not None:
        p["pending"] = [{**a, "eta": worker.eta_for(a["action_id"])}
                        for a in p["pending"]]
    return p


def _dashboard_payload() -> dict:
    """Dashboard block with only the newest history sample on the wire.

    The sample rows are ~0.18 KB each and the client already receives one every
    second, so it keeps its own rolling window (30 samples, same length as
    before) and appends locally. Nothing is approximated: every row is a real
    engine sample that arrived in an earlier frame.
    """
    payload = P.dashboard(engine, _history)
    payload["history"] = payload["history"][-1:]
    return payload


def _snapshot(resync: bool) -> dict:
    """The 1 Hz wire frame.

    WIRE CHANGE (2026-10-30, same numbers everywhere else): this frame no longer
    carries ``logs`` (GET /api/activity, fetched when the Activity dialog opens),
    each ring's ``nodes`` id list (only its length was read → ``node_count``), or
    more than the newest ``dashboard.history`` sample (the dashboard appends its
    own rolling window). A 300-site frame is ~30 % smaller and the client parses
    noticeably smaller arrays every second; no value the UI shows changed.
    """
    return {
        "tick": engine.tick, "resync": resync, "kpis": engine.kpis(),
        "run_id": _run_id, "reset_notice": _reset_notice,
        "run_error": _run_error,
        "control": {"paused": engine.paused, "speed": _speed, "seed": engine.seed,
                    "auto_approve_seconds": worker.auto_approve_seconds if worker else 0},
        "dashboard": _dashboard_payload(),
        "agg": _agg_payload(),
        "nodes": _node_dicts(),
        "teams": [t.to_dict() for t in engine.teams],
        "rings": _ring_payload(),
        "ai": _ai_payload(),
    }


@app.get("/api/data", response_model=S.DeltaResponse)
async def get_full():
    with _lock:
        return _snapshot(resync=True)


@app.get("/api/delta", response_model=S.DeltaResponse)
async def get_delta(since: int = Query(0, ge=0)):
    """Read-only, replay-safe bounded snapshot at the existing delta endpoint.

    The legacy tick cursor is retained. Nodes/teams/logs are complete bounded
    readouts, so paused same-tick mutations and dropped polls are never lost.
    No request changes delivery state for another client.
    """
    with _lock:
        # Always mark complete snapshots so legacy consumers replace logs too.
        return _snapshot(resync=True)


@app.get("/api/activity", response_model=S.ActivityResponse)
async def activity_log():
    """Recent engine events, fetched only while the Activity dialog is open.

    Session-aware like every other read: a dashboard with a session sees its own
    run's log; anonymous traffic sees the shared world's (read-only, no engine
    is built for it).
    """
    with _lock:
        return S.ActivityResponse(run_id=_run_id, tick=engine.tick,
                                  logs=list(engine.logs)[-60:])


def _downsample_samples(samples: list[dict], max_points: int) -> list[dict]:
    """Thin a long history to ~``max_points`` rows without losing a peak.

    A 7-day window is 2 017 five-minute samples (~480 KB of JSON) drawn on a
    chart that is ~600 px wide, so most of them can never be seen. Each bucket
    contributes its lowest and highest traffic sample and its lowest and highest
    drop-rate sample (deduplicated), which preserves the envelope: spikes and
    troughs survive, the flat parts collapse, and the rows stay in tick order.
    """
    if len(samples) <= max_points:
        return samples
    buckets = max(1, max_points // 2)
    size = len(samples) / buckets
    out: list[dict] = []
    seen: set[int] = set()
    for b in range(buckets):
        chunk = samples[int(b * size):int((b + 1) * size)]
        if not chunk:
            continue
        picks = [
            min(chunk, key=lambda r: r["throughput_gbps"]),
            max(chunk, key=lambda r: r["throughput_gbps"]),
            min(chunk, key=lambda r: r["drop_rate"]),
            max(chunk, key=lambda r: r["drop_rate"]),
        ]
        for row in sorted(picks, key=lambda r: r["tick"]):
            if row["tick"] in seen:
                continue
            seen.add(row["tick"])
            out.append(row)
    return out


@app.get("/api/telemetry/history", response_model=S.TelemetryHistoryResponse)
async def telemetry_history(
    timeframe: Literal["30m", "24h", "7d"] = Query("30m"),
    run_id: str = Query(..., min_length=1),
    max_points: int = Query(300, ge=50, le=2500),
):
    """Read actual samples from the current simulation run, never a forecast.

    30m/24h/7d refer to simulated network time. Samples are emitted at the
    engine's five-minute tick resolution; a newly reset world therefore fills
    longer windows as simulated time elapses.
    """
    minutes = {"30m": 30, "24h": 24 * 60, "7d": 7 * 24 * 60}[timeframe]
    sample_count = minutes // C.TICK_MINUTES + 1
    with _lock:
        _assert_current_run(run_id)
        current = P.sample(engine)
        rows = _history.read_window(engine, current, sample_count)
        return {
            "run_id": _run_id,
            "timeframe": timeframe,
            "tick_minutes": C.TICK_MINUTES,
            # Long windows arrive thinned (see _downsample_samples); short ones
            # are sent exactly as recorded.
            "samples": _downsample_samples(rows, max_points),
        }


@app.get("/api/history", response_model=S.RunHistoryResponse)
async def run_history():
    """Recent durable completion summaries, not resumable simulation state."""
    try:
        return {"summaries": _summary_store.recent()}
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Run history is unavailable: {str(exc).strip() or type(exc).__name__}",
        ) from exc


@app.get("/api/health")
async def health():
    with _lock:
        payload = {"status": "ok", "tick": engine.tick, "paused": engine.paused,
                   "speed": _speed, "slow_ticks": _slow_ticks,
                   "seed": engine.seed, "run_id": _run_id,
                   "run_error": _run_error, "ai_enabled": engine.ai_enabled,
                   "ai_policy": engine.ai_policy}
    # Capacity is part of health: "at capacity" was previously invisible until a
    # visitor was refused, which made the failure impossible to diagnose live.
    if _registry is not None:
        payload["sessions"] = _registry.stats()
    return payload


# ------------------------------------------------------------------ control
@app.post("/api/control/pause")
async def pause(run_id: str = Query(..., min_length=1)):
    with _lock:
        _assert_current_run(run_id)
        engine.paused = True
    return {"paused": True, "run_id": run_id}


@app.post("/api/control/resume")
async def resume(run_id: str = Query(..., min_length=1)):
    with _lock:
        _assert_current_run(run_id)
        engine.paused = False
    return {"paused": False, "run_id": run_id}


@app.post("/api/control/step")
async def step_once(run_id: str = Query(..., min_length=1)):
    return await asyncio.to_thread(_step_locked, False, run_id)


@app.post("/api/control/speed")
async def set_speed(
    value: float = Query(1.0, ge=0.25, le=10.0),
    run_id: str = Query(..., min_length=1),
):
    global _speed
    with _lock:
        _assert_current_run(run_id)
        _speed = value
        return {"speed": _speed, "run_id": run_id}


@app.post("/api/control/inject")
async def inject(
    node_id: str,
    kind: int = Query(3, ge=1, le=5),
    run_id: str = Query(..., min_length=1),
):
    from autonoc.engine import faults as F
    with _lock:
        _assert_current_run(run_id)
        node = engine.net.by_id.get(node_id)
        if node is None:
            raise HTTPException(404, f"unknown node {node_id}")
        if node.is_faulty:
            raise HTTPException(409, f"{node_id} already faulty")
        node.status = kind
        node.status_timer = 0
        node.fault_started_tick = engine.tick
        node.last_changed_tick = engine.tick
        F.apply_degradation(node, kind, 1.0, 1.0, engine.noise)
        # ITU-T X.733 perceived severity for the injected fault class
        engine.log(f"MANUAL: {node_id} — {C.STATUS_NAMES[kind]} injected",
                   C.X733_SEVERITY.get(kind, "MAJOR"), node_id)
    return {"ok": True, "node": node_id, "status": kind}


@app.post("/api/control/cut-fiber")
async def cut_fiber(
    ring_id: int = Query(0, ge=0, le=20),
    isolate: bool = Query(True),
    cause: str = Query("construction", pattern="^(construction|storm|equipment)$"),
    run_id: str = Query(..., min_length=1),
):
    """Trigger the Act 3 scenario: a double cut isolates a whole ring."""
    with _lock:
        _assert_current_run(run_id)
        return engine.cut_fiber(ring_id, isolate=isolate, cause=cause)


# ------------------------------------------------------------------ commander (M6)
@app.post("/api/control/ai")
async def set_ai(
    enabled: bool = Query(True),
    auto_approve_seconds: float = Query(C.AUTO_APPROVE_SECONDS, ge=0, le=600),
    run_id: str = Query(..., min_length=1),
):
    """Toggle the Commander and (for demos) auto-approve-after-N-seconds."""
    with _lock:
        _assert_current_run(run_id)
        engine.ai_enabled = enabled
        if not enabled:
            engine.ai_verdicts = {}
            engine.ai_mode = "off"
        if worker is not None:
            worker.set_auto_approve(auto_approve_seconds)
    return {"ai_enabled": enabled, "auto_approve_seconds": auto_approve_seconds}


@app.post("/api/control/approve/{action_id}")
async def approve(action_id: int, run_id: str = Query(..., min_length=1)):
    with _lock:
        _assert_current_run(run_id)
        return engine.approve_action(action_id)


@app.post("/api/control/veto/{action_id}")
async def veto(action_id: int, run_id: str = Query(..., min_length=1)):
    with _lock:
        _assert_current_run(run_id)
        return engine.veto_action(action_id)


# ------------------------------------------------------------------ static
# Absolute paths work under both Uvicorn and the multi-stage Docker image.
_WEB = Path(__file__).resolve().parents[1] / "web"
_DIST = _WEB / "dist"
app.mount("/static", StaticFiles(directory=str(_WEB)), name="static")
app.mount("/assets", StaticFiles(directory=str(_DIST / "assets"), check_dir=False), name="assets")


@app.get("/favicon.svg", include_in_schema=False)
async def favicon():
    path = _DIST / "favicon.svg"
    if not path.exists():
        raise HTTPException(404)
    return FileResponse(path)


@app.get("/")
async def index():
    built = _DIST / "index.html"
    return FileResponse(built if built.exists() else _WEB / "index.html")
