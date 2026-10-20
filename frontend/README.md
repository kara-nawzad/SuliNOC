# AutoNOC React command center

The canonical web UI lives in `frontend/`. It uses React 18, TypeScript, Vite, Tailwind CSS 4,
Framer Motion, Lucide, and React Leaflet. Fonts are bundled locally. Operational telemetry is read
from the API; the M7 study display imports the committed `reports/counterfactual_summary.json`
directly so its displayed metrics do not drift from the report.

## Build and run

From the repository root, with the Python dependencies installed:

```sh
npm ci --prefix frontend
npm run build --prefix frontend
python -m uvicorn autonoc.api.main:app --host 0.0.0.0 --port 8000
```

Open `http://localhost:8000`. Vite writes the production build to `autonoc/web/dist`, which FastAPI
serves at `/`; the existing `autonoc/web/` app remains a fallback if no React build is present. The
Dockerfile builds the UI in its Node stage and copies only the built files into the Python runtime.
It also copies the canonical M7 JSON into the frontend build stage so the same import works in Docker.

For hot reload, keep the API on port 8000 and run this in another terminal:

```sh
npm run dev --prefix frontend
```

Open Vite's URL (normally port 5173). Browser API requests use relative `/api` paths and Vite proxies
them to the API. The Vite server binds to `0.0.0.0` for preview environments.

## Main interactions

- Header: pause/resume, paused single-step, 0.25–10× speed, fiber-cut demo, supported node faults,
  and AI enable/disable.
- Map: Esri World Street Map raster tiles under Leaflet network overlays. The local schematic stays
  available; the map shows loading/ready/unavailable status and offers a retry if initial tile loads
  fail. Esri tiles require network access. Attribution remains visible.
- Search, incident list, active and completed-run history, site inspection, analytics, and fleet
  status are driven by API snapshots/configuration. Formatting, search, filtering, and map marker
  geometry are client presentation logic—not operational predictions.
- The counterfactual modal shows A-vs-C outcomes from the committed M7 JSON, including confidence
  intervals and model-cost units. The separate live dollar scenario is illustrative and uses stated
  assumptions; it is not an observed saving. The JSON was not regenerated during this cleanup.
- Dialogs use native focus management and Escape handling; controls have accessible names and visible
  focus styles. Reduced-motion preferences disable decorative movement.

The API and demo controls are unauthenticated by design for the public simulation. This is not a
production operator service; do not expose writable instances to untrusted networks.

## Verification

```sh
npm test --prefix frontend
npm run build --prefix frontend
python -m pytest tests/ -q
```

The existing Prettier check is advisory only: it currently finds formatting debt in 16 files and is
not part of CI.

Playwright requires Chromium. The config starts a local API automatically unless `AUTONOC_TEST_URL`
is set to an existing test server. The CI-gated smoke test exercises Esri tile failure status and retry:

```sh
cd frontend
npx playwright install chromium
npm run test:e2e -- tests/map-status.spec.ts
```

The active GitHub Actions workflow runs Vitest, the production build, this map-status smoke test, and
the Python suite on pull requests and pushes to `main`. See the root README for the API, deployment,
and study interpretation.
