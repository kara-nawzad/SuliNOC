import type {
  ActionResult,
  Config,
  RunHistory,
  Snapshot,
  TelemetryHistory,
  TelemetryTimeframe,
} from "../types/api";

/** The backend refuses a new dashboard only when every slot is genuinely busy.
 * It is transient by design: the retry marker below tells the server that a
 * visitor is waiting, which lets it reclaim the least recently seen dashboard
 * instead of refusing again. */
const CAPACITY_CODE = "session_capacity";
const RETRY_HEADER = "X-AutoNOC-Retry";

async function send(path: string, init: RequestInit): Promise<Response> {
  const timeout = AbortSignal.timeout(15_000);
  const signal = init.signal
    ? AbortSignal.any([init.signal, timeout])
    : timeout;
  return fetch(path, { ...init, signal, cache: "no-store" });
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  // Relative paths deliberately use Vite's proxy / FastAPI's same origin.
  let response = await send(path, init);
  let body = await response.json().catch(() => null);
  if (
    response.status === 503 &&
    (body as { code?: string } | null)?.code === CAPACITY_CODE
  ) {
    const hinted = Number(response.headers.get("Retry-After"));
    const wait = Number.isFinite(hinted)
      ? Math.min(Math.max(hinted, 0) * 1000, 1500)
      : 1000;
    await new Promise((resolve) => setTimeout(resolve, wait));
    // A 503 never reached the engine, so repeating the request is safe even
    // for POST controls.
    response = await send(path, {
      ...init,
      headers: { ...(init.headers ?? {}), [RETRY_HEADER]: "1" },
    });
    body = await response.json().catch(() => null);
  }
  if (!response.ok) {
    if ((body as { code?: string } | null)?.code === CAPACITY_CODE)
      throw new Error(
        "AutoNOC is at capacity. Close an idle dashboard tab and try again.",
      );
    const detail =
      typeof body?.detail === "string"
        ? body.detail
        : `Request failed (${response.status})`;
    throw new Error(detail);
  }
  if (body === null)
    throw new Error("The server returned an invalid response.");
  return body as T;
}
export function validateSnapshot(value: Snapshot): Snapshot {
  // Fail visibly rather than silently rendering an old backend as zeroes.
  if (
    !value.dashboard ||
    !value.control ||
    !Array.isArray(value.nodes) ||
    !Number.isFinite(value.tick) ||
    typeof value.run_id !== "string"
  ) {
    throw new Error(
      "Dashboard API mismatch. Restart the updated AutoNOC backend.",
    );
  }
  return value;
}
async function control(
  path: string,
  runId: string,
  params: Record<string, string | number | boolean> = {},
): Promise<ActionResult> {
  const query = new URLSearchParams(
    Object.entries({ ...params, run_id: runId }).map(([key, val]) => [
      key,
      String(val),
    ]),
  );
  const result = await request<ActionResult>(`/api/control/${path}?${query}`, {
    method: "POST",
  });
  if (result.ok === false || typeof result.error === "string")
    throw new Error(
      result.reason || result.error || "The engine rejected this action.",
    );
  return result;
}
export const api = {
  config: (signal?: AbortSignal) => request<Config>("/api/config", { signal }),
  delta: async (cursor: number, signal?: AbortSignal) =>
    validateSnapshot(
      await request<Snapshot>(`/api/delta?since=${cursor}`, { signal }),
    ),
  history: () => request<RunHistory>("/api/history"),
  telemetryHistory: (timeframe: TelemetryTimeframe, runId: string) => {
    const query = new URLSearchParams({ timeframe, run_id: runId });
    return request<TelemetryHistory>(`/api/telemetry/history?${query}`);
  },
  pause: (runId: string) => control("pause", runId),
  resume: (runId: string) => control("resume", runId),
  step: (runId: string) => control("step", runId),
  speed: (value: number, runId: string) => control("speed", runId, { value }),
  cut: (ring: number, runId: string) =>
    control("cut-fiber", runId, {
      ring_id: ring,
      isolate: true,
      cause: "construction",
    }),
  inject: (node: string, kind: number, runId: string) =>
    control("inject", runId, { node_id: node, kind }),
  ai: (enabled: boolean, runId: string, autoApprove = 0) =>
    control("ai", runId, { enabled, auto_approve_seconds: autoApprove }),
  approve: (id: number, runId: string) => control(`approve/${id}`, runId),
  veto: (id: number, runId: string) => control(`veto/${id}`, runId),
};
