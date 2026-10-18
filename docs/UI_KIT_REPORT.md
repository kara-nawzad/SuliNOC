# SuliNOC UI kit applied to frontend-react: measured results

Build stamp: see the Settings dialog and footer (`build <sha>`). Measured on the dev server
(`npx vite`, port 5174) proxying the current backend (port 8000), headless Chromium, 1 vCPU sandbox.
Map tiles are blocked in this sandbox: **the map shows the local schematic fallback. The tile map is
not verified.** Numbers are from `/home/user/shots/measure.json` (not committed; screenshots are not committed).

## Commits (branch arena/1e87b4c1-sulinoc, not merged to main)
1. Restore frontend-react unchanged (926e496 base)
2. Add kit files unchanged + motion test (`node test/motion.test.mjs` prints OK)
3. Adapters from real /api/delta and /api/config fields, with tests
4. Towers: solid `.tw` markers on tile map and schematic; halo only for selected/faulty/flagged
5. Crews: kit CrewMotion; setLatLng per frame; parked/repairing not moving
6. Analytics: kit lineChart; Manrope 12 px; short times; units as subtitle; axis note under title
7. Organisation: nav order; Map/Schematic toggle; fibre rings list; Towers list; one note per page
8. Session: send the session token; investigation in docs/SESSION_RUN_INVESTIGATION.md
9. Build stamp in console, Settings, footer
10. Note style; analytics provenance 12 px (was 6 px)

## Acceptance
| Target | Result |
|---|---|
| Crew per-frame position change small | avg 0.60 px, p95 4.2 px, max 19 px per frame (desktop, 10 moving crews). Max includes frames stretched by the slow sandbox. |
| Frame time average < 16 ms | **Missed.** avg 221 ms, max 333 ms in headless sandbox. Not optimised further; not representative of a GPU browser. |
| Towers same solid colour on tile map and schematic | Verified on schematic (same markers in both; tile map not verified). |
| Analytics labels readable at 390 px | Axis/title 12–13 px Manrope; provenance fixed from 6 px to 12 px. Chart fits 313 px wide. |
| Reduced motion snaps crews | Reduced-motion run shows one-frame jumps (max 153 px); avg 1.7 px. Kit sets k=1 under reduce. |
| `node test/motion.test.mjs` prints OK | Yes |
| Screenshots 1280×800 and 390×844, 6 s after load, commit visible | Taken; stamp in footer/Settings. Not every page shot. |
| Analytics appends, never redraws | **Missed.** 20 redraws vs 0 appends in 20 s. The 30 min window trims its start every tick, which forces setData. Not changed. |
| Redraw counts reported | Yes: 20 redraws per 20 s on 30 min tab; total session 30 redraws, 6 appends. |
| DOM updates only on changed values | **Not met / not proven.** 884 DOM mutations/s including crew transforms (Leaflet) and framer-motion updates. |
| Page switch < 200 ms | **Missed.** Analytics nav to visible top: 1066 ms, measured including smooth scroll animation. |
| First load < 3 s | Met: 2195 ms (cold dev server). |

## Session investigation
Root cause: a request with no cookie and no header gets a new run at tick 0 (reproduced: 3 requests, 3 run IDs).
The React client sent neither, so a cross-site embed started a new run on every poll. The client now
sends the token, as the single-file console already did. The cookie's 180 s lifetime is set only at
creation (backend change needed; not made). See docs/SESSION_RUN_INVESTIGATION.md.

## Organisation: what changed and what did not exist
- Nav order is now Overview, Live network, Incidents, Analytics, Maintenance, AI, Towers; Settings and About are in the footer.
- The React app had no separate Topology page; "Network topology" was renamed "Live network".
- No "Prediction overlay" checkbox exists in this app; nothing to delete.
- Not done: wordmark-in-top-bar rule (no top-bar wordmark here), mono-only audit across the app,
  removing the "LOCAL SIMULATION" top-bar label (left as is).
