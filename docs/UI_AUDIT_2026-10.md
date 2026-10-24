# SuliNOC UI audit — Task 1 (measure-first, no code changed)

Branch `arena/5804e69d-sulinoc` · 2026-10-23 · scope: `frontend/src/styles/app.css`
(8,564 lines, five concatenated layers) + the JSX that drives it.

**Method.** Every value below was read out of the _resolved_ cascade — the last
matching declaration per selector and per media band — then converted to rendered
pixels from the grid templates and tokens. Widths at 1920 / 1440 / 1024 / 390 are
computed, not guessed; text metrics (where a label runs out of room) are estimates
of ±8% because this sandbox has no browser binary.

**Layer order matters.** `app.css` concatenates: base (L14) → skin (L3477) →
readability (L3775) → desktop-type (L4241) → phone (L4785) → phone-layout (L5207)
→ **design layer (L5323)** → composition fixes (L6464) → wave (L7389) → my
2026-10 layout pass (L8493). Anything written before L5323 is only alive if the
design layer does not touch it. Many "current values" in the file are dead.

---

## 1. The two scales that already exist

> **Updated after Task 2:** all tokens now live in `frontend/src/styles/tokens.css`
> and `app.css` declares none. The table below records the state this audit was
> taken against (they are the same values, now centrally declared); the
> "off-scale" column is the worklist for the spacing task.

| Token                          | Value                                           | On the 4/8/12/16/24/32 grid?               |
| ------------------------------ | ----------------------------------------------- | ------------------------------------------ |
| `--sp-1 … --sp-8`              | 4 · 8 · 12 · 16 · 20 · 24 · 32                  | yes (`sp-5` = 20 breaks the 4-step rhythm) |
| `--gap`                        | 20 · 24 (≥1700) · 16 (≤1280) · 12 (≤767)        | 20 and 12 are off the 8-step grid          |
| `--card-pad`                   | 20 · **18** (≤1280) · 16 (≤767)                 | **18 is off-scale**                        |
| `--pad-x`                      | clamp(16, 2.2vw, 32) · 40 (≥1700) · 14 (≤767)   | 14 is off-scale                            |
| `--page-top` / `--page-bottom` | 20 / **48**                                     | 48 is off-scale                            |
| `--fs-*`                       | 11 · 12 · 13 · 14 · 16 · 18 · 28 · clamp(30–42) | complete, but bypassed in places           |
| `--r-sm/-md/-lg`               | 8 · 12 · 16                                     | fine (11, 15, 20 also used ad hoc)         |
| `--nav-w` / `--header-h`       | 72 / 64 · 64 (≤1024) / 56 (≤767)                | structural                                 |
| `--shell-max` / `--rail-w`     | 1760 / clamp(320, 23vw, 384)                    | structural                                 |

The problem is not the absence of a system — it is that **the system covers the
console but not the dialogs**, and ~60 legacy px values still win inside cards.

---

## 2. Frame — measured at four widths

|                    | 1920              | 1440              | 1024      | 390                 |
| ------------------ | ----------------- | ----------------- | --------- | ------------------- |
| Nav rail width     | 72                | 72                | 64        | 0 (bottom bar 64 h) |
| Header height      | 64                | 64                | 64        | 56                  |
| Page padding-x     | 40                | 31.7              | 22.5      | 14                  |
| Content width      | 1680              | 1304              | 914       | 362                 |
| Grid gap           | 24                | 20                | 16        | 12                  |
| Card padding       | 20                | 20                | **18**    | 16                  |
| KPI columns        | 6                 | 6                 | 3         | 2                   |
| KPI card / inner   | 260 / 220         | 201 / **161**     | 294 / 258 | 175 / 143           |
| Map / rail         | 1272 / 384        | 953 / 331         | 914 / —   | 362 / —             |
| Analytics          | 657·487·487 / 998 | 509·377·377 / 775 | 2 × 449   | 1 × 362             |
| Towers table inner | 1638              | 1263              | 877       | 328                 |

---

## 3. Every surface, with its current geometry

### 3.1 Chrome

| Surface          | Selector (file:line)               | Width             | Height            | Padding     | Type        |
| ---------------- | ---------------------------------- | ----------------- | ----------------- | ----------- | ----------- |
| Nav rail         | `.navigation-rail` L5511           | `--nav-w` 72/64/0 | 100vh / 64 bottom | 16px 0      | —           |
| Nav item         | `.nav-item` L5971                  | 44                | 44 (48 phone)     | 0           | icon 20     |
| Header           | `.global-header` L5526             | full − nav        | 64 / 56           | 0 `--pad-x` | —           |
| Logo             | `.brand-logo` L4125                | auto (938:358)    | 40                | —           | —           |
| Wordmark tagline | `.wordmark > span` L3867→4535      | —                 | —                 | —           | 12 (was 7)  |
| Build stamp      | `.build-stamp` L3457/4652          | —                 | —                 | —           | 12          |
| O-RAN badge      | `.header-system div` L4268         | —                 | —                 | —           | 12          |
| Greeting `h1`    | `.overview-heading h1` L5547       | —                 | —                 | —           | clamp 30–42 |
| Command bar      | `.command-bar` L5561               | —                 | —                 | 8px 0       | 12          |
| Sim controls     | `.sim-controls` L5574              | —                 | min 36            | gap 8       | 12          |
| Play buttons     | `.play-controls .icon-button` L490 | 29→30             | 26→**36**         | —           | —           |
| ROI pill         | `.roi-pill` L567/4565              | —                 | min 36            | 6 9         | 12          |

### 3.2 First screen

| Surface   | Selector           | Width                   | Height                                         | Padding     | Type                      |
| --------- | ------------------ | ----------------------- | ---------------------------------------------- | ----------- | ------------------------- |
| KPI grid  | `.kpi-grid` L5578  | content                 | —                                              | gap `--gap` | —                         |
| KPI card  | `.kpi-card` L5638  | 260/201/294/175         | min 116 (110 @1281–1440; 106 short; 112 phone) | 16 20 12    | —                         |
| KPI label | `.kpi-title` L5500 | —                       | —                                              | —           | 12                        |
| KPI value | `.kpi-value` L5674 | —                       | —                                              | —           | 30 (26 compact, 24 phone) |
| KPI unit  | `.kpi-unit` L5683  | —                       | —                                              | —           | 12                        |
| KPI note  | `.kpi-note` L5689  | —                       | —                                              | top 8       | 11                        |
| Sparkline | `.sparkline` L5695 | 64×26 (52×22, 50 phone) | —                                              | —           | —                         |

### 3.3 Live stage

