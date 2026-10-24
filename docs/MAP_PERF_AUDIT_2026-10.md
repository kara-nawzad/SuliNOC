# Live-map performance audit — Task A (2026-10-24)

Scope: the Live network map (crews moving between 300 sites), especially on
phones. Findings only — no behaviour, feature or visual changes were made for
this audit. Line numbers refer to the working tree on 2026-10-24.

Measured facts (from the running simulation API, one cookie-jar session):

- `/api/delta` returns a **complete snapshot every poll**: 300 nodes × 31
  fields, 10 teams, 10 rings with full paths, logs, dashboard, agg —
  **131,764 and 133,460 bytes** on two consecutive polls.
- Poll interval: **1000 ms** (`poll_ms`, `autonoc/api/presentation.py:36`;
  consumed by `frontend/src/hooks/useTelemetry.ts:58`).
- Crews: **10 teams** (`num_teams`), sites: **300** (`num_nodes`).

## What is already fast (verified, not assumed)

- **Crew markers are created once and only moved.** `CrewLayer.tsx:63-88`
  creates one `SubpixelCrewMarker` per team and reuses it; positions are
  updated with `setLatLng`, never re-created. `SubpixelCrewMarker`
  (`CrewLayer.tsx:22-37`) keeps fractional pixel positions so trucks don't
  pixel-hop.
- **Crew movement runs on requestAnimationFrame, not on data ticks.**
  `frontend/src/crew-motion.js` is a dependency-free rAF engine: backend
  updates enter via `set()` (:66-113), positions are extrapolated between
  ticks using observed velocity (`_targetAt`, :186-196), smoothed
  exponentially (`step`, :232-250), and the loop stops entirely when no crew
  needs to move (:130-133). `prefers-reduced-motion` is respected (:59-62).
- **Tower markers are not re-created per tick.** Icons are cached
  (`NetworkMap.tsx:94-106`) and each `TowerMarker` is memoized with a
  field-level comparator (`NetworkMap.tsx:118-178`) that blocks re-renders
  when nothing visible changed.
- **Tiles are not involved in per-tick work.** The Esri raster tile layer
  (`TileBasemap.tsx:16-18`) only loads during pan/zoom.

## Bottlenecks, ranked by impact

### 1. The whole app re-renders every second (highest impact)

Every poll replaces the entire snapshot state: `useTelemetry.ts:40-45`
(`setData(next)`), so `Console` (`App.tsx:67`) re-renders its whole tree at
1 Hz — KpiGrid (`App.tsx:493`), NetworkMap (:495), AnalyticsRow (:519),
TowerList (:540), AlertsSidebar ×2, SimControls, Inspector, WaveChat (:780).
Because the backend always sends fresh objects, every memo/comparator in the
tree re-runs even when nothing visible changed.

The worst offender inside that tree is the towers table:
`TowerList.tsx:18-27` re-runs `[...data.nodes].filter().sort()` (a 300-item
sort) every tick and all ~300 rows (`TowerList.tsx:67`) re-render — roughly
2,000+ DOM-diffed elements per second. Inside the map, the district,
prediction and cut `CircleMarker` groups (`NetworkMap.tsx:487,497,516`) also
re-render each tick, and the 300 memoized tower markers still cost 300
comparator calls + 300 element allocations per tick.

`main.tsx:52-57` wraps the app in `React.StrictMode`, which double-invokes
render in the dev preview — the preview you feel on a phone pays roughly 2×
this cost (production builds do not).

**Why it reads as "laggy":** this is a burst of main-thread work every
second, landing exactly while crew markers are animating. Each burst drops
frames; on mid-range phones the burst is long enough to visibly stutter.

### 2. The 300 sites are 300 individual DOM markers

`NetworkMap.tsx:99-104` builds a Leaflet `L.divIcon` per site; each is an
absolutely positioned div with a box-shadowed 12 px dot
(`app.css:3209-3238`). ~300 positioned divs live in the marker pane. They are
not re-created per tick (see above), but the count itself is the cost: every
pan/zoom rasterizes 300 shadowed divs, and hover tooltips are bound to each.
On mid-range phones this is the biggest interaction-time cost (pan/zoom
jank), separate from the 1 Hz cost above.

### 3. Always-running CSS animations repaint the map at 60 fps

- `app.css:2520-2522` — `.fiber-flow` animates `stroke-dashoffset` on all 10
  ring polylines forever (18 s loop). Stroke-dashoffset animation is a
  main-thread repaint of paths spanning the whole map.
