# SuliNOC console (frontend)

A plain JavaScript single-page console, bundled by Vite into `autonoc/web/dist` and served by
the FastAPI backend. There is no framework: `src/` holds small ES modules.

```
index.html          Shell, hero intro, sidebar, top bar, modal and toast containers
src/main.js         Boot, navigation, top-bar sim controls, search, delegated actions
src/store.js        Polls /api/delta every second; notifies views on snapshot or run change
src/api.js          Client for /api/config, /api/delta, /api/control/*, history, telemetry
src/views.js        Overview, Live network, Towers, Topology, Incidents, AI, Analytics, Maintenance, Settings
src/panels.js       Node inspector, scenario builder, counterfactual report, run history, about
src/map.js          Schematic SVG network map projected from the engine's lat/lon bounds
src/components.js   Sparklines, donut, gauges, chips
src/data/           counterfactual_summary.json (copied from reports/ when regenerated)
public/assets/      Logo and hero images
```

## Develop

```bash
cd frontend
npm install
npm run dev      # Vite on 0.0.0.0; /api is proxied to http://127.0.0.1:8000
npm run build    # writes autonoc/web/dist for the backend to serve
```

Run the backend in another terminal: `python -m uvicorn autonoc.api.main:app --port 8000`.

## What the console does

- **Overview:** availability, throughput, drop rate, offline and degraded sites, incidents, crews,
  AI actionable count, the site-power donut and fleet status, recent alerts.
- **Live network:** the map of sites, fibre rings, crews and routes; district and status filters;
  click a site to open its inspector. Pan with drag, zoom with the wheel.
- **Tower inventory:** searchable, filterable site table; rows open the inspector.
- **Topology:** each fibre ring with its state; a double cut is a two-click confirm.
- **Incidents:** active incidents and the severity-filtered event log.
- **AI predictions:** Commander on/off, precision against break-even, pending tier-2 actions with
  approve and veto, auto-approve delay, highest-risk sites.
- **Analytics:** 30 min / 24 h / 7 d telemetry charts, the counterfactual impact table, run history.
- **Maintenance:** crew states, targets, ETAs and the work queue.
- **Settings:** simulation speed, run details, and the scenario builders.

Top-bar controls (pause/resume, step, speed, cut fibre, inject fault, AI) work from every view.

All telemetry, positions, incidents and crew movements are simulated by the backend engine.
