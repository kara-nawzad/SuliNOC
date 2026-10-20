# Contributing to SuliNOC

SuliNOC is a simulation-backed telecom operations demo. Contributions should keep simulated results, UI projections, and operational behavior distinct; do not present model outputs as measured operator savings.

## Development setup

Use Node.js 22+ and Python 3.12. Follow the platform-specific setup in the [README](README.md), then install the React app dependencies:

```bash
npm ci --prefix frontend
```

## Verification

Run the checks relevant to your change from the repository root:

```bash
python -m pytest tests/ -q
npm test --prefix frontend
npm run build --prefix frontend
```

The Esri status/retry browser smoke test runs against a local API. Install Chromium once, then run:

```bash
cd frontend
npx playwright install chromium
npm run test:e2e -- tests/map-status.spec.ts
```

Playwright starts the API automatically when `AUTONOC_TEST_URL` is unset. Setting that variable opts into an already-running test server instead. The active GitHub Actions workflow runs this smoke test, the frontend unit suite/build, and the Python suite; deployment is restricted to successful pushes to `main`.

`npm run format:check --prefix frontend` is advisory for now: existing formatting debt is documented in the README. Format files you change with Prettier, and do not reformat unrelated files as part of a focused change.

## Data, models, and generated output

- `reports/counterfactual_summary.json` is the canonical M7 source used by the UI. Do not hand-edit displayed study values or regenerate the report as a side effect of frontend work. If a deliberate study rerun is proposed, document the command, environment, inputs, and resulting artifact review in the PR.
- Model artifacts under `models/` are intentional runtime inputs. Do not replace or regenerate them without an explicit, reviewed reason.
- Regenerable datasets, build output, Playwright output, `node_modules`, and the generated single-file standalone UI are not source files. Respect the repository ignore rules; do not add generated outputs to commits.

## UI and asset changes

Read [the asset guide](docs/ASSETS.md) before adding or replacing images, fonts, logos, or map data. Include the source and license/provenance for new third-party assets, avoid secrets or provider keys, and search the whole repository before removing a file that may be referenced by a build, test, script, or document.

## Pull requests

Keep changes scoped, explain user-visible effects and any limitations, and report the exact tests run. Do not commit credentials, live user data, or unreviewed generated results. The public demo is intentionally an unauthenticated simulation; do not infer that it is suitable for exposure as an operator service.
