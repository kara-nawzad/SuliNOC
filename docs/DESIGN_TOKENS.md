# SuliNOC design tokens

One file owns every design value: **`frontend/src/styles/tokens.css`**.
`frontend/src/styles/app.css` imports it first and only *consumes* tokens — it no
longer declares a single custom property (the Wave assistant's own `--wave-*`
component variables are the only exception; they are local to that component).

If a value is missing, add a token — do not inline a literal.

## Type scale

Nine text sizes plus three display/metric steps — no others. Every `font-size` in
`app.css` is one of these tokens: no raw `px` size and no `font:` shorthand is left
in the stylesheet.

| Role | Token | Value | Applied to |
|---|---|---|---|
| Page title | `--fs-page-title` | `clamp(30px, 2.4vw + 14px, 42px)` (32 on short desktops, 30 on phones) | Overview greeting `h1`; boot/error screen headline |
| Display (small) | `--fs-display-s` | 28px | Boot splash headline |
| Section title | `--fs-section-title` | 20px | Dialog headings (`h2`/`h3`), impact report heading |
| Panel title | `--fs-panel-title` | 18px | Every panel / card `h2`, inspector site id, Wave panel title, brand wordmark |
| Lead | `--fs-lead` | 16px | Dialog intro / impact subtitle |
| Emphasis | `--fs-emphasis` | 14px | Chart titles, settings labels, fleet-card names, empty-state headlines |
| Body | `--fs-body` | 13px | Default UI text: prose, dialog copy, tables, tower rows, buttons, inputs |
| Caption | `--fs-caption` | 12px | Units, states, sub-labels, small-muted, map chips, tab labels |
| Small | `--fs-small` | 11px | Eyebrows, severity chips, table heads, KPI labels/notes, footers (the floor) |
| Metric | `--fs-metric` | 30px (32 ≥1700, 26 ≤1280, 24 ≤420) | KPI values, radial gauge value |
| Metric (small) | `--fs-metric-sm` | 22px | Donut / chart readouts, impact live values |

**Line heights** — four for text, one for numerals: `--lh-tight` 1.15 (page title,
brand) · `--lh-title` 1.25 (any heading, chart title) · `--lh-body` 1.5 (default,
labels) · `--lh-prose` 1.65 (paragraphs, notes) · `--lh-metric` 1.1 (KPI and gauge
numerals). The only literal left is `line-height: 1` on the two tab strips, where
the label is centred in a fixed box.

**Weights** — only the four the loaded families actually have: 400, 500, 600, 700.
Headings and numbers 600, row labels 600, body 400, quiet prose 500. Manrope ships
400–700; Newsreader 400–600; IBM Plex Mono 400–500, so mono text never asks for 600.

**Families** — `--font-ui` (Manrope) · `--font-display` (Newsreader) · `--font-mono`
(IBM Plex Mono). Every `font-family` in `app.css` references one of the three; the
old `"JetBrains Mono"` / `Inter` / literal `"Manrope"` stacks are gone (JetBrains
Mono was never loaded, so those rules silently fell back to the system mono).

**Letter spacing**: `--ls-title` · `--ls-label` · `--ls-metric`.

## Spacing scale — 4 / 8 / 12 / 16 / 24 / 32

| Token | Value |
|---|---|
| `--space-1` | 4px |
| `--space-2` | 8px |
| `--space-3` | 12px |
| `--space-4` | 16px |
| `--space-5` | 24px |
| `--space-6` | 32px |

There is no off-scale step left. `--gap`, `--panel-pad`, `--page-top`,
`--page-bottom`, `--pad-x` and `--sp-5` were the five 14/18/20/48 px values that
sat between the steps; Task 4 folded them into the scale (`--sp-5` is gone).

## Gaps and page rhythm

`--gap` is the only space between two panels, and it is the same value as the
panel inset: **24** at ≥1700, **16** at 1281–1699 and at ≤1280, **12** at ≤767.

| Where | Token |
|---|---|
| header → greeting | `--page-top` (24; 16 on short desktops and phones) |
| every stacked block (greeting, command bar, KPI ribbon, map row, analytics, towers) | `--gap` |
| section label → its cards | `--space-3` |
| last card → page end | `--page-bottom` (`--space-6`, 32) |
| gutter left/right | `--pad-x` (16 → 32, 40 at ≥1700) |

