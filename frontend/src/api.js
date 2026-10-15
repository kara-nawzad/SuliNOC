// Thin client for the AutoNOC FastAPI backend. Relative paths go through the
// same origin (FastAPI in production, Vite's proxy in development).

const CAPACITY_CODE = "session_capacity";
const RETRY_HEADER = "X-AutoNOC-Retry";

async function send(path, init = {}) {
  const timeout = AbortSignal.timeout(15000);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  return fetch(path, { ...init, signal, cache: "no-store" });
}

async function request(path, init = {}) {
  let response = await send(path, init);
  let body = await response.json().catch(() => null);
  if (response.status === 503 && body?.code === CAPACITY_CODE) {
    // A 503 never reached the engine, so retrying is safe even for controls.
    const hinted = Number(response.headers.get("Retry-After"));
    const wait = Number.isFinite(hinted) ? Math.min(Math.max(hinted, 0) * 1000, 1500) : 1000;
    await new Promise((r) => setTimeout(r, wait));
    response = await send(path, { ...init, headers: { ...(init.headers ?? {}), [RETRY_HEADER]: "1" } });
    body = await response.json().catch(() => null);
  }
  if (!response.ok) {
    if (body?.code === CAPACITY_CODE)
      throw new Error("SuliNOC is at capacity. Close an idle dashboard tab and try again.");
    throw new Error(typeof body?.detail === "string" ? body.detail : `Request failed (${response.status})`);
  }
  if (body === null) throw new Error("The server returned an invalid response.");
  return body;
}

export function validateSnapshot(value) {
  if (!value || !value.dashboard || !value.control || !Array.isArray(value.nodes) ||
      !Number.isFinite(value.tick) || typeof value.run_id !== "string") {
    throw new Error("Dashboard API mismatch. Restart the updated SuliNOC backend.");
  }
  return value;
}

async function control(path, runId, params = {}) {
  const query = new URLSearchParams(
    Object.entries({ ...params, run_id: runId }).map(([k, v]) => [k, String(v)]),
  );
  const result = await request(`/api/control/${path}?${query}`, { method: "POST" });
  if (result.ok === false || typeof result.error === "string")
    throw new Error(result.reason || result.error || "The engine rejected this action.");
  return result;
}

export const api = {
  config: () => request("/api/config"),
  delta: async (cursor) => validateSnapshot(await request(`/api/delta?since=${cursor}`)),
  history: () => request("/api/history"),
  telemetryHistory: (timeframe, runId) =>
    request(`/api/telemetry/history?${new URLSearchParams({ timeframe, run_id: runId })}`),
  pause: (runId) => control("pause", runId),
  resume: (runId) => control("resume", runId),
  step: (runId) => control("step", runId),
  speed: (value, runId) => control("speed", runId, { value }),
  cut: (ring, runId) => control("cut-fiber", runId, { ring_id: ring, isolate: true, cause: "construction" }),
  inject: (node, kind, runId) => control("inject", runId, { node_id: node, kind }),
  ai: (enabled, runId, autoApprove = 0) =>
    control("ai", runId, { enabled, auto_approve_seconds: autoApprove }),
  approve: (id, runId) => control(`approve/${id}`, runId),
  veto: (id, runId) => control(`veto/${id}`, runId),
};
