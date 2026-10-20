# Session capacity: why the demo said "at capacity" and how it was fixed

## The symptom

A public visitor opened <https://autonoc-project.fly.dev/> and was greeted by:

```
Telemetry connection interrupted. Showing the last received state.
AutoNOC is at capacity (8 active browser sessions). Close an idle dashboard and try again.
```

…and the dashboard never recovered. The API returned the same refusal directly:

```json
{"detail":"AutoNOC is at capacity (8 active browser sessions). Close an idle dashboard and try again.","code":"session_capacity"}
```

That refusal is produced by `autonoc/api/sessions.py` (`SessionRegistry.get`) and returned by the
`browser_session` middleware in `autonoc/api/main.py`. The frontend banner that shows the
`detail` text is `frontend-react/src/App.tsx`.

## Root causes

The session feature itself is correct: on a single shared-CPU machine, each browser must get its
own engine, and there has to be a bound on how many engines run at once. The bug was in how the
limit was enforced.

### 1. Probes, crawlers and assets consumed dashboard slots

The middleware created a session for **every** request that arrived without a cookie — including
`/api/health`, `/`, `/favicon.svg`, `/static/*` and `/assets/*`. Those requests cannot keep a
cookie, so each one silently took one of the 8 slots. A single uptime monitor polling
`/api/health` every 30 seconds filled the demo by itself, and the slots did not free until the
30-minute idle timeout.

### 2. A refusal was unrecoverable

* Cookies cannot be set on a 503, so a refused visitor never received a token and had nothing to
  send back. Every retry looked like a brand-new visitor and was refused again.
* A lost cookie (new browser, cleared jar, private window) could not reclaim its own old slot.
  Because only an *idle* session ever expired, orphaned sessions accumulated and the demo stayed
  full — permanently, not transiently.
* The advice in the error ("close an idle dashboard") is unactionable for a first-time visitor who
  owns no dashboard.

### 3. The clock slowed down as the demo got busier

`simulation_loop` alternated session stepping with a **full tick of sleep per session**, so with
*N* sessions the simulation advanced at roughly 1/*N* of the intended rate. The simulation is the
product; a popular demo would have looked broken in a second, more confusing way.

### 4. Reclaimed space was never released

Every session writes its completed-run summaries to its own SQLite directory under
`AUTONOC_DATA_DIR/sessions/<token>/`. Nothing ever deleted them, so a long-running demo filled the
1 GB Fly volume.

## The fix

| Change | File | What it does |
| --- | --- | --- |
| `requires_session(path)` | `autonoc/api/sessions.py` | Only `/api/*` traffic (minus `/api/health`) takes a slot. Probes, HTML, favicon and static assets are answered by a detached session that fronts the shared default engine and is never registered. |
| LRU reclaim with a grace window | `autonoc/api/sessions.py` | When the cap is reached, the least recently seen session is reclaimed once it has been silent for `reclaim_grace` (default 15 s). A dashboard that is actually polling is never the first one evicted. |
| `get_or_default` retry path | `autonoc/api/sessions.py`, `autonoc/api/main.py` | A request marked `X-AutoNOC-Retry: 1` is a visitor who is waiting, so it adopts the oldest session instead of being refused. The refusal is now transient by construction. |
| Capacity defaults | `autonoc/api/main.py` | `AUTONOC_MAX_SESSIONS` default 16 (was 8); `AUTONOC_SESSION_IDLE_SECONDS` default 180 s (was 1800 s). One `engine.step()` costs ~2 ms and 8 live engines hold ~100 MB RSS, so the old bound was far below what the machine can serve. |
| Deadline-based pacing | `autonoc/api/main.py` | The simulation clock advances one tick per `BASE_TICK_SECONDS` regardless of how many sessions are live; overruns resync instead of banking debt. |
| Retry on refusal | `frontend-react/src/services/api.ts` | On `503 / session_capacity` the dashboard waits for `Retry-After` and repeats the request once with the retry marker. A 503 never reaches the engine, so this is safe for POST controls too. |
| Capacity gauge | `autonoc/api/main.py` (`/api/health`) | `sessions: {active, max, idle_timeout_seconds, reclaim_grace_seconds, reclaim_enabled, reclaimed}` makes saturation observable before a visitor is affected. |
| Session cleanup | `autonoc/api/main.py`, `autonoc/api/sessions.py` | Retiring a session stops its inference worker and removes its summary directory (`on_drop`). |
| Cookie hardening | `autonoc/api/main.py` | The session cookie is `Secure` whenever the request arrived over TLS (`AUTONOC_COOKIE_SECURE=auto`, forced with `1`/`0`). |

The `session_capacity` response is kept — capacity is still bounded — but it is now:

* **rare** (only API traffic counts, and the cap is 16),
* **self-healing** (idle sessions expire in 3 minutes, quiet ones are reclaimed), and
* **never a dead end** (the dashboard's retry adopts a slot and receives its cookie).

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `AUTONOC_MAX_SESSIONS` | `16` | Hard cap on concurrent dashboards. |
| `AUTONOC_SESSION_IDLE_SECONDS` | `180` | Seconds without a request before a dashboard is dropped. |
| `AUTONOC_SESSION_RECLAIM_GRACE` | `15` | How long a dashboard must be silent before its slot may be given to a new visitor. |
| `AUTONOC_SESSION_RECLAIM` | `1` | `0` disables reclaim: a full registry refuses instead of adopting (the retry path still works). |
| `AUTONOC_COOKIE_SECURE` | `auto` | `auto` follows the request scheme; `1`/`0` force the `Secure` cookie flag. |

Sizing note for the current 1 shared vCPU / 1 GB machine: each session is one 300-node engine
(~2 ms per tick) plus one inference worker thread sharing the read-only model bundle. Stepping 16
sessions costs ~32 ms per second — under 4 % of one core — and roughly 200 MB of RSS, which leaves
headroom inside the 1 GB limit. Raise `AUTONOC_MAX_SESSIONS` only with that budget in mind; the
gauge in `/api/health` reports the live count.

## Verification

* `PYTHONPATH=. pytest -q tests/test_sessions.py` — 12 passed. Covers isolation, idle expiry,
  reclaim after the grace window, refusal while every dashboard is active, the waiting-visitor
  retry, the disabled-reclaim path, `/api/health` capacity reporting, session-free paths, summary
  directory cleanup, and the end-to-end 503 → retry → 200 flow.
* Full suite: 115 passed, 6 skipped, plus the 2 pre-existing model-dependent failures that need
  PyTorch in the test environment (they fail identically on the base commit).
* `frontend`: 29 tests passed, `tsc -b` clean, Prettier clean.
* Manual end-to-end check against a running server with `AUTONOC_MAX_SESSIONS=3`:

  | Step | Result |
  | --- | --- |
  | `/api/health`, `/`, `/static/app.js`, `/favicon.svg`, `/api/health` | HTTP 200, **no cookie**, `active: 0` |
  | Three dashboards fetch `/api/config` | HTTP 200, `active: 3` |
  | Fourth visitor polls while all three are active | HTTP 503, `code: session_capacity`, `Retry-After: 1` |
  | Same visitor retries with `X-AutoNOC-Retry: 1` | HTTP 200, cookie issued, `reclaimed: 1`, `active: 3` |
  | Next poll with that cookie | HTTP 200 |
  | Tick advance over 5 s with 3 sessions | 5 ticks — the 1 tick/s clock holds |

## Follow-up ideas (not implemented here)

* Move the session cap to a per-IP share if the demo ever attracts abuse rather than traffic.
* Persist nothing about live sessions (unchanged by design); only completed-run summaries survive.
