"""In-memory browser session registry for the single Fly machine.

Sessions exist so two dashboards never share one simulation: each cookie owns
its own engine, lock, controls, history and inference worker.

Three limits, all configurable through the environment:

* ``max_sessions`` — hard cap on concurrent dashboards (default 16).
* ``idle_timeout`` — seconds without a request before a dashboard is dropped
  (default 180 s).
* ``reclaim_grace`` — how long a dashboard must have been silent before its
  slot may be handed to a new visitor (default 15 s).

WHY THE OLD CAP WAS A DEAD END
------------------------------
Capacity has to be bounded on a single shared-CPU machine, but a hard bound
must never become a lockout. Two things were wrong with a flat rejection:

1. Cookies cannot be set on a 503, so a visitor who was refused never received
   a token and had nothing to keep. Every retry looked like a brand-new
   visitor, and the demo stayed full forever.
2. A lost cookie (new browser, cleared jar, private window) cannot reclaim its
   own old slot. On a public demo those orphans accumulate until the idle
   timeout, so the failure was persistent rather than transient.

Recovering a slot is therefore part of the contract:

* ``get`` reclaims the least recently seen session once it has been silent for
  ``reclaim_grace``. A visitor who is actually polling the dashboard is never
  the one evicted before a dead tab.
* ``get_or_default`` is the retry path and never raises: when every slot is in
  use it adopts the single least recently seen session, so a visitor who is
  demonstrably waiting always ends up with a working dashboard.

The cap still bounds how many engines the machine runs; it no longer decides
which visitors are allowed to see the product.

WHY 16 IS NOT A HARDWARE LIMIT
------------------------------
Benchmarked on the deployment target: one ``engine.step()`` costs ~2 ms and
eight live engines hold ~100 MB RSS, so modelling every session every second is
cheap. The cap is a safety rail against runaway concurrency, not the ceiling of
what the machine can serve.
"""
from __future__ import annotations

import secrets
import threading
import time
from dataclasses import dataclass, field
from typing import Callable

COOKIE_NAME = "autonoc_session"

# Only real API traffic needs a dashboard session. HTML, the favicon and static
# assets are byte-identical for every visitor, and the requests that cannot keep
# a cookie (uptime probes, crawlers, asset fetches) must never occupy a slot.
# The dashboard's first `/api/*` call creates the session and issues the cookie.
SESSION_FREE_PATHS: frozenset[str] = frozenset({"/api/health", "/api/wave/status"})


def requires_session(path: str) -> bool:
    """True when this request needs (and may create) a per-browser session."""
    if path in SESSION_FREE_PATHS:
        return False
    return path.startswith("/api/")


@dataclass
class Session:
    token: str
    engine: object
    lock: threading.Lock
    speed: float
    history: object
    run_id: str
    reset_notice: bool = False
    run_error: str | None = None
    worker: object | None = None
    summary_store: object | None = None
    slow_ticks: int = 0
    last_seen: float = field(default_factory=time.monotonic)
    # Per-session summary directory; released through ``on_drop`` when the
    # session is retired, so a long-lived demo cannot fill the Fly volume.
    data_dir: str | None = None


class SessionCapacityError(Exception):
    """Raised only when no slot can be freed for a would-be new session."""

    def __init__(self, message: str, retry_after: float = 1.0):
        super().__init__(message)
        self.retry_after = retry_after


class InMemorySummaryStore:
    """Per-session completed-run summaries; never shared between cookies."""

    def __init__(self, max_entries: int = 20):
        self.rows = []
        self.max_entries = max_entries

    def save(self, run_id, summary):
        self.rows.insert(0, dict(summary))
        del self.rows[self.max_entries:]

    def recent(self, limit=20):
        return list(self.rows[:limit])