| Surface         | Selector                    | Width            | Height                                   | Padding     | Type                         |
| --------------- | --------------------------- | ---------------- | ---------------------------------------- | ----------- | ---------------------------- |
| Map panel       | `.map-panel` L5627          | 1272/953/914/362 | rail-driven                              | 0           | h2 18                        |
| Panel heading   | `.panel-heading` L5608      | —                | min 56                                   | 16 20 12    | h2 18, eyebrow 11            |
| Map stage       | `.map-stage` L813 + L6622   | —                | height 345→510 / min 360–560 / 420 phone | —           | —                            |
| Map note        | `.note` L5630               | —                | —                                        | 0 20, mb 12 | 12                           |
| Map footer      | `.map-footer` L1094         | —                | min **42**                               | 12 20       | 11                           |
| Alerts rail     | `.alerts-rail` L6568, L8650 | 384/331          | stretch                                  | gap 20      | —                            |
| Incidents panel | `.alarms-panel` L1138       | —                | 100% (400 fixed phone)                   | —           | —                            |
| Rail subhead    | `.rail-subhead` L6587       | —                | —                                        | 0 20 8      | 11 / select 12               |
| Incident row    | `.incident` L5855           | —                | —                                        | 12 20       | title 12, target 12, meta 12 |
| Incident icon   | `.incident-icon` L1203      | 26               | 26                                       | r7          | —                            |
| Rail footer     | `.rail-footer` L5859        | 100%             | min 44                                   | 12 20       | 12                           |

### 3.4 Analytics

| Surface        | Selector                  | Width             | Padding              | Type     |
| -------------- | ------------------------- | ----------------- | -------------------- | -------- |
| Grid           | `.analytics-grid` L6673   | 1680/1304/914/362 | gap `--gap`          | —        |
| Traffic card   | `.traffic-card`           | 657/509/full/full | inner 20             | h2 18    |
| Chart summary  | `.chart-summary` L1500    | —                 | **1px** 20 0         | 22 + 12  |
| Chart title    | `.chart-title` L5800      | —                 | —                    | 14       |
| Chart note     | `.chart-note` L3389       | —                 | —                    | 12 (red) |
| Provenance     | `.chart-provenance` L8591 | —                 | 12 20 **11**         | 11       |
| Cells card     | `.cells-card`             | 487/377           | inner 20             | h2 18    |
| Cell head      | `.cell-table-head` L1574  | 1fr 50 24, gap 14 | 6 20 1               | 11       |
| Cell row       | `.cell-row` L1588         | same              | 10 20                | 12 / 12  |
| Load bar       | `.load-bar` L1632         | 50 × 2            | —                    | —        |
| Oracle card    | `.oracle-card`            | 487/377           | inner 20             | h2 18    |
| Radial gauge   | `.radial-wrap` L1660      | 180 max           | 138                  | —        |
| Threshold chip | `.oracle-threshold` L1712 | —                 | 10 **8**             | 12       |
| Commander      | `.policy-panel` L6861     | —                 | 0 (in combo)         | h2 18    |
| Intent card    | `.intent-card` L1342      | —                 | **10**, mb **9**, r8 | p 12     |
| Power card     | `.power-card`             | 998/775/full      | inner 20             | h2 18    |
| Donut          | `.donut-wrap` L4192       | 112               | 112                  | —        |
| Power legend   | `.power-legend` L8626     | strip ≥768        | gap 8/20             | 12       |
| Fleet bar      | `.fleet-summary` L1788    | 100%              | 12 20                | 12       |

### 3.5 Towers

| Surface | Selector               | Width            | Height                 | Padding   | Type         |
| ------- | ---------------------- | ---------------- | ---------------------- | --------- | ------------ |
| Panel   | `.towers-panel` L5730  | content          | —                      | bottom 16 | h2 18        |
| Toolbar | `.towers-tools` L5736  | —                | —                      | 0 20 12   | 11           |
| Search  | `.towers-search` L5742 | 340 max          | 36 (46 phone)          | 0 12      | 13           |
| Table   | `.tower-table` L5784   | content − 40     | max 320–560 (380 ≤767) | —         | —            |
| Head    | `.tower-head` L7036    | 1.2/1.4/.8/.6/.6 | —                      | 9 14      | 11           |
| Row     | `.tower-row` L7027     | same             | min **40**             | 9 14      | 14 / mono 13 |

### 3.6 Overlays

| Surface       | Selector                      | Width                     | Height                    | Padding   | Type                  |
| ------------- | ----------------------------- | ------------------------- | ------------------------- | --------- | --------------------- |
| Inspector     | `.inspector` L1832            | 330 fixed                 | auto                      | **17** 20 | h2 20, h3 12, body 13 |
| Modal         | `.dialog` L1925               | 460 / 780 wide            | max 85vh                  | 0         | h2 19                 |
| Dialog body   | `.dialog-content` L1940       | —                         | —                         | **25**    | p 16                  |
| Dialog intro  | `.dialog-intro` L1960         | —                         | —                         | mb **22** | 16                    |
| Impact dialog | `.dialog.impact-dialog` L2004 | 1040                      | max 90vh                  | 24        | —                     |
| Impact table  | `.impact-table` L2109         | min 700 (scrolls)         | —                         | 11 12     | 12                    |
| History row   | `.history-row` L2185          | 85/65/1fr                 | —                         | 14 0      | 9 / 10                |
| Run summary   | `.run-summary-card` L2235     | —                         | —                         | 16        | 7–11                  |
| Fleet card    | `.fleet-card` L2331           | 2-col                     | —                         | **15**    | 11 / 8                |
| Search field  | `.search-field` L2374         | —                         | —                         | **11**    | 12                    |
| Settings      | `.settings-info` L2470        | 1fr 1fr                   | —                         | 20 0      | 16                    |
| Toast         | `.toast` L2511                | max-content               | —                         | 12 14     | 11                    |
| Wave panel    | `.wave-panel` L7877/8380      | min(390 / 400, vw−32/−20) | min(630/660, dvh−154/−92) | —         | body 11               |
| Wave composer | `.wave-send-button` L8161     | 30                        | 30                        | 0         | —                     |
| Panel note    | `.dialog` (reused)            | 460                       | —                         | 25        | 16                    |

---

## 4. Findings register

### A. Overflow and clipping (breaks the "nothing cut off" rule)

| #   | Where                                                   | Current                                             | Why it fails                                                                                                                                                                                                 |
| --- | ------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A1  | `.kpi-note` L742                                        | `white-space: nowrap`, wraps only at ≤600 (L3073)   | At 1281–1440 the card inner width is **135–161px**; the longest notes ("Run total: 12 ATS · 3 thefts") need ≈175px → clipped by `.kpi-card{overflow:hidden}`. Present at every width between 1281 and ~1440. |
| A2  | `.kpi-title` L5500 + `.panel-info-button.compact` L7361 | 12px label + 15px icon + 26px button in a 135px box | "Network availability" needs ≈124px alone → the label truncates to an ellipsis at 1281–1440. The hover-fade added earlier hides the button visually but it still occupies 26px.                              |
| A3  | `.map-button` L3114 + L6522                             | `27×27` at ≤600, then global `min-height:44`        | Renders **27 wide × 44 tall** on a 390px phone — a stretched pill.                                                                                                                                           |
| A4  | `.tower-row` L3416                                      | `1.2fr 1.4fr .8fr .6fr .6fr`, gap 12                | At 328px inner the PRB/CQI columns are ≈43/31px and "Backhaul Isolated" needs ≈110px at 14px → wraps to two lines, rows jump height, no horizontal fallback.                                                 |
| A5  | `.network-switch` L6368                                 | `min-width:0`, no `overflow`/`text-overflow`        | At 390px the header's intrinsic content ≈394px vs 362 available (logo 105 + switch ≈120 + bell 30 + 3 phone tools ×40 + 5 gaps) → overflow or squeeze; the text cannot ellipsise because it is not clipped.  |
| A6  | `.chart-provenance` L8591                               | bottom padding 11px inherited                       | Card footers do not share a height with `.analytics-foot` (12px) or `.rail-footer` (44 min).                                                                                                                 |

