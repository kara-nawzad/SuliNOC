# SuliNOC — Full performance & smoothness audit

**Date:** 2026-10-30 · **Scope:** diagnosis only, no code changed
**Method:** static analysis of the working tree + live measurement of the running backend (uvicorn on this machine, one uvicorn worker, same code as the Docker image) + bundle measurement from a real `vite build`.
**Honesty note up front:** there is **no browser engine in this sandbox** (no Chromium/Firefox binary), so every *client-side rendering* claim is either a **FACT** about code/CSS/asset weight or a **SUSPICION** about magnitude. Every *server-side* number below was actually measured. Section 8 gives the exact steps to close the client-side gap.

---

## 1. PROJECT MAP

**Stack**

| Layer | What it is |
|---|---|
| Frontend | React 18.3 + TypeScript, Vite 6, `framer-motion` 12, Leaflet 1.9 + `react-leaflet` 4, `react-markdown` + `remark-gfm`, `lucide-react`, `@fontsource` fonts. Hand-written CSS (`frontend/src/styles/app.css`, 8,985 lines). No router. |
| Backend | FastAPI (Starlette 1.10) on uvicorn, single process, single worker. `autonoc/api/main.py` (1,074 lines) owns the simulation clock, sessions, controls, Wave chat. |
| Simulation | Pure-Python digital twin: `autonoc/engine/engine.py` (849 lines), 300 sites, 10 fibre rings, 10 crews, 5-minute ticks (`config.py:70`), 30-day horizon. |
| Agents | (1) **Doctor + Oracle** models in `autonoc/ai/serve.py` — XGBoost fault classifier + torch GRU failure predictor, scored on a background thread every 6 ticks. (2) **A1 Commander** `autonoc/engine/commander.py` — turns verdicts into pre-dispatch/veto actions, called from `engine.step()`. (3) **Wave** chatbot `autonoc/api/wave_ai.py` (1,073 lines) — OpenAI/Groq HTTPS, streamed; plus a deterministic offline answerer `wave_local.py`. |
| Hosting | Fly.io, `fly.toml`: **1 shared vCPU, 1,024 MB**, region `ams`, `min_machines_running = 1`. `Dockerfile` builds the SPA with Node, then runs the Python image (torch CPU + xgboost). |
| Data flow | One `GET /api/delta?since=N` every **1,000 ms** per tab (`presentation.py:36` `poll_ms`, consumed at `hooks/useTelemetry.ts:68`). `since` is **ignored** by the server. Everything else is on-demand (`/api/config`, `/api/telemetry/history`, `/api/history`, `/api/wave/*`, `/api/control/*`). |
| Views | **There is no routing.** Every "view" is a section of one long document (`App.tsx:527-573`); the left rail / phone tab bar only calls `scrollIntoView` (`App.tsx:~268`). Hero is a full-screen same-origin **iframe** (`HeroFrame.tsx`) that is opened by default (`App.tsx:903`). |

**Measured weights (real build, this machine)**

| Asset | Raw | Gzip |
|---|---|---|
| `index-*.js` (React, app, lucide icons, **react-markdown**) | 304.9 KB | 93.7 KB |
| `map-*.js` (Leaflet + react-leaflet) | 291.8 KB | 89.4 KB |
| `motion-*.js` (framer-motion) | 137.3 KB | 45.4 KB |
| `index-*.css` (app.css + 9 font faces + leaflet.css) | 170.3 KB | 35.6 KB |
| `hero-city-sunset.png` (1672×941, hero background) | **2,008,311 B** | – |
| 9 font files (Manrope ×4, Newsreader ×3, IBM Plex Mono ×2) | ~180 KB | – |

