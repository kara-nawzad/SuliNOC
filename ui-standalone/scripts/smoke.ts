/** Headless smoke test for the in-browser mock engine (dev tool, not shipped). */
import { mockEngine } from "../src/services/mockEngine";
import type { Snapshot } from "../src/types/api";

function assert(condition: unknown, label: string) {
  if (!condition) {
    console.error(`FAIL: ${label}`);
    process.exitCode = 1;
  } else {
    console.log(`ok: ${label}`);
  }
}

const snap: Snapshot = mockEngine.snapshot();
assert(snap.nodes.length === 300, "300 sites in snapshot");
assert(snap.teams.length === 10, "10 crews in snapshot");
assert(snap.agg.length === 10, "10 districts");
assert(snap.rings.length === 10, "10 fiber rings");
assert(snap.run_id.length > 8, "run id present");
assert(snap.kpis.healthy + snap.kpis.congestion + snap.kpis.overheat + snap.kpis.rf + snap.kpis.power + snap.kpis.backhaul === 300, "kpi status counts sum to 300");
assert(snap.dashboard.history.length > 1, "dashboard history pre-warmed");
assert(snap.dashboard.power.reduce((a, p) => a + p.count, 0) === 300, "power distribution covers all sites");
assert(snap.dashboard.fleet.IDLE + snap.dashboard.fleet.EN_ROUTE + snap.dashboard.fleet.STANDBY + snap.dashboard.fleet.REPAIRING + snap.dashboard.fleet.RETURNING === 10, "fleet states sum to 10");
assert(snap.dashboard.top_cells.length === 4, "top cells list");
assert(snap.logs.length > 0, "event log populated");

// telemetry history windows
const h30 = mockEngine.telemetryHistory("30m", snap.run_id);
assert(h30.samples.length === 7, "30m window = 7 samples");
const h24 = mockEngine.telemetryHistory("24h", snap.run_id);
assert(h24.samples.length === 289, "24h window = 289 samples");
const h7 = mockEngine.telemetryHistory("7d", snap.run_id);
assert(h7.samples.length <= 2017 && h7.samples.length > 300, "7d window bounded by warmup");

// controls
mockEngine.pause(snap.run_id);
assert(mockEngine.snapshot().control.paused, "pause");
mockEngine.stepOnce(snap.run_id);
assert(mockEngine.snapshot().tick === snap.tick + 1, "manual step while paused");
mockEngine.setSpeed(4, snap.run_id);
assert(mockEngine.snapshot().control.speed === 4, "speed set");
mockEngine.setSpeed(1, snap.run_id);
mockEngine.resume(snap.run_id);
assert(!mockEngine.snapshot().control.paused, "resume");

// fault injection
const healthy = snap.nodes.find((n) => n.status === 0)!;
mockEngine.inject(healthy.id, 3, snap.run_id);
const afterInject = mockEngine.snapshot();
assert(afterInject.nodes.find((n) => n.id === healthy.id)?.status === 3, "fault injected");
let rejected = false;
try {
  mockEngine.inject(healthy.id, 3, snap.run_id);
} catch {
  rejected = true;
}
assert(rejected, "double inject rejected");

// fiber cut
const cut = mockEngine.cutFiber(2, snap.run_id) as { ok: boolean };
assert(cut.ok, "fiber cut accepted");
const afterCut = mockEngine.snapshot();
const ring2 = afterCut.rings[2];
assert(ring2.cuts.length === 2 && ring2.isolated, "ring isolated by double cut");
assert(afterCut.nodes.some((n) => n.status === 5), "backhaul nodes dark");
assert(afterCut.dashboard.incidents.some((i) => i.id === "ring-2"), "ring incident raised");

// AI commander
mockEngine.setAi(true, snap.run_id, 0);
const aiSnap = mockEngine.snapshot();
assert(aiSnap.ai.ai_enabled && aiSnap.ai.ai_mode === "ml", "AI enabled");
for (let i = 0; i < 40; i++) {
  // @ts-expect-error drive private stepping for the test
  mockEngine["step"]();
}
const withAi = mockEngine.snapshot();
console.log(`  pending actions: ${withAi.ai.pending.length}, actionable forecasts: ${withAi.dashboard.actionable_predictions}, masked: ${withAi.kpis.masked}`);
if (withAi.ai.pending.length > 0) {
  const action = withAi.ai.pending[0];
  const verdict = mockEngine.approveAction(action.action_id) as { ok: boolean };
  assert(verdict.ok, "approval accepted");
  assert(!mockEngine.snapshot().ai.pending.some((a) => a.action_id === action.action_id), "approved action removed from queue");
}
assert(withAi.dashboard.forecast === null || withAi.dashboard.forecast.probability > 0, "forecast shape valid");

// run history
assert(mockEngine.runHistory().length >= 2, "completed-run summaries available");

console.log(process.exitCode ? "SMOKE TEST FAILED" : "SMOKE TEST PASSED");
process.exit(process.exitCode ?? 0);