## Radii

`--radius-xs` 4px · `--radius-sm` 8px · `--radius-md` 12px · `--radius-lg` 16px ·
`--radius-pill` 999px.

| Radius | Used by |
|---|---|
| `--radius-xs` | chips, badges, `kbd`, small keys, map labels |
| `--radius-sm` | inner tabs inside a 4 px track (12 − 4), dense icon buttons, menus |
| `--radius-md` | buttons, inputs, sub-cards, dialogs' inner blocks |
| `--radius-lg` | every page panel (`.glass`), dialogs, the Wave panel |
| `--radius-pill` | pills, switches, avatars, range tracks |

## Control geometry

| Token | Value | Used by |
|---|---|---|
| `--control-h` | 36 px | `.button`, `.icon-button`, `.speed-*`, `.roi-pill`, `.search-trigger`, map buttons, inputs, selects, tabs |
| `--control-h-sm` | 28 px | dense icon buttons in panel headings (`.panel-info-button`, `.dialog-close-button`), Wave's icon/send buttons |
| `--tap-min` | 44 px | every button and input on a phone or coarse pointer |

Icon sizes are two values only: **14 px** inline and **18 px** in the header/nav.
Larger marketing sizes (20 / 22 / 24 / 27 / 30) stay on hero art only.

## Panel padding

`--panel-pad` — one step: 24px at ≥1700, 16px everywhere else (the same as
`--gap`). Every panel, card and drawer derives its horizontal padding from this
token; `.panel-heading` uses it on three sides and `--space-3` at the bottom so
the title sits optically centred above its rule.

## Also in the file

- Structure: `--nav-w` (72/64/0), `--header-h` (64/56), `--shell-max` (1760),
  `--rail-w` (`clamp(320px, 23vw, 384px)`), `--page-top`, `--page-bottom`,
  `--tap-min` (44px). The header content is padded by
  `max(--pad-x, (100% − --shell-max)/2 + --pad-x)` so its first item starts on
  the same x as the first panel once the content column stops growing.
- Elevation: `--shadow-1`, `--shadow-2`, `--shadow-pop`, `--focus-ring`.
- Motion: `--ease`, `--ease-io`, `--t-fast`, `--t-base`, `--t-slow`.
- Colour: the published palette, unchanged (`--sn-bg` … `--sn-ai`), plus the short
  aliases (`--bg`, `--tx`, `--line`, …) that ~150 rules still use.
- Responsive steps at the end of the file re-declare tokens only (1280, 1024, 767,
  420, 1700, and short-desktop heights). The type scale steps with them in exactly
  two places: `--fs-page-title` (30 on phones, 32 on short desktops) and
  `--fs-metric` (26 ≤1280, 24 ≤420, 32 ≥1700).

## Rules

0. Typography invariants checked after every change: `grep -c "font-size: [0-9]"`
   in `app.css` returns 0, the only `font:` shorthand is `font: inherit`, every
   `font-family` is a `--font-*` token, `font-weight` is one of 400/500/600/700,
   and no selector resolves below 11px at 1920/1024/390.

1. Spacing rules that go with the scale:
   - **icon → label** is `--space-2` (8 px) everywhere a glyph or dot sits next to
     text; **inside a chip** it is `--space-1 --space-2` (4 / 8).
   - **interactive controls round up**, never down — shrinking a button, select or
     input below its current padding breaks the 44 px target rule.
   - **structural clearances are not spacing**: the phone bottom-bar clearance
     (`main` 84 px), the nav offset (`.main-shell`), the switch thumb travel and
     the Wave bubble indent stay as they are, and each is commented in place.
   - no raw `padding` / `margin` / `gap` value outside 4 / 8 / 12 / 16 / 24 / 32 is
     left on any rendered selector (12 documented exceptions, all structural).

2. Structural colour (site status, X.733 severity, power source) is **not** a
   frontend token — it comes from `/api/config` and must stay server-driven.
3. Never declare a custom property inside `app.css`.
4. New component CSS uses the canonical names above, not the short aliases.