First load ≈ **904 KB of JS+CSS (≈264 KB gz) + 2 MB hero PNG + fonts**, minus the 404 (see #7).

---

## 2. TOP 10 ROOT CAUSES (ranked by user-visible impact)

### 1. Every request without a live cookie builds a whole new 30-day world — 703 ms — **on the event loop**, while every API request is serialised behind one global lock

- **Affects:** both (worse for phone: first tap after a tab sleeps / after a cookie is dropped)
- **Area:** backend / data flow
- **Evidence:**
  - `api/main.py:135` `_make_session()` → `NOCEngine(...)`; `engine.py:53-58` generates a 30-day weather timeline and fault/fibre schedules → **measured 702.7 ms** per construction.
  - `api/sessions.py:174-196` `get()`: an unknown token creates a session (`_create()`), and when the registry is full it first evicts the least-recently-seen session (grace **15 s**, `fly.toml`).
  - `api/main.py:128` `_gate = asyncio.Lock()`; `main.py:485-560` the middleware holds `_gate` across **`await call_next(request)`**, i.e. the whole endpoint runs inside the lock, for every `/api/*` path.
  - `api/sessions.py:59` only `/api/health` and `/api/wave/status` are session-free, so `/api/delta`, `/api/config`, `/api/telemetry/history` all create engines when cookieless.
- **Measurement (live):** `/api/delta` **with** a valid cookie = **5–8 ms**. **Without** a cookie = **0.67–0.98 s**, every time. Three *parallel* cookieless requests took **2.21 / 2.21 / 2.22 s** — i.e. strictly serialised. While one cookieless `/api/delta` ran, an unrelated `/api/health` request stalled from ~1 ms to **766 ms**.
- **Mechanism:** a new visitor — or any client that lost its cookie (Safari ITP/partitioned storage on the cross-site preview, a second private window, a monitor or crawler that hits `/api/*`) — freezes the single worker for ~0.7 s. During that time no dashboard polls, no map moves, no control responds, and static assets queue behind it. Bursts add up linearly; the demo also *churns* worlds (visitors get evicted after 15 s of silence and silently get a **new run at tick 0**).
- **Confidence:** **FACT** (measured).
- **Severity:** **critical**

### 2. The UI can never idle: `prb`/`vswr` change for ~299 of 300 sites every tick, so all 300 map markers and all 300 table rows re-render every second

- **Affects:** both (much worse on phone: ~2,100 DOM updates/s + one full canvas repaint)
- **Area:** frontend rendering / data flow
- **Evidence:**
  - `NetworkMap.tsx:250-271` `sameSiteNodes()` compares `id, lat, lon, status, warn, vswr, prb`; `NetworkMap.tsx:325-333` uses it as the `Towers` memo comparator. `TowerList.tsx:10-35` `sameTowerRows()` compares `id, status, prb, cqi, ring, cluster`.
  - `hooks/useTelemetry.ts:55` `setData(next)` replaces the whole snapshot object every poll, so every array identity is new.
  - **Measured on two consecutive real ticks (300 sites):** `prb` changed **298/300**, `vswr` **137/300**, `throughput` 290/300, `rsrp` 295/300. Map slice changed **299/300**; tower row slice changed **298/300**.
- **Mechanism:** both comparators were added by the earlier audit (`docs/MAP_PERF_AUDIT_2026-10.md`) to skip no-op ticks, but in practice *no tick is a no-op*. So every second React re-renders 300 `TowerMarker` components (each producing 2–3 `CircleMarker` layers **and a tooltip**, `NetworkMap.tsx:203-247`), Leaflet re-styles ~600 canvas arcs and coalesces them into one full-canvas repaint (`leaflet-src.js:12776` `_requestRedraw` → one rAF redraw), and the towers table re-sorts and re-diffs **300 rows ≈ 2,100 elements** (`TowerList.tsx:112-140`). That burst lands once per second, on top of the crew rAF animation.
- **Confidence:** **FACT** (change rates measured); magnitude on-device is a SUSPICION → confirm with a DevTools Performance recording (scripts + rendering for a 5 s window).
- **Severity:** **critical**

### 3. The 1 Hz payload is a complete snapshot — 146–173 KB — of which almost everything is unused by the view that is on screen

- **Affects:** both (mobile data / battery heavy)
- **Area:** data flow / backend contract
- **Evidence:** `main.py:863-879` `_snapshot()` always sends `nodes` (**138.1 KB**, 30 fields × 300), `rings` (9.2 KB, including each ring's full `node_ids` array), `logs` (8.4 KB, last 60 entries), `dashboard.history` (30 samples, ~7 KB), `teams`, `agg`. `main.py:887-897` `/api/delta` **ignores `since`** and always returns `resync=True`.
- **Measured:** tick 0 → 132.5 KB (7,399 B gz); tick 33 → **146,056 B (17,484 B gz)**; tick 94 → **173,172 B**. That is **≈17.5 KB/s ≈ 63 MB per hour per open tab** over the wire (and every second keeps the phone radio awake).
- **What is actually needed:** the map + table + KPI slice of a node is 11 fields → **45.6 KB** (measured). `rings[].nodes` is used only for `r.nodes.length` (`NetworkMap.tsx:1152`, `SimControls.tsx:229`) and `logs` only inside the Activity dialog (`HistoryModal.tsx:136`), which is closed most of the time.
- **Mechanism:** ~100 KB/s of dead bytes plus a fresh 300×30 object tree that defeats every downstream memo (see #2). `JSON.parse` itself is cheap (**0.58 ms** measured) — the cost is the object churn and the React/canvas work it triggers, not the parse.
- **Confidence:** **FACT** (sizes/timings measured); the "unused fields" claim is FACT from the usage grep.
- **Severity:** **high**

### 4. 300 site tooltips are re-rendered every second, although at most one can ever be visible

- **Affects:** both
- **Area:** frontend rendering
- **Evidence:** `NetworkMap.tsx:236-246` — every `TowerMarker` renders `<Tooltip>` with four live values (`status`, `vswr.toFixed(2)`, `prb.toFixed(1)`) inline; `NetworkMap.tsx:160` memo keeps the component but the comparator fails every tick (#2), so the tooltip JSX is rebuilt 300×/s.
- **Mechanism:** react-leaflet renders tooltip children into a portal container and calls Leaflet's `setContent` on change → ~300 DOM subtree updates per second for content that only matters on hover/press. On a phone the tooltip is not even reachable (no hover).
- **Confidence:** **FACT** (code path); exact ms cost is a SUSPICION.
- **Severity:** **high**

### 5. Nothing is ever idle: continuous paint-bound CSS animations + 12 SVG path (`d`) interpolations per second

- **Affects:** phone primarily (GPU/raster bound), laptop secondary
- **Area:** frontend rendering / CSS
- **Evidence:**
  - `.fiber-flow` `animation: fiberFlow 18s linear infinite` animating **`stroke-dashoffset`** on all 10 ring polylines (`app.css:846-848`, keyframes `app.css:2550`). Paint-bound: the 190-point polylines must be re-rasterised every frame, forever.
  - `.cut-segment` / `.cut-pulse` add `filter: drop-shadow(...)` plus a 1.8 s opacity loop (`app.css:851-855`, `3168`); `.predictive-pulse` does the same; the Core marker pulses with a `drop-shadow` glow (`app.css:8648-8652`).
  - Each KPI card animates **two** `motion.path` `d` strings over 0.6 s **every second** (`ui.tsx:133-147` called from `KpiGrid.tsx:105-110`) → 6 cards × 2 paths = 12 path interpolations running back-to-back ≈ 430 `d` attribute writes/s, each invalidating a path.
  - `AnalyticsRow.tsx:66-69` animates `width` on 4 load bars (layout-bound, not transform).
  - `AnalyticsRow.tsx:97-108` animates `strokeDasharray` with a spring.
- **Mechanism:** these animations are mostly well chosen (transform/opacity) and they *do* pause when the map is being panned (`app.css:2572-2581`, `.map-interacting`) or the tab is hidden — but the fibre-flow/dash/shadow family is paint work that never stops while the tab is visible, and it competes with the 1 Hz render burst (#2) and the 1 Hz canvas repaint.
- **Confidence:** FACT for the CSS/JS; the frame cost is a SUSPICION → measure with DevTools Performance "Rendering" + paint-flashing on a throttled phone profile.
- **Severity:** **high** (phone)

### 6. Two full-width `backdrop-filter: blur(14px) saturate(1.3)` layers sit over a very tall scrolling document

- **Affects:** phone primarily
- **Area:** layout / CSS
- **Evidence:** sticky header `.app-shell .global-header { position: sticky; backdrop-filter: blur(14px) saturate(1.3) }` (`app.css:5288-5305`); phone tab bar `.app-shell .navigation-rail` is `position: fixed` full-width with the same blur (`app.css:6123-6135`); the site inspector drawer is `position: fixed` with **`backdrop-filter: blur(30px)`** and a 65 px shadow (`app.css:1801-1813`); modal backdrops add more (`app.css:1908`, `1982`).
- **Mechanism:** while scrolling (the page is one document with a 40vh Leaflet canvas map, a 300-row table, charts and infinite animations inside it), the compositor must re-sample a 14 px blur of the moving background every frame, on every scrolled pixel. This is the classic "smooth on a laptop, stutters on a mid-range phone" pattern, and there are two such layers stacked at all times on phones.
- **Confidence:** **SUSPICION** (CSS is a FACT; cost must be confirmed by recording scroll on a throttled device, or by temporarily removing the blurs and re-measuring — no code change needed to test, devtools "Rendering → paint flashing" + Performance).
- **Severity:** **high** (phone)

### 7. The first thing a phone downloads is a 2 MB PNG that is preloaded from a URL that does not exist; then the whole app is downloaded before the user has entered

- **Affects:** both (worst on first visit / slow network)
- **Area:** build / assets
- **Evidence:**
  - `frontend/index.html:8-11` → `<link rel="preload" as="image" href="/assets/hero-city-sunset.jpg" fetchpriority="high">`, but the file is **`hero-city-sunset.png`**. Verified live: `/assets/hero-city-sunset.jpg` → **404**. So the preload does nothing except waste a round trip and log a console warning.
  - `hero-city-sunset.png` is **2,008,311 B**, 1672×941, PNG (no WebP/AVIF, no `srcset`), used full-bleed by the hero iframe (`public/assets/hero-source.html`).
  - `App.tsx:903` starts with `heroOpen = true`, `HeroFrame.tsx:75-88` renders a **same-origin iframe** for the welcome screen and `App.tsx:286` returns `null` for the console until Enter is pressed — yet `main.tsx` has already statically imported `App`, so the whole 734 KB of JS is fetched/parsed up front anyway.
  - No route-level or feature-level code splitting: `vite.config.ts:24-31` only manual-chunks `leaflet` and `framer-motion`. `react-markdown` **125 KB minified** alone is in the main chunk (measured in isolation) and is only needed when Wave answers; `WaveChat` is statically imported at `App.tsx:44` and mounted at `App.tsx:894`.
  - After Enter, the iframe stays mounted forever (only `#hero.off { visibility: hidden }` inside it, `hero-source.html:90-94`), keeping a 1672×941 decoded bitmap in memory.
- **Mechanism:** on a mid-range phone over 4G the welcome screen alone is ~2 MB + 4 fonts; the console payload is ~264 KB gz of JS + 36 KB gz CSS + 9 font files, all before the first `/api/delta`. Perceived "it takes ages to get in, then it's janky" has two separate causes and this is the first one.
- **Confidence:** **FACT** (404 verified, sizes measured).
- **Severity:** **high**

### 8. One 1 Hz state update re-renders the entire console tree; almost every panel lacks a memo boundary

- **Affects:** both
- **Area:** frontend rendering
- **Evidence:** `App.tsx:527-573` mounts `KpiGrid`, `NetworkMap`, `AlertsSidebar` (×2), `AnalyticsRow`, `TowerList`, `WaveChat` unconditionally inside `Console`, and `Console` owns `const { data } = useTelemetry()` (`App.tsx:73`), so `data` changing re-renders all of them every second. Only **three** components have comparators: `TowerList` (defeated, #2), `Towers` (defeated, #2) and the inner map layers (`FiberOverlays`, `PredictionPulses`, `CoreLinks`). `KpiGrid.tsx:15`, `AnalyticsRow.tsx:9`, `TrafficQualityCard.tsx:43`, `AlertsSidebar.tsx:23`, `SimControls.tsx:19`, `Inspector.tsx:26`, `NetworkMap.tsx:760` are plain functions.
- Also recomputed on **every** render regardless of need: `App.tsx:311-313` rebuilds the palette `theme` object; `App.tsx:314-321` runs a 300-node `filter` with an `agg_sites.find()` inside it **even when the search dialog is closed** (0.323 ms measured — small, but it should not run at all).
- **Mechanism:** each tick is a whole-tree reconciliation instead of a few leaf updates; the panels that *do* show per-tick values (KPIs, charts) are cheap, but the ones that don't (towers, alerts rail shell, analytics layout) pay the same price.
- **Confidence:** **FACT** (code), magnitude SUSPICION.
- **Severity:** **medium-high**

### 9. Both charts are fully redrawn every second, and on a 7-day window that is a ~2,000-point path rebuild per tick (plus a ~480 KB download)

- **Affects:** both; worst when someone leaves the chart on 7 d
- **Area:** frontend rendering / data flow
- **Evidence:** `TrafficQualityCard.tsx:162-176` runs on every tick (its deps include `samples`, which is a new array each poll because `data.tick`/`data.dashboard.history` change): it calls `setWindow()` and `setDomain()` **unconditionally**, and each of those schedules a draw (`charts.js:180-191`). `charts.js:61-160` `draw()` rebuilds the **axis group with `g.innerHTML = ...`** and the whole polyline `d` string from scratch. For the default `30m` window it *also* calls `setData()` every tick (`TrafficQualityCard.tsx:172`), by design.
- The 7 d window requests 2,017 samples (`main.py:906-918`, `minutes // TICK_MINUTES + 1`); measured sample size ≈ 0.24 KB → **≈480 KB** response, and the path string is rebuilt (twice: traffic + drop) on every draw.
- **Confidence:** **FACT** for the code path and the sample math; the on-device cost is a SUSPICION.
- **Severity:** **medium-high** (a "leave it on 7 d and the whole app gets worse" bug)

### 10. One engine + one inference thread per browser session on a **single shared vCPU**, each thread waking 4×/s, plus batch scoring of 300 sites every 6 ticks

- **Affects:** both, at load (the demo is a public page; 16 tabs is the cap)
- **Area:** backend / agents
- **Evidence:** `fly.toml` → `cpus = 1`, `cpu_kind = "shared"`, `memory_mb = 1024`, `AUTONOC_MAX_SESSIONS = "16"`. `sessions.py:113-167` gives every session its own `NOCEngine`, a `threading.Lock`, a `History` and an `InferenceWorker` thread (`main.py:135-150`). `serve.py:232` — the worker loops `while not self._stop.wait(0.25)`, i.e. **4 wake-ups/s per session = 64/s at 16 sessions**, all contending for the GIL with the simulation loop and the HTTP worker thread. When AI is on, `serve.py:247` runs a batch over all 300 nodes (`_score_batch` → XGBoost + torch GRU, `serve.py:285-298`) every 6 ticks (30 s of sim time at 1×, 3 s at 10×).
- Measured: `engine.step()` = **1.87 ms**; one live server with ~13 sessions sat at **213 MB RSS** and ~8 % CPU while idle-looking.
- **Mechanism:** at 1× with one viewer this is fine. With 10–16 viewers (or one viewer at 10× plus the model batch) the single vCPU is shared by 16 stepping engines, 16 polling threads and torch inference — the sim loop's `STEP_TIMEOUT_S = 30 s` guard (`main.py:131`) exists precisely because that has been a risk. Inference and engine work also compete with request handling, so polls get slower exactly when the app looks busiest.
- **Confidence:** FACT for the architecture; the inference cost per batch is a **SUSPICION** — torch/xgboost are not installed in this sandbox, so I could not time `_score_batch`.
- **Severity:** **medium** (critical under a crowd)

---

## 3. PER-VIEW FINDINGS

Remember: "views" are scroll sections of one always-mounted document; the rail only scrolls.

### 1. Hero (welcome) — `HeroFrame.tsx`, `public/assets/hero-source.html`
- **First load:** 2 MB PNG + its own 3 font files + 14.7 KB HTML inside an iframe, while the 734 KB console bundle downloads in parallel. **Phone: the slowest thing in the product.** (FACT)
- **Preload bug:** `index.html:8-11` preloads `hero-city-sunset.jpg`, which 404s; the real `.png` is only discovered when the iframe HTML parses → hero image starts late, and the console logs a preload warning. (FACT, verified 404)
- **After entering:** the iframe is never unmounted (`App.tsx:903-907`, hidden via a class *inside* the iframe document) → a 1672×941 decoded bitmap plus a whole extra document stay alive. (FACT)
- **Layout:** fine — fixed inset 0, `z-index 1200`, no scroll traps. (checked)

### 2. Overview (greeting, command bar, KPI grid) — `App.tsx:452-527`, `KpiGrid.tsx`
- **Phone:** KPI grid is 2 columns (`app.css:3010-3014`) → 6 cards ≈ 3 screens of scrolling before the map; each card carries a long `kpi-note` sentence. Nothing is broken, but the first meaningful data (the map) is pushed far down. (FACT: CSS; layout judgement)
- **laptop:** 6 columns (`app.css:657-662`), tight but readable; the greeting is `Newsreader` at display size.
- **Rendering:** 6 × `NumberTween` (good: text-only rAF, `NumberTween.tsx:28-48`) **plus 12 `motion.path` `d` animations per second** (#5). `NumberTween` is the model to copy — it never re-renders React.

### 3. Topology ("Live network" map + topology panel) — `NetworkMap.tsx`
- **Phone:**
  - Map stage is `clamp(345px, 40vh, 510px)` with `min-height` floors down to `290px` (`app.css:792-798`, `3198-3200`, `6265`, `6447`, `8466`): on a 640 px-tall viewport the map plus sticky header plus bottom bar leaves ~45 % of the screen for content.
  - **Scroll trap:** Leaflet's touch-drag uses `touch-action: none` on the map container (`leaflet` css), so a vertical swipe that starts on the map scrolls nothing. In a long page that reads as "the app froze". (FACT in CSS; UX cost is a SUSPICION → test on a phone.)
  - 300 sites on one canvas + 300 tooltips re-rendered per second (#2, #4); 10 fibre polylines repainted at 60 fps (#5).
  - Esri raster tiles are fetched from `server.arcgisonline.com` on every pan/zoom (`TileBasemap.tsx:16-18`): a third-party dependency and ~12–20 tile requests per screen on mobile data. There is a graceful fallback to the schematic basemap after 4 failures (`TileBasemap.tsx:40-52`) — good.
- **laptop:** same per-tick work; pan/zoom is where it shows. `zoomSnap: 0.1` + `scrollWheelZoom` (`NetworkMap.tsx:864-873`) produces fractional zooms and extra tile rescaling per gesture.
- **Good:** markers are created once and moved (`CrewLayer.tsx:227-245`), crews move on rAF, off-screen/hidden animations pause, canvas renderer padding was already trimmed to 0.15 — that earlier audit's fixes are in place and working.

### 4. Tower detail (Site inspector drawer) — `Inspector.tsx`
- **Both:** only mounted when a site is selected, and animated with a spring on `x/opacity` (compositor-friendly). But it is `position: fixed` with **`backdrop-filter: blur(30px)`** over the animating map (`app.css:1801-1813`) — the single most expensive surface in the app while open. Its readings (RangeGauges) also update every tick while open.
- **Phone:** becomes a near-full-width sheet (`app.css:5103`) covering the map; because the map keeps rendering underneath, the blur samples a canvas that is repainting 1×/s plus fibre animation at 60 fps.
- **laptop:** 330 px slide-over, fine.

### 5. Incidents (alarms rail) — `AlertsSidebar.tsx`
- **Both:** `AnimatePresence mode="popLayout"` around the alarm list (`AlertsSidebar.tsx:~115`) — `popLayout` measures and re-positions siblings on every enter/exit; combined with a list whose data identity changes every second this is the most layout-shifting animation in the app. `aria-live="polite"` on a 1 Hz list is also chatty for screen readers.
- **Tablet (≤1024 px):** the rail becomes a 2-column grid (`app.css:6133-6138`), which is fine.
- **Phone:** single column, panel `max-height: calc(clamp(345px, 40vh, 510px) + 93px)` originally designed to match the map; on a short phone that consumes a full screen.

### 6. AI predictions (Oracle outlook + A1 Commander) — `AnalyticsRow.tsx:76-155`, `AlertsSidebar.tsx` (`part="commander"`)
- **Both:** the radial forecast gauge is a spring on `strokeDasharray` (`AnalyticsRow.tsx:97-108`) → paint work per frame; the card's content changes height when a forecast/pending action appears (layout shift in a grid row that shares height with the chart card).
- **Phone:** the Oracle card and the Commander slot stack; the "AI off" state is a large empty area.
- **Data:** with `AUTONOC_AI=0` (the default, `main.py:97-99`) `forecast` is `null` and `ai.pending` is empty — the panel is decorative. When AI is enabled, verdicts arrive only every 6 ticks, so the "thinking" cadence is 30 s at 1×: users may read that as "nothing is happening".

### 7. Analytics (traffic & quality charts, radio load watch, power/fleet card) — `TrafficQualityCard.tsx`, `AnalyticsRow.tsx`
- **Both:** both charts rebuild their axis `innerHTML` and path each tick (#9); the 4 load bars animate `width` (#5); the 30 m window calls `setData` every tick by design.
- **Phone:** the analytics grid collapses to one column; the chart cards keep a fixed internal height, so the two charts plus the cell table make a long scroll. Chart tooltips use pointer events only (`charts.js:143`) → no tap-to-inspect on touch.
- **7 d:** ~480 KB fetch and a 2,000-point redraw per tick (#9).

### 8. Maintenance (fleet dialog, crews on the map) — `SimControls.tsx:165+`, `CrewLayer.tsx`
- **Both:** the fleet dialog is mounted only when open (good). Crew markers are created once and moved on rAF (good); the anti-stacking nudge re-projects on every zoom (`CrewLayer.tsx:146-160`) — correct but pixel-space based, so on a zoomed-out phone more crews fall inside the 24 px separation and get displaced (the "truck is a little off" symptom that was just fixed geometrically).
- Per frame, per crew: `setLatLng` does a rounded Leaflet update plus a fractional reposition (two style writes) and two `classList.toggle` (`CrewLayer.tsx:246-252`). With 10 crews this is small.

### 9. Settings / scenario dialogs — `SimControls.tsx:165`, `ui.tsx` `Modal`
- **Both:** mounted on demand, `dialog::backdrop` uses `backdrop-filter: blur(5px)`–`blur(8px)` (`app.css:1908`, `1982`) while the app keeps rendering underneath — cheap because dialogs are short-lived, but they stack on the same GPU as #6.
- No layout problems found; forms are inside a scrollable dialog body.

---

## 4. FULL ISSUE LIST (did not make the top 10)

**Backend**

1. `main.py:887-897` — `/api/delta?since=N` ignores `since`; there is no incremental/ETag protocol. *(FACT)*
2. `main.py:485-560` — the session middleware holds `_gate` across `call_next` for **every** request, including static files and HTML; one slow request (or a 0.7 s engine) blocks the whole worker. *(FACT, measured)*
3. `main.py:212-222` — `_activate`/`_deactivate` swap **module globals** (`engine`, `_lock`, `_history`, `worker`, `_run_id`, …) per request. Correct only because of `_gate`; any code touching those globals outside the gate is a latent race. *(FACT)*
4. `main.py:312-346` — `_step_locked` runs `History.record()` and, at Day 30, `RunSummaryStore.save()` (SQLite `BEGIN IMMEDIATE`, 10 s busy timeout, `run_history.py:38-77`) inside the engine lock; the async control handlers take the same `threading.Lock` directly (`main.py:951-1057`) — i.e. a blocking wait **on the event loop** during a reset. *(FACT)*
5. Session eviction is silent: `sessions.py:174-196` gives an evicted client a brand-new engine/run_id instead of a signal; the client sees the world reset to Day 1 (and `App.tsx:100-120` resets selection/scroll state). *(FACT)*
6. `presentation.py:110-135` — `History` is a `deque(maxlen=2017)` per session ≈ 2 MB; `logs` `deque(maxlen=500)`. Both bounded (good, no leak) but they multiply by 16 sessions. *(FACT)*
7. `/api/telemetry/history` builds a fresh list of up to 2,017 dicts per request (`main.py:899-918`) and reuses no cache; ~480 KB response. *(FACT, extrapolated from 0.24 KB/sample measured)*
8. GZip compresses assets **per request** with no cached variant (Starlette 1.10 `GZipResponder`); measured 14.9 ms CPU for the 305 KB JS, per cold request. Minor but it is on the request path on a shared vCPU. *(FACT)*
9. `main.py:407-434` — startup imports/constructs one engine (0.7 s) at module import and loads torch+xgboost models on a background thread. On a 1 vCPU Fly machine this is a multi-second cold start after a deploy (models are 2.5 MB XGBoost JSON + 72 KB GRU, but torch import alone is seconds). *(SUSPICION — torch not installable here)*
10. `sessions.py:59` — only `/api/health` and `/api/wave/status` are session-free, so any crawler/monitor that touches `/api/config` or `/api/delta` creates a full engine. *(FACT)*

**Frontend**

11. `App.tsx:314-321` — the search filter (300 nodes × 10 districts) runs on every render even with the dialog closed (0.323 ms measured). *(FACT)*
12. `App.tsx:311-313` — a new `theme` style object per render on the root `.app-shell`. *(FACT, cheap)*
13. `NetworkMap.tsx:760` — `NetworkMap` itself is not memoized; it recomputes `clusterHealth` and `ringAffected` over 300 nodes per tick (~0 imperceptible, but it also re-renders `MapTools` and re-creates `TileBasemap`'s `eventHandlers` object each tick). *(FACT)*
14. `NetworkMap.tsx:864-873` — `zoomSnap: 0.1` + `scrollWheelZoom` → fractional zoom churn (more tile rescales per gesture). *(FACT)*
15. `charts.js:61` — `host.innerHTML = ...` on chart creation, and `g.innerHTML` on every draw: full axis DOM replacement, no diffing. *(FACT)*
16. `charts.js:143-160` — tooltips are pointer-only; no touch equivalent. *(FACT)*
17. `TrafficQualityCard.tsx:86-121` — `setLongHistory([])` + refetch whenever the run id changes; a silent session reset therefore re-downloads the window. *(FACT)*
18. `useTelemetry.ts:57-73` — no exponential backoff: on a failing backend each attempt waits the 15 s `AbortSignal.timeout` (`services/api.ts:74-80`) and the next fires immediately; the UI shows "RECONNECTING" with **no elapsed-time feedback**. *(FACT)*
19. `services/api.ts:74-127` — the 15 s timeout is longer than the 1 s poll; a dead backend therefore leaves the dashboard in "reconnecting" for 15 s before the first retry is even attempted. *(FACT)*
20. `WaveChat.tsx` — always mounted (`App.tsx:894`) and pulls `react-markdown` (125 KB min) into the main chunk; the launcher runs 7 infinite CSS animations (`app.css:7441-7478`) that are **not** included in the `.tab-hidden` pause list (`app.css:2572-2581`). *(FACT)*
21. `ui.tsx:110-150` — 2 animated paths per sparkline per second; the "d" animation cannot be interpolated meaningfully anyway (the points are different data), so it is cost without benefit. *(FACT / design opinion)*
22. `AlertsSidebar.tsx:~115` — `AnimatePresence mode="popLayout"` on a 1 Hz list. *(FACT)*
23. `Inspector.tsx:53-66` — a spring-animated fixed panel over a live map with a 30 px backdrop blur. *(FACT)*
24. `app.css` — 53 `@media` blocks across 12 distinct breakpoints (380/480/600/767/800/900/1024/1050/1100/1280/1360/1440/1700) in a 8,985-line file: layout reasoning is hard and overrides collide (e.g. `.tower-row` declares 5 columns at `app.css:3306` and 6 at `app.css:8885`). Not a runtime bug — a maintenance/layout-risk finding. *(FACT)*
25. `index.html:8-11` — preload 404 (`.jpg` vs `.png`). *(FACT, verified)*
26. `HeroFrame` iframe stays mounted after entering. *(FACT)*
27. Fonts: 9 `@fontsource` CSS imports in `main.tsx:3-13` (Latin only, `font-display: swap` — checked in the built CSS) → 9 font faces declared, ~180 KB if all weights are used. *(FACT)*
28. `main.tsx:52-57` — `React.StrictMode` double-invokes render in **dev** only; the deployed build is unaffected. *(FACT — worth knowing so dev-mode lag is not mistaken for production lag)*
29. No virtualization for 300 tower rows (`TowerList.tsx:112`) — the table scrolls inside `max-height: clamp(320px, 44vh, 560px)` but all 300 rows are laid out. *(FACT)*
30. `.inspector` / `dialog::backdrop` blurs stack with the header/tab-bar blurs. *(FACT)*

**Agents**

31. `serve.py:232` — 4 wake-ups/s per session forever (even with AI disabled, it still checks `source.ai_enabled` under the engine lock 4×/s — a lock acquisition per wake-up). *(FACT)*
32. `wave_ai.py:34-37, 105-148` — Wave rate limiting and key verification state are **module globals** shared by all sessions; a single provider key is used for everybody. *(FACT)*
33. `wave_ai.py:1007-1012` — one new OS thread per streaming chat request. Bounded by the rate limiter (20/min/session, 180/min global) — acceptable. *(FACT)*
34. `wave_ai.py:742-756` — up to an 18,000-character JSON context is rebuilt and re-serialised **per message**, including a `copy.deepcopy` of the whole snapshot (`main.py:534-540`). Measured: snapshot 2.66 ms, deepcopy 3.73 ms, context build 0.43 ms — small, but it happens under `_gate`+`_lock`. *(FACT)*
35. Wave provider calls **do** run off the loop (`wave_ai.py:847-849`, `asyncio.to_thread`) with a timeout and a local deterministic fallback (`main.py:552-590`). This is correct — do not "fix" it. *(checked, good)*
36. Agent results are not cached: `_score_batch` re-scores all 300 nodes every 6 ticks even if no input changed materially. *(FACT)*

---

## 5. QUICK WINS vs STRUCTURAL PROBLEMS

### Quick wins (small, safe, measurable — each can land on its own)
- **Fix the hero preload**: point it at `hero-city-sunset.png` (or drop the preload), and compress the image to WebP/AVIF (~60–120 KB instead of 2,000 KB). `index.html:8-11`, `public/assets/`. *No behaviour change.*
- **Unmount the hero iframe after entering** (`App.tsx:903-907`): frees the 6 MB decoded bitmap and one document.
- **Stop rendering site tooltips per tick**: render the `<Tooltip>` only for the selected/hovered site, or move the values to a canvas hit-test popup. `NetworkMap.tsx:236-246`. *Biggest single per-tick DOM win for #4.*
- **Trim the delta payload**: drop `logs` from the 1 Hz snapshot (fetch on demand for the Activity dialog), send `ring.nodes` as a count, send `dashboard.history` only the newest sample or move it behind `/api/telemetry/history`. `main.py:863-879`. *−16 KB raw/s and a smaller object tree.*
- **Make the tower/map comparators meaningful**: round/quantise the noisy fields (`prb`, `vswr`) before comparing, or compare on a rendered-string basis (e.g. `prb.toFixed(1)`), so a tick that changes nothing *visible* really does skip. `TowerList.tsx:10-35`, `NetworkMap.tsx:250-271`.
- **Remove the sparkline `d` animations** (or animate opacity only) — `ui.tsx:133-147`.
- **Lazy-load `react-markdown`** with `React.lazy` + `Suspense` inside `WaveChat` so the 125 KB leaves the main chunk. `WaveChat.tsx:12-14`.
- **Add `will-change`/`contain` hygiene** on the two blurred fixed layers, or drop the blur to `backdrop-filter: none` on `(max-width: 767px)` and re-measure scroll smoothness.
- **Add `/api/config`, `/api/delta`-style paths to `SESSION_FREE_PATHS`** — or better, make cookieless `/api/*` traffic fall back to the shared engine (`_shared_session()`) instead of creating an engine. `sessions.py:59`, `main.py:141-160`. *Kills #1 for monitors/crawlers.*
- **Surface "session restarted" to the user** when a run id changes under them (`App.tsx:100-120` already half-does this) so an eviction does not look like a glitch.

### Structural problems (bigger rework; list what depends on them)
- **S1 — Split the 1 Hz monolith state.** A per-slice store (or context selectors) so the KPI grid, map, table, alerts and charts subscribe to what they render. *Depends on:* the snapshot contract (`app.tsx`/`useTelemetry` types), every component's props, and the memo comparators — all of which would be simplified or deleted. *Blocks:* any further meaningful per-tick optimisation.
- **S2 — Make the transport incremental.** Honour `since` (send deltas/newest-only) or add a WS/SSE stream that pushes changed nodes. *Depends on:* the whole `Snapshot` type, `useTelemetry`, `validateSnapshot`, the e2e stub, and the `resync` semantics documented in `main.py:1-14`. High blast radius, biggest payoff.
- **S3 — Take engine construction off the request path**: pre-build a pool of engines at boot, or build new sessions in a thread with a "warming up" response. *Depends on:* `sessions.py` factory contract, `_make_session`, and the reset path (`main.py:262-310`). This is the fix for #1 and it is independent of S1/S2.
- **S4 — Remove the global `_gate`/global-mutation model** in favour of per-session objects passed explicitly (or `contextvars`). *Depends on:* every endpoint in `main.py` that reads `engine`/`_run_id`/`_history` module globals, plus `_activate`/`_deactivate` and the simulation loop. **Fragile** — the simulation, controls and session semantics all ride on it.
- **S5 — Route-level code splitting + a real mobile map budget** (defer the map bundle until the map is near the viewport; AVIF hero; subset fonts). *Depends on:* `vite.config.ts`, `index.html`, and the hero iframe timing.
- **S6 — Cap animation cost on small screens**: no `stroke-dashoffset` flow on phones, no drop-shadow pulses, fewer concurrent mascot animations; behind a media query. *Depends on:* nothing — but it changes visuals, so it needs a design decision.

---

## 6. DEPENDENCIES AND RISKS

**Order constraints**
- S3 (off-thread engine creation) is independent and should go first: it is contained in `main.py`/`sessions.py` and removes the worst stall.
- S1 (slice subscriptions) must precede S2 (incremental transport) in terms of *thinking*, but S2 can be shipped behind the existing full-snapshot code path: keep `resync=true` as a fallback, add a delta mode, and only switch the client when merges are proven by tests (`frontend/src/components/telemetrySlices.test.ts` is the right place).
- The payload trims (quick wins) are compatible with both and give immediate relief.
- Do **not** touch `crew-motion.js`/`CrewLayer.tsx` motion semantics while touching the map layer: they share the marker pane and the rAF loop, and there are per-frame timing tests (`src/crew-motion.test.ts`, `services/crew-motion.test.ts`).

**Fragile areas — extra care**
- **Simulation determinism.** `engine.py:40-115` pre-draws every random event from seeded streams; `tests/` assert bit-identical runs (`I3`, `I10` in the module comments). Anything that changes step order, RNG consumption or the weather/schedule generation will break the model-accuracy tests and the counterfactual study (`reports/counterfactual_summary.json` is bundled into the frontend!).
- **Session semantics.** `_activate`/`_deactivate` mutate globals; the Wave snapshot branch and the simulation loop both rely on the exact lock ordering (`_gate` → `_lock`). Changing this without reproducing the "two tabs = 2× speed" guard will reintroduce the v1 bug documented at `main.py:1-14`.
- **The 10 fibre rings.** `FiberOverlays` is memoized on a deep `sameRingLayers` comparison including every cut path; the rings' `path` arrays are re-sent every tick from `presentation.py`, so touching ring payload shape also touches that comparator, the topology panel counts (`r.nodes.length`) and the cut/inject dialogs (`SimControls.tsx:229`).
- **The agents.** `ai_verdicts` are published by a worker thread under the engine lock and consumed inside `engine.step()`; the "publish only if the run still owns it" check (`serve.py:252-262`) is load-bearing. Speeding up or reordering inference risks stale verdicts against a fresh world.
- **Wave.** The stream path spawns a thread and bridges it with `loop.call_soon_threadsafe` (`wave_ai.py:993-1012`); the rate-limit release on error (`_release_quota`) is easy to break. The local fallback (`_wave_local_result`) is a tested user-facing guarantee — do not bypass it.

---

## 7. RECOMMENDED FIX ORDER (each item = one small task; nothing implemented)

1. **Fix the 404 hero preload and shrink the hero image** (`index.html:8-11`, `public/assets/hero-city-sunset.png` → WebP/AVIF ≤ 150 KB, keep a PNG fallback). Verify: Network tab shows one 200, no preload warning.
2. **Unmount the hero iframe once entered** (`App.tsx:903-907`, `HeroFrame.tsx`), keeping the "enter" message contract.
3. **Guard against cookieless engine creation**: serve `/api/config`, `/api/delta`… from the shared session when no token is present, or extend `SESSION_FREE_PATHS`. Verify with `curl` (no cookie): response < 20 ms and `/api/health` sessions count does not grow.
4. **Build new sessions off the event loop** (thread + "warming" response, or a pre-warmed pool). Verify: 3 parallel cookieless requests no longer serialise; `/api/health` never stalls > 50 ms.
5. **Trim the 1 Hz payload**: `logs` on demand, `ring.nodes` → count, history newest-only. Verify: `/api/delta` < 110 KB and no UI regression in the Activity dialog / topology panel.
6. **Render site tooltips only when needed** (`NetworkMap.tsx:236-246`). Verify: hover/tap still shows values; React profiler shows ~300 fewer components per tick.
7. **Quantise comparator inputs** (`TowerList.tsx:10-35`, `NetworkMap.tsx:250-271`) so "no visible change" really skips; add a unit test with a noisy node.
8. **Remove the sparkline path animations** (`ui.tsx:133-147`); keep `NumberTween`.
9. **Lazy-load `react-markdown`** inside WaveChat; confirm the main chunk drops ~125 KB.
10. **Phone animation budget**: disable `fiberFlow` dash animation, `drop-shadow` pulses and the extra mascot animations under `(max-width: 767px)` + `prefers-reduced-motion`. Measure scroll FPS before/after.
11. **Blur budget**: drop `backdrop-filter` on the phone header/tab bar (or use a solid translucent colour); re-measure scroll.
12. **Charts**: only call `setWindow/setDomain` when the value changed; for `30m`, append instead of `setData`; decimate the 7 d series to ≤ 300 points before drawing (`TrafficQualityCard.tsx:162-176`, `charts.js`).
13. **Backoff + feedback on a dead backend**: 2 s → 30 s exponential retry, and show "last update 12 s ago" (`useTelemetry.ts:57-73`).
14. **Surface session resets** explicitly (toast + reason) instead of silently swapping the world.
15. *(Structural, only after the above)* **S1 slice subscriptions**, then **S2 incremental transport**, then revisit whether 300 canvas arcs + 10 crews still need a per-second React pass at all.

---

## 8. WHAT I COULD NOT VERIFY (and how to measure it)

**Not verifiable here**
- Any rendered frame cost (no browser binary), FPS, layout/paint timings, memory of the page, Long Tasks, INP.
- Torch/XGBoost inference cost (`import torch` / `import xgboost` are not installed in this sandbox) → #10's batch cost is unmeasured.
- Cold start after a deploy (torch import + model load) — needs the real image.
- Real mobile network conditions and real device GPU for the blur/animation findings.

**Measurements that would confirm each SUSPICION**

1. **Per-tick main-thread burst (#2, #4, #8, #9).**
   Chrome DevTools → Performance → CPU 4× slowdown → record 10 s on the Overview: look for a 1 Hz pattern of Long Tasks. In the Bottom-Up view, expect `TowerMarker`, `CircleMarker`, `Tooltip`, `lineChart.draw`, `Sparkline` and Leaflet `_redraw` at the top. Record again with the map scrolled out of view (the burst should *not* shrink — that proves no off-screen culling).
2. **Payload/CPU split (#3).** Network tab → `/api/delta` → check "Transferred" (~17 KB) vs "Resource Size" (~150 KB); then in Performance, compare `JSON.parse` time against React commit time for the same tick.
3. **Animation cost (#5).** DevTools → Rendering → enable "Paint flashing" and "Frame rendering stats"; watch the map while idle. Then DevTools → Performance → 5 s recording with no interaction: expect continuous paint in the map pane (fibre dash) rather than an idle compositor.
4. **Backdrop blur (#6).** DevTools → Rendering → "Frame rendering stats" while scrolling fast on the phone; then compare with `backdrop-filter: none` applied live in the Styles pane (no code change needed) and scroll again.
5. **Session stall (#1).** `curl -s -b jar.txt -o /dev/null -w '%{time_total}\n' http://<host>/api/delta` with a valid cookie vs without; and in parallel `watch -n0.2 'curl -s http://<host>/api/health'` — the stall reproduces exactly as measured here (766 ms).
6. **Inference cost (#10).** On the deployed image (or locally with `pip install -r requirements.txt`): time `python -c "from autonoc.ai.serve import ModelBundle; ..."`, then `_score_batch()` per call, and `/api/health` `slow_ticks` while `AUTONOC_AI=1` with 4 tabs open.
7. **Cold start (#9 in the list).** `fly logs` on a fresh machine; measure from "Starting server process" to the first 200 on `/api/health`; then the first `/api/delta`.
8. **Battery/data (#3).** Chrome remote debugging on the phone → Performance monitor while the dashboard is open for 10 minutes; expect continuous network activity (1 request/s) even with no user action.

**Sanity checks I did run (so you know these are fine)**
- `engine.step()` = 1.87 ms; `/api/delta` with a valid cookie = 5–8 ms end-to-end; snapshot build = 2.66 ms; `NOCEngine()` = 703 ms.
- Crew markers are created once and moved on rAF (`CrewLayer.tsx:227-245`), motion pauses when hidden/interacting, and the reduced-motion path exists.
- Hidden-tab polling pause works (`useTelemetry.ts:35-38`), and the client aborts in-flight polls on unmount (`useTelemetry.ts:88-92`).
- Wave's provider call is off the event loop with a timeout and a deterministic local fallback (`wave_ai.py:847-849`, `main.py:552-590`); SSE is excluded from gzip so deltas are not buffered (Starlette `DEFAULT_EXCLUDED_CONTENT_TYPES`).
- `History`/`logs` are bounded deques — no unbounded growth per session.
- Hashed assets are served `immutable`; HTML/`/api` are `no-store`; ETag revalidation works (verified 304 on the 2 MB PNG).
- SSE, throttling, gzip compression of the JSON, and the 15 s client timeout are all present and behaving.