- Not done: old/restored/new screenshot comparison per page; full 7-page screenshot set.
- `services/crewMotion.ts` is no longer used by the crew layer; kept with its tests.

## Latest pass (prompt items)
Build stamp: 0b69700 (top bar, Settings, footer). Tile stub: harness answers tiles.openfreemap.org with empty tiles; the map is verified only as the schematic/stub, not against real tiles.

| Item | Result |
|---|---|
| Analytics: no redraw per update | Met: 0 redraws, 21 appends in 20 s. The 30 min tab now runs from when it was opened (it no longer trims its start); the provenance line says so. |
| Page switch < 200 ms | Mixed: 45 ms on one run, 252 ms on another. Scroll is now instant. Not reliably met. |
| Frame time < 16 ms | Missed: 268 ms avg in sandbox. |
| Crew per-frame change small | 0.73 px avg, p95 5 px (desktop). |
| Reduced motion snaps crews | Not clearly shown: frames are ~240 ms here, so single-frame jumps can't be separated from normal steps. Max 168 px in one frame, consistent with a snap, but not conclusive. |
| DOM only on changed values | Missed: about 812 mutations/s (crew transforms and framer-motion). |
| Mono only for IDs, coords, times | Applied to the non-ID uses found by search (counts, PRB, CQI, speed, money/hours, skill). Not an exhaustive audit. |
| Repeated simulated label | Top-bar "LOCAL SIMULATION" removed; one .note per page (Live network, Towers). |
| Wordmark in top bar only when sidebar hidden | No top-bar wordmark exists; the sidebar is never hidden here, so nothing to change. |
| Screenshots 1280×800 and 390×844, 6 s after load, commit visible | Taken: new-desktop-1280x800.png and new-phone-390x844.png (in /home/user/shots, not committed). Commit shown in the top bar. |

## Production build check
Built with `vite build` to a temporary folder and served by `vite preview` (preview now proxies `/api`).
- First load 1321 ms (dev was 2347 ms). Page switch to Analytics 204 ms (one run; was 45–252 ms in dev).
- Frame time still about 268 ms average in the sandbox browser. Same as dev, so the cost is the headless
  renderer with the map and glass panels, not the dev server. Not solved here; needs measurement on a real GPU browser.
- DOM mutations still about 813/s, mostly crew marker transforms every frame. Not reduced.
- Reduced motion: per-frame crew change 0.46 px avg, max 11 px. Still not a clear snap; frames are too slow to tell.

## Latest pass: spacing, desktop type, phone layout (commit e259d50)

Measured with `probe-layout.mjs` (headless Chromium, all seven console pages):

| Check | 1280×800 desktop | 390×844 phone |
|---|---|---|
| Horizontal overflow | none | none |
| Text under 12 px | none (was 8–11 px in header, KPI cards, buttons, map scale) | none (was 5–9 px) |
| Small targets | buttons 36 px tall (desktop); 300 dense tower-list rows are 30 px | 44 px buttons; 2 Leaflet attribution links |

Fixes: the 12 px type floor from 601 px (now part of `frontend-react/src/styles/app.css`; the old generator `scripts/phone-type.cjs` was removed when the console CSS was merged); 36 px desktop button minimum; phone content starts at the screen edge (72 px rail margin cleared).

Performance figures carried over from the earlier production measurements (not re-run in this pass):
- Crew motion: average 0.69 px per frame, p95 5.2 px, max 19 px (desktop); reduced motion average 0.46 px.
- Frame time: average about 268 ms per frame in headless Chromium. Target was under 16 ms. Not met; headless rendering cost, not a real-device number.
- Page switch to Analytics: 45–252 ms; 204 ms in production. Target under 200 ms. Not reliably met.
- Redraws: 0 redraws and 21 appends in 20 s for the 30 min chart. Redraw target met on resize only; the 30 min feed uses `append()`.
- About 813 DOM mutations per second from crew transforms; not reduced.
