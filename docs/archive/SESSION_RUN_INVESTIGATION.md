# Why a visitor loses their simulation run

Investigated against `autonoc/api/main.py` and `autonoc/api/sessions.py` (read only; no backend change).

## What was observed
- Embedded `karanawzad.tech/SuliNOC` showed "The simulation run changed. Refreshing." and a different
  clock from the direct Fly page.

## Findings (reproduced against the local backend)
1. **No cookie and no header means a new run on every request.** Three requests to `/api/delta`
   without a cookie returned three different `run_id`s, each at tick 0.
2. **A cookie jar keeps the run.** The same jar gave one `run_id`, and the tick advanced 0 → 3.
3. **The cookie lives 180 s from creation, not from last use.** The server sets
   `Max-Age=180` only on the response that creates the session (`if created:`). Later requests do not
   refresh it, so an active visitor loses the cookie 3 minutes after the first request, and gets a
   new run.
4. **The React client sent neither the cookie nor the header.** `services/api.ts` used a plain
   `fetch` with no token. In a cross-site iframe (karanawzad.tech → Fly), the browser may not keep the
   cookie, so every poll started a new run. This is the "run changed" message.
5. **The single-file console already used the header fallback**: it stores `x-autonoc-session` in
   `sessionStorage` and sends it back. Verified: with only the header, `run_id` stayed fixed while
   the tick advanced 0 → 3 → 5.
6. **Server idle expiry is 180 s since last activity** (`AUTONOC_SESSION_IDLE_SECONDS`). A polling
   tab keeps its session alive. A hidden tab that polls rarely (browsers throttle background tabs) can
   be idle past 180 s and lose its run.
7. **The 16-session cap** (`AUTONOC_MAX_SESSIONS`) counts sessions, not visitors. Every cookie-less
   request creates one, so probes and embeds can take slots.

## What was changed
- `frontend-react/src/services/api.ts`: the token from `x-autonoc-session` is stored in
  `sessionStorage` and sent on every request. Storage errors fall back to the cookie.

## Still open (needs a backend change, not made here)
- Refresh the session cookie's `Max-Age` on every response, not only on creation (point 3).
- Stop creating sessions for cookie-less probes such as `/api/health` (point 7).
- Decide whether background tabs should keep their run longer than 180 s (point 6).