### B. Spacing values off the 4/8/12/16/24/32 grid

`--card-pad 18` (L6266) · `--page-bottom 48` (L5413) · `--pad-x 14` (L6294) ·
`.tower-row 9 14` (L7027) · `.dialog-content 25` (L1940) · `.dialog-intro mb 22`
(L1961) · `.dialog-actions gap 9` (L1998) · `.inspector 17 20` (L1832) ·
`.inspector h3 mt 23 / pt 20` (L1891) · `.inspector-action mt 22` (L1913) ·
`.inspector-coords mt 18` (L1917) · `.intent-card 10 / mb 9` (L1342) ·
`.incident-icon 26` (L1203) · `.policy-foot 10 14` (L1436) ·
`.map-footer min 42` (L1094) · `.connection-banner 11 14 / mb 14` (L639) ·
`.wave-panel-header 10 13 9 10` (L7895) · `.wave-message radius 13` (L7988) ·
`.search-field 11` (L2374) · `.fleet-card 15` (L2331) · `.settings-info gap 15`
(L2470) · `.run-summary-grid gap 9` (L2279) · `.ring-list li 9 0` (L6968).

### C. Type scale deviations

> **Resolved in Task 3 (2026-10-24).** Every item below is closed; see
> `docs/DESIGN_TOKENS.md` for the applied role table. C1 → 20 (section title),
> C2 → 18, C3/C4 → 22 (`--fs-metric-sm`), C5 → 13 (`--fs-body`, intro paragraphs
> 16), C6 → 14 (`--fs-emphasis`), C7 → the 11px floor now holds for every
> selector (no raw `px` font-size remains in `app.css`), C8 → 13. Sizes that were
> off-scale for other reasons (7–10px across 200+ rules) were floored or raised
> to the scale in the same pass.

| #   | Where                                                                                                                                                                                                                                                                                                                                                                                                                                       | Current                    | Nearest token                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- | ------------------------------------- |
| C1  | `.dialog h2` L1949                                                                                                                                                                                                                                                                                                                                                                                                                          | 19                         | 18 (`--fs-title`)                     |
| C2  | `.inspector h2` L1857                                                                                                                                                                                                                                                                                                                                                                                                                       | 20                         | 18                                    |
| C3  | `.donut-wrap strong` L4198                                                                                                                                                                                                                                                                                                                                                                                                                  | 22                         | 18 or 28                              |
| C4  | `.chart-summary` big value L1511                                                                                                                                                                                                                                                                                                                                                                                                            | 22                         | 18 or 28                              |
| C5  | Dialogs body (`.dialog p` L6955, `.settings-info` L6962, `.approval-choice` L6950)                                                                                                                                                                                                                                                                                                                                                          | 16 everywhere              | console body is 13; 16 is `--fs-lead` |
| C6  | `.setting-row strong` L6959                                                                                                                                                                                                                                                                                                                                                                                                                 | 18                         | 16                                    |
| C7  | Below the 11px floor — spans/strong that the floor selector (L5479) does not cover: `.search-results strong` 10 / `span` 8 (L2414/2420), `.run-summary-eyebrow` 7, `.run-summary-grid span` 8, `.run-summary-duration` 9, `.run-summary-foot` 8 (L2252–2304), `.fleet-card > div > span` 8, `.fleet-card-foot span` 8 (L2346/2369), `.history-row > span` 9 (L2193), `.impact-table thead th` 7 (L2123), `.history-row .severity` 7 (L2197) | 11                         |
| C8  | `.impact-callout` L6954                                                                                                                                                                                                                                                                                                                                                                                                                     | 14 vs `.impact-notes p` 12 | 13 or 12                              |

### D. Alignment

| #   | Where                          | Before                                                                                            | After (Task 4)                                                                                                                                                                                                                                |
| --- | ------------------------------ | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | `.section-label`               | `padding: 0 4px`                                                                                  | `padding: 0` — the label starts on the panel edge like everything else.                                                                                                                                                                       |
| D2  | Vertical rhythm above the fold | 12 → 16 → 20 → 20                                                                                 | One gap (`--gap`) between every stacked block; only the label→card step is 12.                                                                                                                                                                |
| D3  | Footers                        | `.panel-heading` 56 · `.rail-footer` 44 · `.map-footer` 42                                        | Both bottom bands are `min-height: var(--tap-min)` (44). The 56px heading is a header, not a footer.                                                                                                                                          |
| D4  | `.oracle-threshold`            | padding `10px 8px` on top of the card's padding                                                   | `padding-inline: 0` — the threshold line spans the card's inner width and its text sits on the same x as the gauge and labels.                                                                                                                |
| D5  | `.chart-summary`               | `padding-top: 1px`                                                                                | `padding: 0` — the hand-tuned nudge is gone.                                                                                                                                                                                                  |
| D6  | `.inspector`                   | `padding: 17px 20px`                                                                              | `var(--space-4) var(--panel-pad)`.                                                                                                                                                                                                            |
| D7  | Header vs content edge         | Header padded `var(--pad-x)` full-bleed; content `max-width: --shell-max` + `margin-inline: auto` | Past 1760px the two left edges drifted by up to 80px at 1920. The header now pads by `max(--pad-x, (100% - --shell-max)/2 + --pad-x)`, so its content starts on the same x as the first panel at every width (drift 0 at 1920/1440/1024/390). |

### E. Tap targets on phone (390px)

| #   | Element                                  | Current                                                   | Required                  |
| --- | ---------------------------------------- | --------------------------------------------------------- | ------------------------- |
| E1  | `.map-button` (layer, zoom, locate)      | 27 wide × 44 tall (A3)                                    | 44 × 44                   |
| E2  | `.icon-button` / `.header-bell`          | 30 wide × 44 tall                                         | 44 × 44                   |
| E3  | `.phone-tools .icon-button` L5247        | 40 × 44                                                   | 44 × 44                   |
| E4  | `.panel-info-button.compact` L7361       | 26 × 44                                                   | 44 × 44, or hide on touch |
| E5  | `.dialog-close-button` L7440             | 24 × 44                                                   | 44 × 44                   |
| E6  | `.layer-menu input[type=checkbox]` L7000 | 18 × 18                                                   | 44 hit area               |
| E7  | `.wave-send-button` L8161                | 30 × 30 (forced by 6 declarations)                        | 44                        |
| E8  | `.tower-row` L7027                       | declares min 40, resolves 44 via the global rule          | declare 44                |
| E9  | `.segmented / .timeframe-tabs` buttons   | 12px text, padding 5 6, grow to 44 tall but stay ~34 wide | 44 min-width              |

