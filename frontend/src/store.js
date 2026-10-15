// Single source of truth for the console. Polls /api/delta once a second,
// keeps the latest backend snapshot, and notifies subscribers. Nothing here
// fabricates telemetry: if the backend is unreachable the status says so.
import { api } from "./api.js";

const state = {
  config: null,
  snap: null,          // latest DeltaResponse
  online: false,
  error: null,
  runId: null,
  nodeById: new Map(),
};
const subs = new Set();

export const getState = () => state;
export function subscribe(fn) {
  subs.add(fn);
  return () => subs.delete(fn);
}
function emit(kind) {
  for (const fn of subs) fn(kind, state);
}

export async function loadConfig() {
  state.config = await api.config();
  emit("config");
  return state.config;
}

let timer = null;
async function poll() {
  try {
    const snap = await api.delta(0);
    const newRun = state.runId !== null && snap.run_id !== state.runId;
    state.runId = snap.run_id;
    state.snap = snap;
    state.nodeById = new Map(snap.nodes.map((n) => [n.id, n]));
    state.online = true;
    state.error = snap.run_error || null;
    emit(newRun ? "run" : "snapshot");
  } catch (err) {
    state.online = false;
    state.error = err.message;
    emit("offline");
  }
  timer = setTimeout(poll, state.config?.presentation?.poll_ms ?? 1000);
}

export function startPolling() {
  if (!timer) poll();
}

// Refresh immediately after a control action so the UI does not wait a tick.
export async function refreshNow() {
  clearTimeout(timer);
  timer = null;
  await poll();
}
