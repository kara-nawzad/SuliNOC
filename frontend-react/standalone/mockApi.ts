// Offline stand-in for src/services/api.ts, used only by the single-file build.
// It serves a snapshot captured from the real engine (standalone/fixtures/*.json),
// so the screens show real layouts and values without a backend or a server.
import type {
  ActionResult,
  Config,
  RunHistory,
  Snapshot,
  TelemetryHistory,
  TelemetryTimeframe,
} from "../src/types/api";
import config from "./fixtures/config.json";
import delta from "./fixtures/delta.json";
import history from "./fixtures/history.json";
import tel30 from "./fixtures/telemetry-30m.json";
import tel24 from "./fixtures/telemetry-24h.json";
import tel7 from "./fixtures/telemetry-7d.json";

const SNAPSHOT = delta as unknown as Snapshot;
const OK = { ok: true } as unknown as ActionResult;
// Controls that visibly change the screen keep their state here.
const state = {
  paused: false,
  aiEnabled: SNAPSHOT.ai.ai_enabled,
};
function current(): Snapshot {
  return {
    ...SNAPSHOT,
    control: { ...SNAPSHOT.control, paused: state.paused },
    ai: { ...SNAPSHOT.ai, ai_enabled: state.aiEnabled },
  } as Snapshot;
}

export function validateSnapshot(value: Snapshot): Snapshot {
  return value;
}

const telemetry: Record<TelemetryTimeframe, unknown> = {
  "30m": tel30,
  "24h": tel24,
  "7d": tel7,
};

export const api = {
  config: async (_signal?: AbortSignal) => config as unknown as Config,
  delta: async (_cursor: number, _signal?: AbortSignal) => current(),
  history: async () => history as unknown as RunHistory,
  telemetryHistory: async (timeframe: TelemetryTimeframe, _runId: string) =>
    ({
      ...(telemetry[timeframe] as object),
      run_id: SNAPSHOT.run_id,
    }) as unknown as TelemetryHistory,
  pause: async (_runId: string) => {
    state.paused = true;
    return OK;
  },
  resume: async (_runId: string) => {
    state.paused = false;
    return OK;
  },
  step: async (_runId: string) => OK,
  speed: async (_value: number, _runId: string) => OK,
  cut: async (_ring: number, _runId: string) => OK,
  inject: async (_node: string, _kind: number, _runId: string) => OK,
  ai: async (enabled: boolean, _runId: string, _autoApprove = 0) => {
    state.aiEnabled = enabled;
    return OK;
  },
  approve: async (_id: number, _runId: string) => OK,
  veto: async (_id: number, _runId: string) => OK,
};