### F. Dead or contradictory CSS (blocks clean sizing later)

| #   | Where                                                                                     | Problem                                                                                                                              |
| --- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| F1  | `.app-footer` L1813–1830                                                                  | Never rendered — no `.app-footer` element in `src/`.                                                                                 |
| F2  | `.ring-list li` fixed `70px 78px 64px 1fr` L6963                                          | Column widths do not adapt; at 390 the row needs 304 of 322px available.                                                             |
| F3  | `.navigation-rail width:60px` L2764                                                       | Dead — `.app-shell .navigation-rail{width:var(--nav-w)}` wins.                                                                       |
| F4  | `.alerts-rail` grid declared 9× (L1130, 2872, 3121, 6568, 7148, 7166, 7188, 8455, 8650)   | Written for a two-card rail; the power card has since moved out. Several blocks contradict each other and only source order decides. |
| F5  | `.map-stage` height 5× (L813, 2878, 3082, 3259, 6464) + min-height overrides              | The declared `height` is routinely beaten by `min-height`; 345–510 vs 360–560 is ambiguous.                                          |
| F6  | `.analytics-card min-height` 5× (238/265/238/245/230)                                     | All neutralised by `min-height:0` at L5822.                                                                                          |
| F7  | `.kpi-title/.kpi-note font-size` in three layers (8–10 / 12 / 11!important)               | The 12px rules at L4568/L4571 never apply.                                                                                           |
| F8  | `.towers-panel > input` L5732                                                             | Dead after the toolbar change.                                                                                                       |
| F9  | `.chart-coverage` L6972                                                                   | No such element in `TrafficQualityCard.tsx`.                                                                                         |
| F10 | `.policy-panel` forced `300px` (L8477) and `.alarms-panel` forced `400px` (L8461) at ≤767 | Hard-coded heights unrelated to content or viewport.                                                                                 |

### G. Proportions that read wrong

| #   | Where                 | Current                                              | Observation                                                                                                                                                                   |
| --- | --------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1  | KPI ribbon            | 6 columns from 1281px up                             | 1281–1440 is the tightest band in the app (135–161px per card). The 6→3 breakpoint sits at 1280 — one pixel too late.                                                         |
| G2  | Analytics row (≥1281) | traffic 1.35fr, cells 1fr, oracle 1fr, power spans 2 | Traffic is always the tallest card and sets row 1; Cells and Oracle inherit up to 200px of slack when the commander is empty.                                                 |
| G3  | Map stage             | 420px fixed at ≤767 on a 362px-wide column           | Fixed in Task 4: the stage is `clamp(300px, 62vw, 380px)` on phones and `clamp(320px, 42vw, 440px)` on tablets, so it keeps a landscape-ish aspect instead of a portrait one. |
| G4  | Towers table          | rows min 40, 5 fixed columns                         | Fixed in Task 4: below 600px the table keeps its column proportions and scrolls sideways (row min-width 440px) instead of wrapping every cell.                                |
| G5  | Dialogs               | 460 / 780 / 1040 with 25px padding                   | Padding is 25 at every width; at 390 the content box is 316px with 16px body text.                                                                                            |

---

## 4b. Task 4 — the layout grid, resolved

Every value below is a token; nothing is a one-off. Read at the four widths with
the responsive steps at the bottom of `tokens.css`.

### One rhythm

| Between                   | Token           | 1920 | 1440 | 1024 | 390 |
| ------------------------- | --------------- | ---- | ---- | ---- | --- |
| header → greeting         | `--page-top`    | 24   | 24   | 16*  | 16  |
| greeting → command bar    | `--gap`         | 24   | 16   | 16   | 12  |
| command bar → KPI ribbon  | `--gap`         | 24   | 16   | 16   | 12  |
| KPI ribbon → map/rail     | `--gap`         | 24   | 16   | 16   | 12  |
| map/rail → section label  | `--gap`         | 24   | 16   | 16   | 12  |
| section label → analytics | `--space-3`     | 12   | 12   | 12   | 12  |
| analytics → towers        | `--gap`         | 24   | 16   | 16   | 12  |
| last card → page end      | `--page-bottom` | 32   | 32   | 32   | 32  |

\* short desktops (`min-width:1025px and max-height:860px`) drop to 16.

Gutters, insets and paddings all come from the same ladder: `--gap` = `--panel-pad`
= 24 at ≥1700, 16 at 1281–1699 and ≤1280, 12/16 at ≤767. So the space between two
panels is the same as the space inside them, at every width.

### Columns

| Region            | Rule                                   | 1920           | 1440           | 1024      | 390      |
| ----------------- | -------------------------------------- | -------------- | -------------- | --------- | -------- |
| KPI ribbon        | 6 / 3 / 2 columns                      | 6 × 260        | 6 × 204        | 3 × 294   | 2 × 173  |
| Map + rail        | `minmax(0,1fr) var(--rail-w)`          | 1272 + 384     | 957 + 331      | stacked   | stacked  |
| Rail rows (≥1025) | `1.6fr / 1fr`                          | 62 % incidents | 62 % incidents | —         | —        |
| Analytics (≥1281) | `1.35fr 1fr 1fr`, traffic spans 2 rows | 658/487/487    | 513/380/380    | 2 columns | 1 column |

`--rail-w` is `clamp(320px, 23vw, 384px)`, i.e. 20–23 % of the content column:
wide enough for an alarm row, never wide enough to squeeze the map.

### Edges

- **Header.** Full-bleed bar, content padded `max(--pad-x, (100% − --shell-max)/2 + --pad-x)`. Its first glyph now starts on the first panel's left edge (0 drift at all four widths) instead of sinking left by the centring margin.
- **Sidebar.** `--nav-w` 72 / 64 / 0 (bottom bar). Content starts at `--nav-w + page inset`.
- **Panels.** Every panel heading, table row and footer takes its horizontal inset from `--panel-pad`; `.section-label` adds none (D1). The towers table is the one sub-card: it is inset by `--panel-pad` and its rows by `--space-4`, so the row text sits one step in from the heading by design, not by accident.
- **Footers.** `.map-footer` and `.rail-footer` are both `min-height: var(--tap-min)`; `.oracle-threshold` and `.chart-summary` lost their 1px/8px nudges.

### Height of the right-hand column

The map stage and the rail are one band: the rail has `contain: size`, stretches to
the map's height and splits it 1.6 / 1, so the two cards always end level. The map
stage is `clamp(340px, 40vh, 500px)` on desktop, `clamp(320px, 36vh, 420px)` on
short desktops, `clamp(320px, 42vw, 440px)` on tablets and `clamp(300px, 62vw, 380px)`
on phones — one clamp per breakpoint instead of five competing `height`/`min-height`
declarations (F5).

---

## 4c. Task 5 — panel sizes, equal insets, row alignment

### One inset inside every panel

