# Contributing to SuliNOC

SuliNOC is a simulation-backed telecom operations demo. Contributions should keep simulated results, UI projections, and operational behavior distinct; do not present model outputs as measured operator savings.

## Development setup

Use Node.js 22+ and Python 3.12. From the repository root, install the pinned Python development/test dependencies and frontend packages:

```bash
python -m pip install -r requirements-dev.txt
npm ci --prefix frontend
```

`requirements.txt` is the runtime set; `requirements-dev.txt` adds pytest and HTTPX. Both use `constraints-py312.txt`. The runtime file selects the CPU-only PyTorch wheel from the official CPU index. `requirements-py312.in` is the source for the transitive constraints (PyTorch itself is pinned separately because it is resolved from that CPU index). To regenerate the constraints after reviewing direct dependency changes, install `uv` and run:

```bash
uv pip compile --python-version 3.12 --universal --no-managed-python --no-python-downloads --output-file constraints-py312.txt requirements-py312.in
```

## Verification

Run the checks relevant to your change from the repository root:

```bash
python -m pytest tests/ -q
npm run format:check --prefix frontend
npm test --prefix frontend
npm run build --prefix frontend
```

The Esri status/retry browser smoke test also verifies the hero welcome page's local image and font assets. It runs against a local API. Install Chromium once, then run:

```bash
cd frontend
npx playwright install chromium
npm run test:e2e -- e2e/map-status.spec.ts
```

Playwright starts the API automatically when `AUTONOC_TEST_URL` is unset. Setting that variable opts into an already-running test server instead. GitHub Actions runs the Python suite, frontend format/unit/build gates, this browser smoke test, and a Docker image build without pushing the image on pull requests targeting `main` and pushes to `main`. Pull requests are validation-only; deployment is limited to successful pushes to `main`.

## Data, models, and generated output

- `reports/counterfactual_summary.json` is the canonical M7 source used by the UI. Do not hand-edit displayed study values or regenerate the report as a side effect of frontend work. If a deliberate study rerun is proposed, document the command, environment, inputs, and resulting artifact review in the PR.
- Model artifacts under `models/` are intentional runtime inputs. Do not replace or regenerate them without an explicit, reviewed reason.
- Regenerable datasets, build output, browser-test output, and `node_modules` are not source files. Respect the repository ignore rules; do not add generated outputs to commits.

## UI and asset changes

Read [the asset guide](docs/ASSETS.md) before adding or replacing images, fonts, logos, or map data. Include the source and license/provenance for new third-party assets, avoid secrets or provider keys, and search the whole repository before removing a file that may be referenced by a build, test, script, or document.

## Pull requests

Keep changes scoped, explain user-visible effects and any limitations, and report the exact tests run. Do not commit credentials, live user data, or unreviewed generated results. The public demo is intentionally an unauthenticated simulation; do not infer that it is suitable for exposure as an operator service.
