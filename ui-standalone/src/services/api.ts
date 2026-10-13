/**
 * UI-only build: the api client serves every endpoint from the in-browser
 * mock engine (./mockEngine) instead of the FastAPI backend. The exported
 * surface is identical to the networked client in ../frontend, so the rest
 * of the application is completely untouched — hooks, components and modals
 * consume the same Config / Snapshot / ActionResult contracts.
 *
 * Endpoints mirrored: /api/config, /api/delta, /api/history,
 * /api/telemetry/history and every /api/control/* action.
 */
import type {
  ActionResult,
  Config,
  RunHistory,
  Snapshot,
  TelemetryHistory,
  TelemetryTimeframe,
} from "../types/api";
import { mockEngine } from "./mockEngine";

/** Small artificial latency so controls feel like a server round-trip. */
function respond<T>(value: T): Promise<T> {
  return new Promise((resolve) =>
    setTimeout(() => resolve(value), 30 + Math.random() * 50));
}

function fail(message: string): never {
  throw new Error(message);
}

export function validateSnapshot(value: Snapshot): Snapshot {
  // Same guard as the networked client: fail visibly, never render zeroes.
  if (
    !value.dashboard ||
    !value.control ||
    !Array.isArray(value.nodes) ||
    !Number.isFinite(value.tick) ||
    typeof value.run_id !== "string"
  ) {
    fail("Dashboard API mismatch. Restart the updated AutoNOC backend.");
  }
  return value;
}

async function control(
  action: () => ActionResult,
): Promise<ActionResult> {
  const result = await respond(action());
  if (result.ok === false || typeof result.error === "string")
    fail(result.reason || result.error || "The engine rejected this action.");
  return result;
}

export const api = {
  config: (_signal?: AbortSignal) => respond<Config>(mockEngine.config),
  delta: async (_cursor?: number, _signal?: AbortSignal) =>
    validateSnapshot(await respond<Snapshot>(mockEngine.snapshot())),
  history: () => respond<RunHistory>({ summaries: mockEngine.runHistory() }),
  telemetryHistory: (timeframe: TelemetryTimeframe, runId: string) =>
    respond<TelemetryHistory>(mockEngine.telemetryHistory(timeframe, runId)),
  pause: (runId: string) => control(() => mockEngine.pause(runId)),
  resume: (runId: string) => control(() => mockEngine.resume(runId)),
  step: (runId: string) => control(() => mockEngine.stepOnce(runId)),
  speed: (value: number, runId: string) =>
    control(() => mockEngine.setSpeed(value, runId)),
  cut: (ring: number, runId: string) =>
    control(() => mockEngine.cutFiber(ring, runId)),
  inject: (node: string, kind: number, runId: string) =>
    control(() => mockEngine.inject(node, kind, runId)),
  ai: (enabled: boolean, runId: string, autoApprove = 0) =>
    control(() => mockEngine.setAi(enabled, runId, autoApprove)),
  approve: (id: number, _runId: string) =>
    control(() => mockEngine.approveAction(id)),
  veto: (id: number, _runId: string) => control(() => mockEngine.vetoAction(id)),
};
