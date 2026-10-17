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