The rule is `--panel-pad` on the left and right, `--panel-pad` at the top of a
heading and `--space-3` under it. Anything that was not on that rule:

| Surface                                                | Before                                                                                  | After                                                                                                           |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| KPI card                                               | 16/16/14 · 12/16 at 1281–1440 and ≤767 · 12 all round at ≤420 · 12/16 on short desktops | `--panel-pad --panel-pad --space-3` at **every** width (the min-heights stay per breakpoint)                    |
| Panel heading (all)                                    | `16 --panel-pad 12`                                                                     | `--panel-pad --panel-pad --space-3`                                                                             |
| Radio-load table head                                  | margin 16 **+** padding 20 → column titles 16 px right of the values                    | padding only; head and rows share one x                                                                         |
| Radio-load rows / power rows                           | 10 and 7 px vertical                                                                    | `--space-2`                                                                                                     |
| Policy card: foot                                      | 10/14                                                                                   | `--space-3 --panel-pad`                                                                                         |
| Policy card: description                               | 1/15/10                                                                                 | `0 --panel-pad --space-2`                                                                                       |
| Intent card (nested)                                   | 10, margin 9                                                                            | `--space-3`, margin `--space-2`                                                                                 |
| Wave panel: header / messages / composer / suggestions | 10/13/9/10 · 15/14 · 5/6/5/10 · 0/13                                                    | `--space-3 --panel-pad` · `--panel-pad` · `--space-1 --space-2 --space-1 --space-3` · `0 --panel-pad --space-2` |

### Heights on the same row

- **KPI ribbon** — six cards, `align-items: stretch`, so all six are identical in height and the notes sit on the same bottom line (`margin-top: auto`).
- **Map + rail** — the rail is `contain: size` and stretches to the map's height (Task 4). Its two cards split `1.6fr / 1fr` and both scroll inside, so nothing is clipped.
- **Radio load + Oracle** — the Oracle card used to be forced to 300 px by the commander block copied in from the rail (`min-height: 300px`), which made it the tallest card and left Radio load with a dead band above its footer. The commander now flexes (`flex: 1 1 auto; min-height: 0`) and fills the card, so the row height is set by the tallest _content_, not by a fixed floor.
- **Fleet/power card** — spans exactly the two columns above it; its button is pinned to the bottom edge.
- **Chart card** — spans both rows. Its spare height is now placed _between_ its two chart groups (`margin-top: auto` on the second chart title) instead of pooling above the provenance line, so the card reads as two balanced halves.

### Vertical position

- Panels on a row all start and end on the same y: `align-items: stretch` on `.primary-grid` and `.analytics-grid`, one `--gap` between bands (Task 4).
- `.oracle-threshold` keeps the panel inset (it had been set to `padding-inline: 0` in Task 4 — a regression, fixed here); the rule line spans the card because the border is on the border box, not because the text is flush.
- `.cell-table-head` no longer adds a 16 px margin on top of the 20 px inset.
- The KPI note wrapping rule from Task 3 stays: a long note wraps instead of being clipped, and the value/label positions are unchanged because the note is pinned to the bottom.

Gates after Task 5: Prettier clean · `tsc -b` clean · Vitest 18 files / 75 tests · `vite build` clean.

---

## 4d. Task 6 — inner spacing and alignment

### Method

1. Collected every `className` token used in `src/**/*.tsx` (316), so rules that no
   element can match are not counted.
2. Listed every `padding` / `margin` / `gap` declaration whose value is not on
   4 / 8 / 12 / 16 / 24 / 32 — 330 of them; 250 sit on a selector ending in a class
   the app actually renders.
3. Snapped 316 of them with one rule (below), then rebuilt Prettier, `tsc`, Vitest
   and the production build. The remainder are either rules the app never renders
   or the structural keeps below.

### The snapping rule

| Raw value  | Becomes | Raw value  | Becomes |
| ---------- | ------- | ---------- | ------- |
| 1 – 5 px   | 4       | 15 – 19 px | 16      |
| 6 – 11 px  | 8       | 20 – 27 px | 24      |
| 12 – 14 px | 12      | 28 px +    | 32      |

Three exceptions, all deliberate:

- **Interactive controls round up, never down.** A `<button>`, `<select>`, `<input>`
  or the search field keeps its size: 11 px padding becomes 12, not 8, so no target
  shrinks below the 44 px rule.
- **icon → label is 8 px, not 4.** A glyph needs more air than two words do, so
  the six rows that put an icon next to a label (KPI title, KPI note, layer
  control, policy description, inspector place, intent actions) move from 4 px to
  `--space-2`; the ≤ 5 px band would have kept them at 4. Chips go the other way:
  `.severity` was 3 px above and below, `.district-label` 2 px; both are now
  `--space-1 --space-2` (4 / 8), so every chip has the same inner box.
- **Structural clearances are left alone** and stay as documented one-offs:
  `main` 84 px bottom padding (fixed phone bar), `.main-shell` 72/60 px nav offset,
  `.toggle-track` 2 px (switch thumb travel), `.wave-thinking` 31 px (aligns under
  the message bubble), `.run-history` 3 px (scrollbar gutter), `.history-tabs`
  −4 px (optical pull-up), `.play-controls` 1 px.

316 declarations were rewritten; 12 off-scale values remain, all of them on that
list.

### Two rules that replace the old scattering

| Rule          | Where                                                                                              | Value                         |
| ------------- | -------------------------------------------------------------------------------------------------- | ----------------------------- |
| icon → label  | every row that puts an `<svg>`/dot next to text                                                    | `--space-2` (8)               |
| inside a chip | `.severity`, `.count-badge`, `.ai-chip`, `.site-status`, `.district-label`, `.inspector-tags span` | `--space-1 --space-2` (4 / 8) |

### Alignment

- **Radio-load table.** The columns are `minmax(0,1fr) 50px 32px` (`38px` PRB on
  phones). The CQI pill is 24–29 px wide, so its old 24 px track let it spill into
  the gutter; it now has a 32 px track and its column title is centred over it.
  The PRB track is exactly the width of the bar it holds, so the % label and the
  bar end on the same edge. Header and rows share one grid, so the titles sit
  exactly over the values, and the bar and the badge use lining figures so a
  2-digit → 1-digit change cannot shift them.
- **Donut readout** uses lining figures and `--ls-metric`, so the number no longer
  jitters between ticks.
- **Severity / count chips** are `flex: none`, so a wrapping incident title can
  never squash them.
- Buttons in the command bar all resolve to `padding: 8px 12px` and `gap: 8px`; the
  header controls to `8px` internal gaps and `8px 12px` padding.

### What this does not touch

Radii, shadows, colours and type sizes are unchanged. Off-scale element _sizes_
that are not spacing (the 50 px PRB bar, 46 px wave avatar, map control sizes) are
untouched — they belong to the control, not to the gap around it.

### Verified after the last edit

Re-running the snapper against the finished stylesheet reports **0 declarations
left to change** — every `padding`, `margin` and `gap` in the file is either on
4 / 8 / 12 / 16 / 24 / 32, a token that resolves to one of them, or one of the
structural keeps above.

