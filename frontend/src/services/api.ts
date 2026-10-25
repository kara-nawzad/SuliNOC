import type {
  ActionResult,
  Config,
  RunHistory,
  Snapshot,
  TelemetryHistory,
  TelemetryTimeframe,
} from "../types/api";
import type { WaveChatReply, WaveProviderState, WaveTurn } from "../types/wave";

/** The backend refuses a new dashboard only when every slot is genuinely busy.
 * It is transient by design: the retry marker below tells the server that a
 * visitor is waiting, which lets it reclaim the least recently seen dashboard
 * instead of refusing again. */
const CAPACITY_CODE = "session_capacity";
const RETRY_HEADER = "X-AutoNOC-Retry";

/** The visitor's simulation run is identified by a session token. The server
 * issues it on the first response (x-autonoc-session) and also sets a cookie,
 * but a cross-site embed (or iOS storage partitioning) can drop the cookie. A
 * request with no token gets a brand-new run at tick 0, which is what made the
 * embedded dashboard show "The simulation run changed". So the token is kept in
 * sessionStorage and sent back on every request, like the single-file console. */
const SESSION_KEY = "suli-noc-session";
const SESSION_HEADER = "X-AutoNOC-Session";

function readSessionToken(): string | null {
  try {
    return sessionStorage.getItem(SESSION_KEY);
  } catch {
    return null; // storage blocked: fall back to the cookie alone
  }
}

function storeSessionToken(token: string) {
  try {
    sessionStorage.setItem(SESSION_KEY, token);
  } catch {
    /* storage blocked */
  }
}

async function send(
  path: string,
  init: RequestInit,
  timeoutMs = 15_000,
): Promise<Response> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = init.signal
    ? AbortSignal.any([init.signal, timeout])
    : timeout;
  const headers: Record<string, string> =
    init.headers instanceof Headers
      ? Object.fromEntries(init.headers.entries())
      : { ...((init.headers as Record<string, string> | undefined) ?? {}) };
  const token = readSessionToken();
  if (token) headers[SESSION_HEADER] = token;
  const response = await fetch(path, {
    ...init,
    headers,
    signal,
    cache: "no-store",
    credentials: "same-origin",
  });
  const issued = response.headers.get(SESSION_HEADER);
  if (issued) storeSessionToken(issued);
  return response;
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
        "SuliNOC is at capacity. Close an idle dashboard tab and try again.",
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
      "Dashboard API mismatch. Restart the updated SuliNOC backend.",
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
  waveStatus: (signal?: AbortSignal) =>
    request<WaveProviderState>("/api/wave/status", { signal }),
  waveChat: (question: string, runId: string, history: WaveTurn[]) =>
    request<WaveChatReply>("/api/wave/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, run_id: runId, history }),
    }),
  /** Streaming chat: the backend relays the provider's answer as SSE. onDelta
   * fires per chunk as it arrives; the promise resolves with the terminal
   * `done` metadata (same shape as the JSON reply) or rejects with the
   * server's user-facing error detail. A 404 status marks a backend without
   * the route so the caller can fall back to the JSON reply. */
  waveChatStream: async (
    question: string,
    runId: string,
    history: WaveTurn[],
    onDelta: (text: string) => void,
    signal?: AbortSignal,
  ): Promise<WaveChatReply> => {
    const response = await send(
      "/api/wave/chat/stream",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, run_id: runId, history }),
        signal,
      },
      60_000,
    );
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      const detail =
        typeof (body as { detail?: string } | null)?.detail === "string"
          ? (body as { detail: string }).detail
          : `Request failed (${response.status})`;
      const error = new Error(detail) as Error & { status?: number };
      error.status = response.status;
      throw error;
    }
    if (!response.body)
      throw new Error("The server returned an invalid response.");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    const consumeEvent = (raw: string): WaveChatReply | null => {
      let event = "message";
      const dataLines: string[] = [];
      for (const line of raw.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
      }
      if (!dataLines.length) return null;
      let payload: unknown;
      try {
        payload = JSON.parse(dataLines.join("\n"));
      } catch {
        return null;
      }
      if (event === "delta") {
        const text = (payload as { text?: unknown }).text;
        if (typeof text === "string" && text) onDelta(text);
        return null;
      }
      if (event === "error") {
        const detail = (payload as { detail?: unknown }).detail;
        throw new Error(
          typeof detail === "string" && detail
            ? detail
            : "Wave could not finish the answer. Please retry.",
        );
      }
      if (event === "done") return payload as WaveChatReply;
      return null;
    };

    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let separator = buffer.indexOf("\n\n");
      while (separator >= 0) {
        const raw = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);
        const result = consumeEvent(raw);
        if (result) return result;
        separator = buffer.indexOf("\n\n");
      }
    }
    if (buffer.trim()) {
      const result = consumeEvent(buffer);
      if (result) return result;
    }
    throw new Error("Wave’s answer ended unexpectedly. Please retry.");
  },
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