- `app.css:2545-2551` — `.cut-pulse` (1.8 s opacity loop) with a
  `drop-shadow` filter; `app.css:3144-3148` — `.predictive-pulse` (2.8 s)
  with `drop-shadow`.

These run even when nothing else changes, so the map pane is never fully
idle. They are part of the current visuals and were not touched; they are
listed because they compound #1 and #2 on phones.

### 4. The full snapshot is re-fetched and re-parsed every second — including in background tabs

~130 KB/s download + `JSON.parse` of ~9,300 node fields, plus a fresh object
tree that defeats memoization (see #1). `useTelemetry` has no
`document.hidden` handling, so a hidden tab keeps fetching, parsing and
re-rendering (rAF and CSS animations throttle themselves; the React work does
not). Radio + CPU + battery cost for an invisible page.

### 5. Renderer geometry makes every overlay redraw more expensive than needed

- `NetworkMap.tsx:41` and `:400` — `L.svg({ padding: 0.4 })` sizes the SVG
  overlay canvas to ~3.24× the viewport area (Leaflet's default 0.1 ≈ 1.44×).
  Every fiber/pulse redraw paints that much more surface.
- `NetworkMap.tsx:425-433` — `zoomSnap: 0.1` + `scrollWheelZoom`: fractional
  zoom levels multiply tile re-fetch/rescale churn during zoom.

Both are interaction-time costs, not per-tick costs.

### 6. Minor per-frame crew costs (polish, not the lag)

`CrewLayer.tsx:44-53` — per crew per frame: `setLatLng` performs a rounded
`update()` and then a second fractional `setPosition` (two style writes), and
two `classList.toggle` calls. With 10 crews this is small, but it is easy
win territory once #1/#2 are fixed. There is also no anti-stacking offset
when two crews occupy the same point (planned for Task C).

## Proposed fix (Task B plan — same language, same library)

Keep TypeScript/React and Leaflet. The measured costs are all fixable inside
the current stack; switching languages or map engines would not address #1,
which is the largest item.

1. **Stop the 1 Hz whole-app re-render.** Keep the snapshot in a single store
   (ref/context) and let each panel subscribe to the slice it renders;
   memoize the towers table rows on field-level changes (the pattern
   `sameTowerMarker` already uses) so the 300-row table only re-renders when
   a visible value changes; do the same for the map's district/prediction/cut
   layers. Target: a tick becomes a few small updates, not a full-tree
   render.
2. **Move the 300 sites to one canvas layer.** Leaflet's built-in
   `L.canvas()` renderer with `L.circleMarker`s (same 12 px dot, white ring,
   halos) keeps click/tooltips via canvas hit-testing and replaces ~300 DOM
   divs with a single canvas. Crews (10) stay as markers — they need the
   icon, labels and animation (Task D restyles them).
3. **Throttle when the tab is hidden.** Pause polling on
   `visibilitychange`→hidden, poll once on return (rAF already self-pauses).
4. **Trim the SVG renderer padding** from 0.4 to ~0.15 (invisible except
   during very fast fly-tos) so overlay redraws paint ~2× less surface.
5. **No WebGL/MapLibre switch.** With 10 animated crews and a raster
   basemap, Leaflet + canvas is comfortably within budget once #1/#2 are
   done; MapLibre would mean rewriting tiles, overlays and interaction for
   no measured need. **No Web Worker either:** the simulation runs in Python
   on the server; the only client math is 10-crew interpolation
   (microseconds per frame) — a worker adds complexity without measurable
   gain. The language was never the problem, as expected.
6. **Verification:** no browser exists in the sandbox, so ranking is from
   code analysis plus the payload measurements above. Task F (user's phone
   - desktop check) is the acceptance test; targets are 60 fps desktop and
     ≥30 fps on a mid-range phone with crews moving.

Task C (distance-band speeds, ease-in/out, anti-stacking) will extend
`crew-motion.js` — its speed curve already lives in one place
(`DISTANCE_SPEED_POINTS`, `crew-motion.js:13-21`) and will become the single
config file with named bands.

## Task B implementation (2026-10-24) — approved plan, applied in order

Conditions honored: crew-motion.js and CrewLayer were not touched (movement,
markers and its rAF loop are byte-for-byte unchanged); visuals, clicks, hover
tooltips, selection highlight and the map-layer toggles are preserved.

### 1. Slice subscriptions + memoization

- `frontend/src/App.tsx` — `navigate` and a new `selectOnMap` are `useCallback`
  (stable identities), so memoized children are not defeated by fresh inline
  arrows each tick. Also toggles `tab-hidden` on `<html>` (see 5).
- `frontend/src/components/TowerList.tsx` — wrapped in `memo` with
  `sameTowerRows`, the table's slice: `id/status/prb/cqi/ring` per node plus
  config/onSelect identity. The 300-row re-render every second is gone; rows
  re-render only when a shown value moves.
- `frontend/src/components/NetworkMap.tsx` —
  - `Towers` gained a slice comparator (`sameSiteNodes`: id, lat, lon, status,
    warn, vswr, prb) on top of the existing per-marker memo, so a tick with no
    site change skips the entire 300-marker pass.
  - `PredictionPulses` (new, memoized on warn/lat/lon/id) and `DistrictLabels`
    (new, memoized on id/lat/lon/name) replace the inline per-tick groups.
  - Cut-pulse circles moved inside the already-memoized `FiberOverlays`, so
    `sameRingLayers` now covers them too.
  - CrewLayer and MapTools keep receiving every tick (crew motion and the
    header dot need it); their render cost is a handful of elements.

### 2. Single canvas layer for the 300 sites

`TowerMarker` no longer creates a DivIcon DOM marker. Each site is 2–3
`L.circleMarker`s (1 px navy 20 % outline or 6 px 22 % status halo, then the
12 px dot: radius 5 + 2 px white ring) on one `L.canvas` renderer in a new
`sites-canvas` pane at z 560 — above the SVG overlays (400), below crew
markers (600/800), exactly the old stacking. Haloed sites (selected, faulty,
AI-flagged) are lifted with `bringToFront` after each slice change,
reproducing `zIndexOffset: 300`. Colors mirror the removed `.tw` rules
(`SITE_FILL`/`SITE_OUTLINE` constants; the dead `.tw` CSS block was deleted).
Click handlers, the hover tooltip (same markup, direction, offset), the
selection ring and the `sites` layer toggle are unchanged. Pane + renderer are
owned by `Towers` and unmount together, the same lifecycle LocalBasemap uses.

### 3. Polling pauses when the tab is hidden

`frontend/src/hooks/useTelemetry.ts` — `poll()` skips fetching while
`document.hidden` (after the first load) and keeps a 1 s heartbeat; a
`visibilitychange` listener polls immediately on return. The delta is a
complete snapshot, so one request catches up with no stale flash. New test:
"pauses polling while the tab is hidden and catches up when visible".

### 4. SVG renderer padding trimmed

Both `L.svg` renderers (fiber overlay + local basemap) and the new canvas
renderer use `padding: 0.15` instead of `0.4`: overlay redraws paint ~1.3×
the viewport instead of ~3.2×.

### 5. Decorative animations pause when hidden or panning/zooming

`app.css` — `.tab-hidden` (toggled in App.tsx on visibilitychange) pauses
fiber-flow, cut-pulse, predictive-pulse and `.pulse`;
`.map-interacting` (toggled in MapTools on movestart/zoomstart …
moveend/zoomend with a counter so pinch zoom cannot un-pause early) pauses
the three map animations. Look unchanged otherwise.

### Verification

- Vitest 19 files / 84 tests (new: 6 slice-comparator tests in
  `components/telemetrySlices.test.ts` + the hidden-tab poll test);
  `tsc -b` clean; Prettier clean; `vite build` OK (163.24 kB CSS — slightly
  smaller after removing the `.tw` rules; 130.23 kB JS).
- e2e specs reference no site-marker selectors, so they are unaffected.
- No browser exists in this sandbox; phone + desktop verification of click,
  hover tooltip, selection highlight and the layer menu happens in the live
  preview (Task F collects it).

### Before/after render cost (per 1-second tick, code-level counts)

| Cost               | Before                                                                                            | After                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Tower table        | 300-item copy+filter+sort and ~300 rows (~2,100 elements) re-rendered every tick                  | ~300 × 5 field compares; 0 row renders when nothing shown changed                      |
| Map site layer     | 300 DOM markers (recreated elements + memo compares every tick; ~300 divs rasterized on pan/zoom) | 1 canvas, ≤900 pre-built arcs; whole 300-site pass skipped when the slice is unchanged |
| Map extra groups   | 10 district + N prediction + cut circles re-rendered every tick                                   | skipped via slice comparators                                                          |
| Overlay paint area | SVG canvas ≈ 3.24× viewport per redraw                                                            | ≈ 1.3× viewport                                                                        |
| Hidden tab         | ~130 KB fetch + JSON.parse + full-tree React render every second                                  | 0 fetches; one catch-up fetch on return                                                |
| Map animations     | 60 fps dash/pulse repaints through pan/zoom and hidden tabs                                       | paused while hidden or interacting                                                     |

Not changed (deliberate): KPIs, charts and the alerts rail still re-render
each tick because they display per-tick values; the delta payload is still a
full snapshot (server contract) — the next lever if more is needed. Dev
preview still double-pays the (now cheap) shell render under StrictMode;
production does not.

## Task C implementation (2026-10-24) — distance-band speeds, trip easing, anti-stacking

All tunables live in one new file, `frontend/src/crew-motion.config.js`:

| Knob                   | Value                                            | Effect                                                                                                |
| ---------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `bands` (short→veryLong) | 1500 m → ×1.0, 4500 m → ×1.2, 9000 m → ×1.45, 15000 m → ×1.6 | Remaining-route-metres → speed factor, linearly interpolated between edges; beyond the last edge ×1.6 holds. Identical curve to the old inline `DISTANCE_SPEED_POINTS` (0→1, 1500→1, 3000→1.1, 4500→1.2, 9000→1.45, ∞→1.6), so no behaviour change, only configurability. |
| `ease.ramp`            | 0.12                                             | First and last 12% of every trip follow a cosine speed ramp (gentle ease-in at departure, ease-out at arrival). Endpoints and the midpoint are exact; max speed-up mid-trip is ×1.136. |
| `spread`               | 24 px separation, 20 px ring radius, 137.508° angle | A parked crew landing within 24 px of another parked crew is nudged onto a deterministic golden-angle ring. Moving crews and the first crew on a spot keep the true position. |

### What changed where

- `crew-motion.js`: imports the config; `distanceSpeedMultiplier` is now
  band-driven and exported; new exported `easeRouteProgress(t)` applies the
  cosine ramps; `_frame` draws `at(crew, easeRouteProgress(s/length)·length)`
  while heading samples and the reported `progress` stay raw (raw progress is
  what the backend reconciles against, so no telemetry semantics changed).
- `crew-motion.config.d.ts` (new) + `crew-motion.d.ts`: type declarations for
  the config and the two exported functions.
- `CrewLayer.tsx`: markers are placed through `placeCrew(id, latlng, moving)`,
  which keeps per-crew true positions and moving flags in refs. Parked crews
  that collide get the golden-angle offset (always recomputed from the true
  position, never accumulated). `zoomend` re-applies the parked spread; a
  departure (parked→moving) or a crew disappearing re-settles the neighbours,
  so an offset never outlives the congestion that caused it. Marker removal
  and unmount clean the new refs.
- Visual only: ETAs, routes, positions from the backend, and the pause/resume
  behaviour are untouched.

### Verification

- New unit tests in `crew-motion.test.ts` (7): band edge values, smoothness
  across band edges, monotonic speeds; easing endpoints/midpoint, gentle
  departure + creep-into-arrival, monotonic sweep, and "draws the eased
  position while reporting raw progress".
- Existing 5 motion tests unchanged and green (incl. max frame jump ≤ 3 with
  the eased draw, and tier-boundary smoothness at 5999/6001 m).
- Gates: Prettier clean; `tsc -b` clean; Vitest 19 files / 91 tests;
  `vite build` OK (131.59 kB main JS, motion chunk 137.30 kB).
- Served sources in the dev preview verified to contain the new code; API and
  page both healthy. Same caveat as Task B: no browser here, so on-screen
  feel (departure/arrival glide, ring separation at shared sites) is for the
  live preview / the user's phone check.

## Task D implementation (2026-10-24) — smaller crew marker, centred truck; plus two feedback fixes

### Feedback fix 1 — space under the Wave composer

The chat input sat flush on the panel's bottom edge (`.wave-composer` had
`margin: 0 var(--panel-pad)` — no bottom margin). Now
`margin: 0 var(--panel-pad) var(--space-3)` (12 px) on desktop and phone.

### Feedback fix 2 — Active incidents panel changing size with alert count

The panel is fixed-height again at every width:

| Width        | Rule                                                                            |
| ------------ | ------------------------------------------------------------------------------- |
| ≥ 1025 px    | rail `contain: size` (unchanged Task 4 behaviour: rail takes the map's height)   |
| 768–1024 px  | **new**: `.alarms-panel { height: clamp(340px, 62vh, 460px) }`, list scrolls inside |
| ≤ 767 px     | unchanged original block: `height: 400px !important`, list scrolls inside        |

The 768–1024 zone was the regression: an earlier audit round replaced the old
two-card rail rules with a content-driven height (`incident-list` grew from
the empty state up to `min(62vh, 460px)`), so the panel — and everything below
it — moved whenever alerts appeared or cleared. The stale/dead blocks that
described the removed two-card rail (power-card references, a 240 px list cap)
were deleted; one authoritative `≤1024` block now holds the small-screen rail
layout (single column, fixed panel, scrolling list).

### Task D — crew marker

- Tile: 38 px → **30 px** (`iconSize`/`iconAnchor` 30/15 in `CrewLayer.tsx`,
  `.app-shell .crew-marker` 30×30, padding 8 → 4). Border, colours, shadow and
  radius token unchanged.
- Truck centring, two root causes fixed:
  1. The inline `<svg>` sat on the text baseline, leaving descender space that
     nudged it off-centre → `.crew-marker svg { display: block }`.
  2. The glyph (bounds x 3–21, y 6–20 in a 24×24 viewBox) was itself
     off-centre vertically → viewBox recropped to `2 5 20 16`, which frames the
     glyph plus its stroke with equal margins, so the truck renders
     dead-centre at any tile size (and slightly larger: 18×14.4 px content).
- Task C's anti-stacking spread (24 px separation / 20 px ring) still applies;
  with the smaller tiles the offsets overlap less, so the values were left
  alone.

### Verification

- Gates: Prettier clean; `tsc -b` clean; Vitest 19 files / 91 tests;
  `vite build` OK (162.84 kB CSS — slightly smaller after deleting the dead
  rail blocks; 131.59 kB JS).
- Served preview sources verified to contain the new viewBox, 30 px icon and
  the fixed panel rule; API healthy. No browser here, so the on-screen check
  (smaller trucks centred in their tiles, panel holding one height as alerts
  churn, 12 px under the Wave input) is for the live preview / the user's
  phone.

## Task E implementation (2026-10-24) — segmented repair-progress ring

While a crew is REPAIRING, a notched ring is drawn just outside its 30 px tile
(the tile, border and truck from Task D are untouched). A faint track ring
appears the moment the repair starts; solid notches light one by one as the
mission's ETA counts down; the ring fades when the crew departs. The ring uses
the crew colour (`currentColor`), floats clear of the tile (40 px SVG box at
-5 px), and ignores pointer events, so clicking/hovering the truck is
unchanged.

### Where the tunables live

`frontend/src/crew-motion.config.js` → `repairRing`:
`segments: 8`, `sizePx: 40`, `radiusPx: 18`, `strokePx: 3`. `sizePx` pairs
with the 40 px box in the app.css rule next to the 30 px tile rule (the CSS
owns the rendered box; the config owns the viewBox maths). The dash/gap split
per notch is fixed at 70/30 of the segment length.

### How progress is derived (no API change)

The backend already exposes `eta` = `repair_ticks_left` for REPAIRING teams,
counting down each tick. `updateRepairTrack()` (exported from CrewLayer for
tests) records the first ETA seen for each `(crew, target)` as the mission
total, so progress = `1 − eta/startEta`. When the crew leaves REPAIRING (or
switches target), the record is dropped and re-armed on the next mission. If
the tab was hidden while a repair started, the first visible ETA becomes the
total — the ring simply runs compressed for that mission; positions and ETAs
themselves remain server-authoritative. STANDBY crews (pre-positioned,
waiting) correctly get no ring.

### Wiring

- Marker creation (once per team): truck SVG + ring SVG (track + fill
  circles) in the static innerHTML — no server strings involved.
- Per snapshot (1 Hz): `crew-repairing` class toggled on the marker div;
  the fill circle's `stroke-dasharray` set from `repairRingDasharray()`
  (k dash/gap pairs + a 0-dash and full-circumference tail so nothing past
  the k-th notch can light and the pattern never repeats).
- CSS: show/hide via opacity with a `--t-fast` fade (the global
  prefers-reduced-motion block disables the fade); track notches at 28 %
  opacity; the ring's 40 px box carries `!important` to beat the blanket
  `.app-shell .crew-marker svg { width/height: 100% !important }` rule.

### Verification

- New `components/CrewLayer.test.ts` (12 tests): progress bookkeeping
  (capture-on-enter, countdown fractions, glitch clamp, re-record on target
  change, eta-0 first sight, independent crews, clear on non-repairing
  states) and dash-pattern maths (zero lights nothing, one notch per segment,
  clamped at full, prefix growth, rounding, no repeat around the circle).
- Gates: Prettier clean; `tsc -b` clean; Vitest 20 files / 103 tests;
  `vite build` OK (163.18 kB CSS, 132.94 kB JS).
- Live API probe: repairing crews appear with ETAs counting down
  (e.g. 11 → 5 → complete), so the ring has real data to show. Served
  preview sources contain the new code. No browser here — the on-screen
  check (notches lighting as repairs run) is for the live preview / phone.

## Task F implementation (2026-10-24) — breakpoint pass, leftovers, close-out

### Leftover fixed — desktop rail still reserved a row for the removed power card

The "composition fixes" block kept the two-band row template
(`minmax(0, 1.6fr) minmax(0, 1fr)`) written for the old two-card rail. With
only the alarms card left, the incidents panel got ~62 % of the map band and
the remaining ~38 % was an empty row under it. At ≥1025 the rail now uses one
full row (`minmax(0, 1fr)` next to the existing `contain: size`), so the
panel fills the whole band the map sets — at 1920×1080 the visible incident
list roughly doubles (~3.5 rows → ~7 rows). The dead two-band line and its
stale comment were removed; `max-height: none` / `align-self: stretch` (the
"rail is one band with the map" behaviour) are untouched. Narrow widths were
already correct: ≤1024 one-card block (fixed `clamp(340px, 62vh, 460px)`),
≤767 the original fixed 400 px.

Verified no test pins broke (the WaveMascot CSS-source test still passes) and
no selector anywhere still sets a two-row template that wins: the ≥1025 rule
is the last word above 1024, the one-card block below it.

### Breakpoint verification (code-level cascade trace, 2026-10-24)

No browser exists in this sandbox — this table is traced from the final CSS
cascade; the on-screen check is the live preview.

|                          | 1920×1080                | 1440×900                | 1024×768                 | 390×844 (phone)             |
| ------------------------ | ------------------------ | ----------------------- | ------------------------ | --------------------------- |
| Navigation              | 72 px left rail          | 72 px left rail         | 64 px left rail          | bottom bar 64 px + safe area |
| Page padding (`--pad-x`) | 32                       | 32                      | 22.5                     | 16                          |
| KPI cards               | 6 × 1fr, gap 12          | 6 × 1fr                 | 3 × 1fr, gap 8           | 2 × 1fr, gap 8              |
| Map + incidents         | side by side, rail 384   | side by side, rail 331  | map above rail          | map above rail              |
| Map stage height        | 432 (40vh)               | 360 (40vh)              | 430 (42vw)               | 300 (62vw floor)            |
| Incidents panel height  | full map band (~526) — fixed this task | full band (~454) | fixed `clamp(340, 62vh, 460)` → 460 | fixed 400 px   |
| Incident list           | scrolls inside           | scrolls inside          | scrolls inside           | scrolls inside              |
| Analytics grid          | 3 cols (1.35fr/1fr/1fr)  | 3 cols                  | 2 cols                   | 1 col                       |
| Crew marker             | 30 px tile, truck centred; 40 px segmented ring while repairing — all widths | | | |
| Wave panel              | 350 px, right 22, bottom 126 | same                | same                     | 370 px, bottom 76+12+safe   |
| Towers search           | single-box input, no double border — all widths; ≤600: full width, 46 px tall | | | |
| Tap targets             | pointer:coarse floors every button at 44×44 | | | |

### Known harmless leftovers (deliberately not touched)

- `.crew-marker.crew-moving` selector is dead (the class is toggled on the
  wrapper, and `.crew-wrapper` already carries `will-change: transform`);
  zero visual impact.
- `services/crew-motion.ts` is an unused legacy module; `adapters.js` has a
  dead `towerClass` branch. Both left as-is per the no-churn rule.
- The ≤1050 nav-width (60 px) rules are superseded by the token-based
  `.app-shell` rules (72/64/0 px) — dead but harmless.

### Environment note

The sandbox restarted between tasks again (node_modules and .venv excluded
from snapshots, both servers gone). Both were rebuilt (`npm ci`, venv +
deps) and the full gate suite re-run for real afterwards: Prettier clean;
`tsc -b` exit 0; Vitest **20 files / 103 tests**; `vite build` OK
(163.16 kB CSS, 132.94 kB JS). API and Vite restarted; page and /api proxy
200; served sources contain every change from Tasks A–F.