Gates after Task 6: Prettier clean · `tsc -b` clean · Vitest 18 files / 75 tests ·
`vite build` clean · `layout_check` drift 0.0 px at 1920 / 1440 / 1024 / 390.

---

## 4e. Task 7 — one shape per component

Four properties were counted across the six component families —
**radius, height, padding, font size** — on the live classes only.

### Radii

The file used **fourteen** different corner values (1, 2, 3, 5, 6, 7, 9, 10, 11, 13,
15, 18, 20 px plus three mixed shorthands). All 82 declarations were snapped to the
scale and rewritten as tokens:

| Radius           | Was            | Now       | Who uses it                                 |
| ---------------- | -------------- | --------- | ------------------------------------------- |
| `--radius-xs` 4  | 1, 2, 3, 4, 5  | 4         | chips, badges, `kbd`, map labels, scrollbar |
| `--radius-sm` 8  | 6, 7, 8, 9     | 8         | inner tabs, dense icon buttons, menus       |
| `--radius-md` 12 | 10, 11, 12, 13 | 12        | buttons, inputs, sub-cards, dialogs         |
| `--radius-lg` 16 | 14, 15, 18, 20 | 16        | every page panel, dialogs, Wave             |
| `--radius-pill`  | 999, `50%`     | unchanged | pills, switches, avatars, tracks            |

`border-radius: 50%` (dots and avatars) and multi-corner shorthands were kept as
shorthands with each corner snapped (`0 7px 7px 0` → `0 8px 8px 0`).

### Heights