class SessionRegistry:
    def __init__(self, factory: Callable[[str], Session], max_sessions: int = 16,
                 idle_timeout: float = 180.0, reclaim_grace: float = 15.0,
                 reclaim: bool = True,
                 on_drop: Callable[[Session], None] | None = None):
        self.factory = factory
        self.max_sessions = max(1, int(max_sessions))
        self.idle_timeout = max(1.0, float(idle_timeout))
        self.reclaim_grace = max(0.0, float(reclaim_grace))
        self.reclaim = bool(reclaim)
        # Called whenever a session is retired, so per-session resources that
        # live outside this class (its summary SQLite directory) are released.
        self.on_drop = on_drop
        self._sessions: dict[str, Session] = {}
        self._lock = threading.RLock()
        self._reclaims = 0

    # ------------------------------------------------------------ internals
    def _drop(self, token: str, session: Session) -> None:
        """Remove one session and release everything it owns. Caller holds lock."""
        try:
            worker = session.worker
            if worker is not None:
                worker.stop()          # idempotent and non-blocking
        except Exception:
            # A worker that refuses to stop must never block capacity.
            pass
        self._sessions.pop(token, None)
        if self.on_drop is not None:
            try:
                self.on_drop(session)
            except Exception:
                pass

    def _purge(self, now: float) -> None:
        for token, session in list(self._sessions.items()):
            if now - session.last_seen > self.idle_timeout:
                self._drop(token, session)

    def _oldest(self, now: float, exclude_token: str | None,
                min_idle: float = 0.0) -> Session | None:
        """Least recently seen session, optionally requiring it to be idle."""
        candidates = [
            s for token, s in self._sessions.items()
            if token != exclude_token and (now - s.last_seen) >= min_idle
        ]
        return min(candidates, key=lambda s: s.last_seen, default=None)

    def _reclaim(self, victim: Session) -> None:
        """Free exactly one slot. Runs under ``self._lock``."""
        for token, session in list(self._sessions.items()):
            if session is victim:
                self._drop(token, session)
                self._reclaims += 1
                return

    def _create(self) -> tuple[Session, bool]:
        token = secrets.token_urlsafe(32)
        session = self.factory(token)
        self._sessions[token] = session
        return session, True

    # ---------------------------------------------------------------- public
    def get(self, token: str | None) -> tuple[Session, bool]:
        """Resolve a cookie to its session, creating one when capacity allows."""
        now = time.monotonic()
        with self._lock:
            self._purge(now)
            if token and token in self._sessions:
                session = self._sessions[token]
                session.last_seen = now
                return session, False
            if len(self._sessions) >= self.max_sessions:
                victim = (self._oldest(now, token, self.reclaim_grace)
                          if self.reclaim else None)
                if victim is None:
                    raise SessionCapacityError(
                        f"SuliNOC is at capacity ({self.max_sessions} active browser "
                        "sessions). Close an idle dashboard and try again.",
                        retry_after=1.0,
                    )
                self._reclaim(victim)
            return self._create()

    def get_or_default(self, token: str | None) -> tuple[Session, bool]:
        """Never raises: capacity pressure degrades to the oldest session.

        Used for the dashboard's explicit retry. A visitor who is demonstrably
        waiting must not be locked out, so even a busy session is adopted before
        the request is refused.
        """
        with self._lock:
            try:
                return self.get(token)
            except SessionCapacityError:
                victim = self._oldest(time.monotonic(), token)
                if victim is None:
                    return self._create()   # registry drained; just create
                self._reclaim(victim)
                return self._create()

    def holds(self, session: Session) -> bool:
        """True while this object still owns a slot (used by the sim loop)."""
        with self._lock:
            return any(s is session for s in self._sessions.values())

    def count(self) -> int:
        with self._lock:
            self._purge(time.monotonic())
            return len(self._sessions)

    def stats(self) -> dict:
        """Capacity gauge for ``/api/health`` and operational debugging."""
        with self._lock:
            self._purge(time.monotonic())
            return {
                "active": len(self._sessions),
                "max": self.max_sessions,
                "idle_timeout_seconds": self.idle_timeout,
                "reclaim_grace_seconds": self.reclaim_grace,
                "reclaim_enabled": self.reclaim,
                "reclaimed": self._reclaims,
            }

    def clear(self) -> None:
        with self._lock:
            for token, session in list(self._sessions.items()):
                self._drop(token, session)
