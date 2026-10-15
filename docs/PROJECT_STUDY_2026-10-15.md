# AutoNOC — whole-project study and change list

**Reviewed:** 2026-10-15
**Baseline:** `264b831` (merge of PR #10), branch `arena/a64422f6-sulinoc`
**Supersedes for open items:** `docs/PROJECT_STUDY_2026-10-03.md` (that review's P1
delivery findings have since been fixed; its remaining findings are re-verified
below against the current code)

This is an independent pass over the current tree: engine, AI, API, React
frontend, tests, docs, CI, and GitHub state. No application code was changed to
produce it.

## 1. Verified health snapshot

| Check | Result |
|---|---|
| Backend suite (`pytest`, Python 3.11, torch 2.14 CPU wheel) | **117 passed, 6 skipped, 0 failed** |
| Skipped tests | data-dependent (`@needs_data` / `needs_seq`): `data/` is gitignored and regenerable |
| Frontend suite (`npm test`, Vitest) | **29 passed (8 files)** |
| Playwright config | present (`frontend/playwright.config.ts`), exercised via `docs/ci-proposed.yml` |
| Model artifacts | committed and loadable (`doctor_xgb.json`, `doctor_scaler.npz`, `oracle_gru.pt`, `oracle_stats.npz`) — the live server boots in ML mode |
| Working tree | clean |

The codebase is in good shape: the layered design holds, the invariants suite is
green, and the December-2026-era delivery bugs from the previous study are gone.
The remaining changes fall into four buckets: **evaluation honesty**, **live AI
contract**, **CI/deployment**, and **hygiene/docs**.

## 2. What the previous study flagged — now fixed (verified in code)

| Old finding | Evidence it is resolved |
|---|---|
| P1: normal telemetry never reached delta clients | `/api/delta` now returns bounded full node/teams/logs snapshots (`main.py:532`, `598`); the lossy dirty-flag delta is gone |
| P1: warning updates consumed by the first reader; GET mutated state | GET is read-only; warning flips and same-tick controls ride the snapshot to every reader (`main.py:14-15`) |
| P1: shared simulation, no isolation | Per-browser session engines with cookies, capacity, idle expiry (`api/sessions.py`, `tests/test_sessions.py`), plus the `SESSION_CAPACITY_FIX` iteration |
| P2: finite schedule silently expired | Day-30 tick completes a run summary and resets under a new `run_id` (`main.py:288-292`, `api/run_history.py`) |
| P2: worker restart/lifecycle chaos | `InferenceWorker` has stop/run-id generation tokens; scoring results from a stale run are discarded (`serve.py:225-236`) |
| P3: legacy vanilla JS UI concentration | React 18 + TypeScript app in `frontend/` is the served UI (Docker builds `frontend/` into `autonoc/web/dist`); 29 Vitest tests plus component tests |

## 3. Changes we still have to make

Priorities carry over the 2026-10-03 convention: **P1** before trusting live
results or public claims, **P2** before expanding models/features, **P3**
polish.

### P1 — evaluation honesty

1. **Non-uniform `NoisePool.random()` skews every probability drawn from it.**
   `engine/noise.py:32-45` maps a Gaussian through `0.5 + 0.5·(v/(1+|v|))` and
   calls the result "uniform". It is strongly concentrated around 0.5, so any
   coin flip `x < prob` through `NoisePool.random()/uniform()` — grid dropout
   and restoration in `physics.py`, ATS crank failure, fuel theft, etc. — fires
   far less often than configured (or more, for thresholds near 0.5).
   **Change:** give `NoisePool` a true uniform stream (pre-drawn `random()` pool
   or a separate seeded `Random` cursor), re-verify event frequencies
   statistically (new test), and accept that this shifts simulated dynamics —
   regenerating `reports/` and documenting the break with old artifacts.

2. **Oracle thresholds are chosen on test labels, and live policy uses
   uncalibrated scores.** `ai/oracle.py:221,235,301` calls
   `best_threshold(yte, …)` for B2/B3/M reporting; the live Commander compares
   raw GRU-sigmoid output against the cost-derived `0.4375`
   (`api/main.py:538` `warn` flag, `commander.decision`).
   **Change:** split train/validation/test (validation picks thresholds; test
   reports once), add probability calibration (e.g. isotonic on validation),
   and run the live policy through a paired evaluation of the calibrated
   cutoff.

3. **Tier-1 pre-emption silently consults simulator ground truth.**
   `engine/engine.py:568-578` — before a tier-1 mitigation is applied, the
   engine reads the ledger's actual fault kind and only proceeds for
   congestion/overheat. A real controller cannot do this; the autonomous arm of
   the study therefore never pays for false-positive tier-1 actions, making it
   look better than a telemetry-only policy would.
   **Change:** let tier-1 actions fire on the Doctor's classification alone,
   charge the modeled cost when wrong (pre-emption fails, fault lands), and
   re-run the four-arm study. This is also the honest version of the story the
   README tells.

### P1 — exposure and deployment

4. **CI deploys to Fly.io without running tests, including on pull-request
   events.** `.github/workflows/ci.yml` is deploy-only and triggers on
   `pull_request`. `docs/ci-proposed.yml` already contains the intended
   test-gated workflow (frontend build + Vitest, pytest, Playwright smoke,
   `deploy` needs `test`) but was never activated because the app connection
   lacked `workflows` write permission.
   **Change:** activate the proposed workflow (via a GitHub-authorized commit
   or the web editor — no credentials in chat), and stop deploying PR builds to
   the public demo.

5. **Wildcard CORS and unauthenticated controls.**
   `main.py:387-388` sets `allow_origins=["*"]` while the app is cookie
   session-based, and every control endpoint (pause, speed, fault injection,
   fiber cut, reset) is open to any caller. For a public demo this is a
   deliberate trade-off, but the combination is worth tightening.
   **Change:** restrict CORS to the served origin(s), keep same-site cookies
   (`samesite=lax` is already set), and consider a lightweight control guard
   (origin check or an admin token for destructive endpoints like reset).

6. **Legacy `autonoc/web/app.js` still ships an HTML injection sink.**
   The React app escapes text safely (verified: `AlertsSidebar` renders
   `{alarm.title}` as text), but `autonoc/web/` — mounted at `/static` and used
   as the fallback UI when `dist/` is missing — renders log messages via
   `innerHTML` (`app.js:202` feed item, `436` inspector). User-supplied fiber-cut
   descriptions reach that sink.
   **Change:** either delete the legacy UI now that `dist` is the primary
   build, or render `l.message` with `textContent` and drop the string-templated
   HTML.

### P2 — live AI contract

7. **The advertised rules fallback is still not wired into live scoring.**
   `rules_verdicts()` (`ai/serve.py:57`) is used by the counterfactual study and
   `cast_seed.py`, but `InferenceWorker._score_batch → _combine` never calls it:
   if a model is missing, `_combine` substitutes `p_fail = 0.0` and the
   Commander quietly does nothing while `ai_mode` reports `"rules"`.
   **Change:** route `_combine` through `rules_verdicts` when the bundle is
   incomplete, with an explicit mode string (`ml | partial | rules | off`) and a
   test that kills the models and asserts rules actions actually happen.

8. **Train and live read different observations.** Training windows
   (`seqdata._read`) sample raw node attributes after the full `step()`;
   live Oracle windows (`serve._window`) rebuild from `hist_fine`, which is
   captured mid-step (before ripple, dispatch, repairs). The Doctor's
   `build_vector` is shared, but the Oracle path is not.
   **Change:** one shared observation/window pipeline used by `seqdata`,
   `serve`, and the study; add the boundary-tick equivalence test.

9. **Unpinned dependencies and unprovenanced artifacts.** `requirements.txt`
   has no versions and its `--index-url` line for torch is a documented no-op;
   `models/` and `reports/` carry no machine-readable run manifest.
   **Change:** a lock file (or pinned direct deps), and a small
   `reports/manifest.json` (git SHA, config hash, seeds, package versions)
   written by `counterfactual.py` and the training scripts.

### P3 — hygiene and docs

10. **Doc drift in `docs/PROJECT_NOTES.md`.** §3/§18 metric tables still quote
    Doctor `0.995 / 1.000 / 7e−5` and Oracle `AUC-PR 0.547 / recall 0.450 /
    +9.2% lift`; the committed artifacts say `0.98723 / 0.99935 / 1.79e−4` and
    `0.54643 / 0.44185 / ~8.9%`. Update the tables to the artifacts.
11. **PR #9 ("Isolate AutoNOC simulation sessions per browser") is stale.**
    Its tree is a strict subset of current `main` (verified by diff: PR #9 lacks
    the session-capacity fix, run history, and tests that PR #10 added). Close
    it as superseded.
12. **Packaging:** still no `pyproject.toml`; fine for the demo, but a minimal
    package metadata file would pin the supported Python and expose
    `autonoc` properly to tests and tools.
13. **Legacy UI decision** — after item 6, either remove `autonoc/web/*.js/css`
    or mark it explicitly as the offline fallback and keep it test-covered.

## 4. Suggested order of work

1. **CI gate first** (item 4) — everything else is safer with tests in front of
   the deploy.
2. **Noise uniformity** (item 1) — it changes simulated dynamics, so it should
   land before any retraining or study regeneration; then items 2 and 3
   (threshold calibration, truth-gate removal) and finally regenerate
   models/reports and update headline numbers once semantics stabilize.
3. **Live AI contract** (items 7, 8) with their new tests.
4. **Exposure** (items 5, 6).
5. **Hygiene** (items 9-13).

Note the dependency: items 1-3 can invalidate the committed M7 table and the
README/`PROJECT_NOTES` numbers. Plan one "re-run and re-quote" pass at the end
rather than editing claims along the way.

## 5. Highest-value new tests (from this pass)

1. Statistical frequency test: configured probabilities (grid dropout, ATS
   crank, fuel theft) match observed frequencies over long seeded runs.
2. `rules_verdicts` is actually used when models are absent (kill the bundle,
   assert non-empty rule actions and `ai_mode == "rules"`).
3. Oracle window extraction from `seqdata` equals the live `serve` extraction on
   fault/ripple/repair boundary ticks.
4. Threshold/calibration provenance: the reported test metric is computed at a
   threshold fixed without test labels.
5. False-positive tier-1: a wrong classification still executes its action and
   charges the modeled cost (no ledger consultation).
6. CI smoke job asserts `pytest` and `npm test` before deploy.

## 6. Standing contracts (unchanged from the previous study)

- Engine purity (I2 AST test), deterministic seeds (I3), engine-owned clock (I1),
  `/api/config` as the display source of truth (I5), render-never-compute UI (I6).
- The Doctor's 71-feature order and Oracle's 12-channel order are versioned
  artifact contracts — physics changes require retraining and re-quoting, not
  silent reuse.

## 7. Changes applied in this session (2026-10-15)

| Item | Status | Notes |
|---|---|---|
| 1. Noise uniformity (P1) | **done** | true U(0,1) pool in `NoisePool`; statistical uniformity + dropout-rate tests in `tests/test_power_fleet.py` |
| "Site power & fleet" donut (user-reported) | **done** | root cause was item 1 plus an architecture-blind power machine: Type C Goizha is now off-grid Solar/Battery/DG, A/B ride Grid→Battery→DG with Solar only where PV exists; the DG latches (`dg_running`) instead of re-rolling the ATS coin around the crank threshold; donut contract tests on both sides (`test_power_fleet.py`, `AnalyticsRow.test.tsx`) |
| 2. Oracle thresholds/calibration (P1) | **code done** | chronological validation holdout picks thresholds; Platt calibration fitted there and consumed by the live Commander when present; artifacts need regeneration to carry it |
| 3. Truth-gate (P1) | **done** | `PREEMPTABLE_BY_TIER1` is world physics in `mark_preempted`; the controller commits on its verdict. Tier-1 attempts settle as 60-min **bets** against real failures (the tier-2 standby symmetry): a failure inside the Oracle horizon is a true positive even when the mitigation could not stop it, and only an uneventful window is a false dispatch. Tests pin all three settlements |
| 4. CI gate (P1) | **done** | `.github/workflows/ci.yml` = test job + main-only deploy (push accepted; the old workflow-write blocker is gone) |
| 5. CORS/controls (P1) | **done** | same-origin default, `AUTONOC_ALLOWED_ORIGINS` escape hatch; per-session isolation already bounds control abuse |
| 6. Legacy HTML sink (P1) | **done** | `web/app.js` FM feed renders messages with `textContent` |
| 7. Rules fallback (P2) | **done** | live `_score_batch`/`score_engine` call `rules_verdicts` when both models are down; honest `ml/partial/rules` modes surfaced as `ai_mode` |
| 8. Train/live windows (P2) | open | still two extraction paths (`seqdata` vs `serve._window`) |
| 9. Provenance (P2) | **done** | `reports/manifest.json` written by `counterfactual.py` (git head, config hash, package versions, artifact hashes); `httpx` added to requirements |
| 10-13. Hygiene (P3) | **done** | `PROJECT_NOTES` metrics tables now quote the committed artifacts; §29 CI item closed; PR #9 closed as superseded |

**Still required: one regeneration pass.** The committed `models/` and
`reports/` predate the noise/power semantics changes, the truth-gate removal
and validation-split thresholds. Re-run
`dataset → train → seqdata → oracle → counterfactual` and re-quote the README
and `PROJECT_NOTES` headline numbers from the new artifacts before treating
the M7 table as current for this engine.