| Token            | Value | Family                                                                                                                                                 |
| ---------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--control-h`    | 36 px | `.button`, `.icon-button`, `.speed-button`, `.roi-pill`, `.search-trigger`, `.map-button`, `.map-zoom button`, `select`, `input`, all three tab strips |
| `--control-h-sm` | 28 px | `.panel-info-button` (was 30, `.compact` 26), `.dialog-close-button` (was 24), Wave icon and send buttons (was 32 / 30)                                |
| `--tap-min`      | 44 px | every button and input at ≤767 px or a coarse pointer                                                                                                  |

Two controls were not square before and are now: `.icon-button` was 30 × 36, the
map buttons 30 × 36, the play buttons 29 × 36 — all **36 × 36**. Icon-only buttons
have no text children, so a square box is always correct.

### Tabs

`.segmented`, `.timeframe-tabs` and `.history-tabs` are now one rule. The blanket
button rule used to win the cascade for the first two (36 px, radius 12 inside a
4 px-padded 12 px track); they are excluded from it, so the tab rule applies:

|              | Before                                                 | Now                      |
| ------------ | ------------------------------------------------------ | ------------------------ |
| height       | 36 (from the blanket, `.segmented button` 30 was dead) | `--control-h` 36         |
| inner radius | 12 (the `calc(md - 3px)` was dead)                     | `--radius-sm` 8 = 12 − 4 |
| padding      | 0 12                                                   | 0 12                     |
| font         | 13 via the blanket                                     | 13, declared here        |

The selected history tab lost its `8px 12px` padding, which made it 2 px taller than
its siblings.

### Badges

| Badge             | Before                         | Now                            |
| ----------------- | ------------------------------ | ------------------------------ |
| `.severity`       | 4 / 8 padding, radius 4, 11 px | unchanged (already right)      |
| `.count-badge`    | radius 5                       | radius 4, 4 / 8, 11 px         |
| `.ai-chip`        | radius 4, 4 / 8, 11 px         | unchanged                      |
| `.district-label` | 4 / 4 padding, radius 3, 12 px | 4 / 8, radius 4, 11 px         |
| `.roi-pill`       | 30 tall, 12 px, 8 / 8 padding  | 36 tall, 13 px, 0 / 12 padding |

### Icons

Lucide `size` props used nine values between 11 and 19 px (11, 12, 13, 14, 15, 16,
17, 18, 19). 57 call sites were snapped: **11–15 → 14**, **16–19 → 18**. Three CSS
overrides that forced 12 px (`kpi-title svg`, `scenario-button svg`) and 20 px
(`nav-item svg`) follow the same pair. Hero art (20 / 22 / 24 / 27 / 30) is
untouched.

### What this does not touch

Colours, type sizes, weights, spacing inside components, and every feature. The
radius change is the only one that is visible on large surfaces: cards go from
20 / 18 px corners to 16 px, which is the value the token always said.

Gates: Prettier clean · `tsc -b` clean · Vitest 18 files / 75 tests · `vite build`
clean · frame drift 0.0 px at 1920 / 1440 / 1024 / 390.

---

## 4f. Task 8 — the five widths

### How this was checked

There is still no browser in this environment (no Chromium libraries, and the
download hosts are blocked), so every number below comes from two sources that do
not need one:

1. **Real font metrics.** The four woff2 files in `public/assets/fonts` are read
   with `fontTools`; every label's width is computed from the actual advance
   widths of Manrope / IBM Plex Mono / Newsreader rather than guessed.
2. **Cascade resolution.** The stylesheet is parsed and each declaration resolved
   per viewport (media queries, `!important`, specificity, order), so the values
   compared are the ones a browser would apply — not the base values.

Budgets used: content width = viewport − nav rail − 2 × `--pad-x`, then the panel
inset (`--panel-pad`) on top of that.

| Width | Nav | Content | Panel body | Layout                                   |
| ----- | --- | ------- | ---------- | ---------------------------------------- |
| 1920  | 72  | 1680    | 1640       | 6 KPI · 3-col analytics · map + rail     |
| 1440  | 72  | 1305    | 1265       | 6 KPI · 3-col analytics · map + rail     |
| 1024  | 64  | 915     | 883        | 3 KPI · 2-col analytics · map above rail |
| 768   | 64  | 670     | 638        | 3 KPI · 2-col analytics · map above rail |
| 390   | 0   | 358     | 326        | 2 KPI · 1-col · bottom tab bar           |

### Found and fixed

| #   | Where                                                                                                                                        | Symptom                                                                                                                                                                                                                                                                                                                                                                                                     | Fix                                                                                                                                                                                                                                  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `.chart-summary` in the traffic card                                                                                                         | The two switch groups measure **320 px** (3 timeframe tabs + Throughput/PRB at 13 px, measured from the font files). The card body is **326 px** on a 430-wide phone, **294 px** at 390 and **264 px** at 360 — so the row pushed past the panel edge on every phone narrower than ~420, which includes the 390 target. At 768 the card spans the full grid width (638 px), so tablets were never affected. | `flex-wrap: wrap` + `gap: var(--space-2)`: one row when it fits, two rows when it does not                                                                                                                                           |
| 2   | `.inspector` bottom sheet                                                                                                                    | On a phone the sheet sat at z 550 under the fixed tab bar (z 1100), so its last 64 px — the closing content — were hidden behind the bar. At 601–767 it was worse: still a floating panel ending 25 px from the bottom, i.e. under the bar.                                                                                                                                                                 | On ≤767 the sheet ends above the bar: `bottom: calc(64px + env(safe-area-inset-bottom))`                                                                                                                                             |
| 3   | `.toast`                                                                                                                                     | Pinned 24 px from the bottom, it covered the tab bar while visible.                                                                                                                                                                                                                                                                                                                                         | Same clearance: `64 + 16 + safe-area`                                                                                                                                                                                                |
| 4   | header tap targets                                                                                                                           | The search button and the three phone tools were **40 × 44**                                                                                                                                                                                                                                                                                                                                                | `--tap-min` (44 × 44)                                                                                                                                                                                                                |
| 5   | `.incident-meta > span`, `.rail-subhead > span`, `.towers-hint`                                                                              | `white-space: nowrap` with no truncation — long values ran under the panel edge instead of ending in an ellipsis                                                                                                                                                                                                                                                                                            | `min-width: 0; overflow: hidden; text-overflow: ellipsis`                                                                                                                                                                            |
| 6   | label/value rows (`.panel-heading`, `.towers-tools`, `.rail-subhead`, `.overview-meta`, `.fleet-summary`, `.policy-foot`, `.dialog-actions`) | Side-by-side rows could squeeze instead of stacking                                                                                                                                                                                                                                                                                                                                                         | `flex-wrap: wrap` at ≤767                                                                                                                                                                                                            |
| 7   | page guard                                                                                                                                   | A single stray pixel would give a phone a sideways scroll                                                                                                                                                                                                                                                                                                                                                   | `body { overflow-x: clip }` at ≤767 (`clip`, not `hidden`, so the sticky header keeps working)                                                                                                                                       |
| 8   | label floor on phones                                                                                                                        | Labels sat at 11 px — legible at arm's length on a laptop, small in one hand                                                                                                                                                                                                                                                                                                                                | `.eyebrow`, `.kpi-title`, `.kpi-note`, `.analytics-foot`, `.chart-provenance`, `.map-legend`, `.cell-table-head`, `.range-scale` and the tower header step to 12 px at ≤767 (longest label after the step: 158 px in a 326 px panel) |

Header budget at 390 after the change: logo 105 + chevron 14 + search 44 + three
tools 140 + gaps 32 = **335 of 358** — 23 px of slack.

### Checked and already correct

- **Tap targets.** The `@media (max-width: 767px)` blanket sets
  `min-height: min-width: 44px` on every `<button>`, `select` and text `input`
  except the Wave launcher (104 px) and Leaflet's own controls. There are no
  clickable `<div>`/`<span>` and only one `<a>` (the skip link).
- **Wide tables.** `.tower-table` (`overflow: auto`, rows `min-width: 440px`) and
  `.impact-table-wrap` (`overflow-x: auto`, table `min-width: 680px`) both scroll
  inside their panel, so neither widens the page.
- **Dialogs.** `width: calc(100vw − 24px)`, `max-height: 88dvh`, `overflow: auto`
  at ≤767; the impact dialog `calc(100vw − 20px)`.
- **Fixed overlays.** Wave panel `min(400px, 100vw − 20px)` at `right: 12`;
  greeting `min(280px, 100vw − 24px)`; launcher 72 px sitting above the tab bar;
  speed popover `min(225px, 100vw − 32px)`.
- **Stacking order at ≤767.** map → incidents rail → analytics (traffic, radio
  load, oracle, power) → towers, all full width.
- **Bottom bar.** 6 nav buttons in two groups of 4 + 2, 44 px each, inside
  374 px — no overflow.
- **Text size floor.** Nothing renders below 11 px at any width (the `:where(...)`
  floor from Task 3).

### Desktop

Nothing overflows at 1440 or 1920; the only structural slack is the traffic card,
which is taller than its two charts need. It is handled by pushing the second
chart group to the card's lower half (`margin-top: auto` on its title) so the card
reads as two balanced halves instead of one empty band.

Gates: Prettier clean · `tsc -b` clean · Vitest 18 files / 75 tests · `vite build`
clean · frame drift 0.0 px at 1920 / 1440 / 1024 / 390.

---

## 4g. Task 9 — the final pass

### Removed

| What                                                                 | Count | How it was found                                                                                                                                                                                              |
| -------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rules whose every selector names a class the app never renders       | 18    | every class token in the stylesheet compared with every word in `src/**/*.tsx`; `.search-trigger` (11), `.app-footer` (6), `.chart-coverage` (1) — the header search pill and the page footer no longer exist |
| Dead selectors inside shared rules                                   | 20    | the same comparison at selector level (`.wordmark > span, .network-switch span, .search-trigger kbd` → the first two survive)                                                                                 |
| Rules fully re-declared later by the same selector in the same media | 7     | cascade simulation over every rule, then delete when a later rule repeats every property at equal or stronger weight                                                                                          |
| Unused tokens                                                        | 6     | `--ai`, `--cyan-ui`, `--panel-pad-y`, `--sn-warn`, `--warn`, `--space-0` — zero references in the whole tree                                                                                                  |

`--sn-live` was caught by the same test but kept: the short `--live` alias
(`var(--sn-live)`) is used by two rules, so following that chain would have broken
them. Library-generated classes (`.leaflet-*`) and template-generated ones
(`.wave-message--${role}`) were excluded from the scan for the same reason.

**Stylesheet: 192.6 kB → 188.9 kB** (−3.7 kB of source), bundle CSS unchanged at
163.5 kB (34.6 kB gzip).

### Mismatches fixed

| Where                                                    | Was                                                                                   | Now                                                                          |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `.app-shell .incident-target`                            | `padding: 2px var(--space-2)` — a token next to a raw value the snapper could not see | `var(--space-1) var(--space-2)`                                              |
| `.dialog .button.secondary`                              | `padding: var(--space-3) 20px`                                                        | `var(--space-3) var(--space-5)`                                              |
| `.layer-menu`                                            | `padding: var(--space-3) 14px`                                                        | `var(--space-3) var(--space-4)`                                              |
| `.layer-menu label`                                      | `padding: var(--space-2) 6px`                                                         | `padding: var(--space-2)`                                                    |
| `.wave-message-content`                                  | `padding: 10px var(--space-3)`                                                        | `padding: var(--space-3)`                                                    |
| `.wave-error-actions button`, `.wave-suggestions button` | `padding: 6px var(--space-2)`                                                         | `padding: var(--space-2)`                                                    |
| weather chip animation                                   | `var(--e, ease-out)` — `--e` does not exist, every other animation uses `--ease`      | `var(--ease)`                                                                |
| letter spacing                                           | 4 × `0.08em`, 1 × `-0.015em` written out                                              | `var(--ls-label)`, `var(--ls-title)` (identical values, so no visual change) |

### Verified clean after the pass

`dead rules: 0` · `duplicated rules: 0` · `off-scale spacing: 0` ·
`off-scale radii: 0` · `undeclared variables: 0` (only the nine set at runtime from
React — `--tone`, `--critical`, `--healthy`, `--warning`, `--prediction` and the
four `--wave-*` viewport values).

Gates: Prettier clean · `tsc -b` clean · Vitest 18 files / 75 tests · `vite build`
clean · frame drift 0.0 px at 1920 / 1440 / 1024 / 390.

---

## 5. Suggested fix order for the next tasks

1. **A1, A2, G1** — the KPI ribbon (drop the 6-across band earlier / let notes wrap).
2. **A3, A5, E1–E7** — phone chrome: 44×44 everywhere, header content budget at 390.
3. **A4, G4** — towers table on phone (stack or scroll).
4. **B, D** — collapse the off-scale values onto `--sp-*`, one footer height, one above-the-fold rhythm.
5. **C** — extend the type floor to the dialogs; retire 7–10px text.
6. **F** — delete the dead blocks so later sizing changes are predictable.

Status: items in **B** and **D** are resolved by Tasks 2–4. G3 and G4 are resolved
by Task 4. Items in **A**, **C** (partly), **E** and **F** remain for the phone and
spacing tasks.

---

## 5b. How Task 4's numbers were checked

`npx playwright` cannot install its browser in this sandbox, so the layout was
verified by resolving the cascade rather than by screenshot:

1. A small PostCSS resolver evaluates every rule against 1920×1080, 1440×900,
   1024×768 and 390×844 (media queries, `!important`, `:where()` specificity) and
   reports the winning declaration and its line for the properties Task 4 touches —
   gaps, paddings, `grid-template-*`, `min/max-height`, `max-width`.
2. A second script resolves the tokens at the same four widths and prints the
   resulting geometry: content column, map/rail split, KPI card size, and the x of
   the header's first item versus the first panel's left edge (0 px drift at all
   four widths).
3. Gates after the change: Prettier clean, `tsc -b` clean, Vitest 18 files / 75
   tests, `vite build` 161.93 kB CSS. The running dev server serves the new CSS.

Text-fit figures (e.g. "204 px per KPI card") are arithmetic on those resolved
values, not measurements of rendered glyphs.

---

## 6. Feedback round after Task 9 (2026-10-24, two batches)

Batch 1 (chat-sheet spacing, header icons):

- Wave sheet on phones sits 24 px above the bottom bar (was 12); the sheet's
  height gives the 12 px back so its top edge stays put (`app.css`, ≤767 block).
- The header's history button uses lucide `History` instead of `Bell`; the
  rail's Incidents entry keeps the bell, so the two no longer match.
- The history button is no longer hidden below 768 px: a late ≤767 rule
  re-shows `.header-bell` as a 44×44 inline-flex chip beside `.phone-tools`.

Batch 2 (five fixes, one per screenshot):

1. _Extra rule under the last ring row._ A late block sets
   `border-bottom: 1px solid #d6e2f2 !important` on every `.ring-list li`,
   which out-weighed the old `li:last-child` / `li:nth-last-child(2)`
   removals, so the final row kept a stray line. New rules in the same late
   block drop the rule for `li:last-child` always, and for
   `li:nth-last-child(2):nth-child(odd)` from 768 px up (two-column list);
   the dead ≥1025 copies of those rules were removed.
