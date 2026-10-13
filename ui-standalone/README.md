# AutoNOC Command Center — UI-only build

The complete operations-console front end, extracted from the full AutoNOC
stack and made to run **with no backend at all**. Every screen you see in the
live demo is here — the navigation rail and its tabs, the live network map,
KPI grid, alarm stream, A1 Commander panel, telemetry analytics, fleet view,
site inspector, search, settings, scenario modals, history and the
counterfactual impact report — driven by a small deterministic simulation
that runs entirely in your browser.

```
npm install
npm run dev        # → http://localhost:5173
```

Production bundle: `npm run build && npm run preview`.

## How it works

- **The UI code is byte-for-byte the same** as `../frontend` (React 18 +
  TypeScript + Vite + Tailwind + Framer Motion + Leaflet/MapLibre). Only the
  data source differs.
- `src/services/api.ts` — in the full stack this file performs `fetch()` calls
  against the FastAPI backend. Here it serves the same function signatures
  (`config`, `delta`, `history`, `telemetryHistory`, `pause`, `resume`, `step`,
  `speed`, `cut`, `inject`, `ai`, `approve`, `veto`) from the in-browser
  engine, so `useTelemetry` and every component work unchanged.
- `src/services/mockEngine.ts` — a seeded, deterministic stand-in for the
  Python engine + API. It mirrors the backend's response contracts and
  committed constants (300 sites, 10 districts, 10 fiber rings, 10 crews,
  5-minute ticks at ~1/s, 30-day runs, X.733 alarm classes, gauge specs,
  palettes, roads). On load it pre-runs ~2 simulated days so the console opens
  on a world that already has history, weather, traffic shape, active faults
  and a moving fleet. All controls work: pause/resume/step/speed, fault
  injection, double fiber cuts, the AI toggle with tier-1/tier-2 Commander
  actions, approvals/vetoes and demo auto-approval.

## What still touches the network

Nothing is required. The vector street basemap loads OpenFreeMap /
OpenStreetMap tiles from the internet when available; without connectivity
(or offline) the map automatically falls back to the built-in schematic
corridor basemap — the full UI keeps working either way.

## What is *not* here

The Python simulation, the XGBoost Doctor, the GRU Oracle, FastAPI endpoints
and the study tooling. The mock engine is a faithful presentation simulation,
not a port of the physics; its predictions are shaped to behave like the real
system, not produced by trained models. For the genuine stack, use
`../frontend` together with the `autonoc/` package as described in the
repository root README.

## Layout

```
index.html                 entry page
src/
  App.tsx                  shell: nav rail, header, command bar, dialogs
  components/              map, KPI grid, alerts, analytics, inspector, modals…
  hooks/useTelemetry.ts    polling loop (unchanged)
  services/api.ts          mock API client  ← only swapped file
  services/mockEngine.ts   in-browser simulation  ← new file
  types/api.ts             wire contracts (unchanged)
  index.css                full design system (unchanged)
```