2. _Boxed "View event history" footer._ The shared
   `.app-shell button:not(…)` chrome (specificity 0-8-1) beat the rail
   footer's quiet strip, painting it as a white rounded button. The footer
   rule now asserts `border/0`, `background/transparent`, `radius/0`,
   `shadow/none` with `!important`, plus a matching `:hover`.
3. _Flattened towers search field._ The field's chrome lived in one
   0-2-0 rule with no `!important`; it is now asserted
   (`border`, `radius`, `background: #ffffff`) and its height uses the
   `--control-h` token instead of a literal 36 px.
4. _A1 Commander "…" one step left of Oracle's._ The commander slot inherits
   the card's child padding _and_ adds its own heading padding, doubling the
   inline inset. `padding-inline: 0` on
   `.app-shell .oracle-combo .commander-slot` aligns the Commander's heading
   (and its description/list/foot, which carry their own padding) with the
   Oracle section's edges.
5. _Traffic & quality x-axis._ `charts.js` passed raw minute values as pixel
   x to the label placer, so short-window labels collided into one and
   rendered off-canvas; the fix wraps them in `sx()`. A regression test
   asserts five labels ("10:00 … 10:30") inside the plot area. The
   "N samples · … sim min" provenance line is gone; the paragraph now
   renders only when `historyError` is set (error text is preserved).

Gates after batch 2: Prettier clean · `tsc -b` clean · Vitest 18 files /
76 tests · `vite build` 163.88 kB CSS. All five edits verified in the CSS/JS
served by the running dev server.

## 7. Map-performance round, part 1 (2026-10-24)

Task A of the map-performance round is findings-only and lives in
`docs/MAP_PERF_AUDIT_2026-10.md` (bottlenecks ranked, fix proposed, awaiting
approval). Two UI requests from the same message were implemented:

1. _Desktop rail: Towers before Maintenance._ The two items are swapped in
   the nav array (`App.tsx`), which already matched the phone bottom bar's
   visual order. The phone-only flex `order` overrides in the ≤767 block
   (`[data-nav-item="towers"] { order: 5 }` / `fleet { order: 6 }`) became
   redundant and were removed with a comment; the e2e mobile order assertion
   (`[overview, network, incidents, analytics, towers, fleet]`) is unchanged
   and still holds because DOM order now equals visual order.
2. _Wave polish (3 items)._
   - **No more literal `**`.** Assistant replies pass through
     `waveReplyLines()` in `WaveChat.tsx`, which strips paired and stray
     `**` at render time (stored history keeps the original text for
     follow-ups) and splits the reply into lines.
   - **Line-by-line reveal.** The newest assistant message renders one
     `<span class="wave-line">` per line with a 110 ms stagger (capped at
     880 ms) and a 320 ms fade/rise (`wave-line-in`). Older messages render
     the same lines without motion, so reopening the chat with history stays
     instant. `prefers-reduced-motion` sets `opacity: 1` explicitly — the
     global reduce block kills animations, which would otherwise leave the
     pre-animation `opacity: 0` stuck.
   - **A little smaller on desktop.** Launcher `--wave-launcher-size`
     104 → 88 px; panel 390×630 → 350×560 with `bottom` 142 → 126 px and the
     greeting note re-centred against the smaller launcher (bottom offset
     25 → 20 px). The ≤767 block re-asserts the phone geometry, so phones
     are untouched. `clampLauncherPosition` fallbacks updated 104 → 88.
   - **Friendly note next to Wave.** The one-time dismissible greeting is now
     a permanent, non-interactive note ("Hey, I'm Wave 👋 Your network, made
     clearer.") shown beside the launcher whenever the chat is closed. The
     dismissal machinery (state, storage helpers, dismiss button) was
     removed; the note inherits `pointer-events: none` from `.wave-assistant`
     so the map stays clickable through it. Two WaveChat tests were updated
     to the new behaviour and one test added for the `**`-free line-by-line
     rendering; `WaveMascot.test.tsx`'s launcher-size pin moved 104 → 88 px.
