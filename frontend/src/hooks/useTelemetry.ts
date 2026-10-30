import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../services/api";
import type { Config, Snapshot, TelemetrySample } from "../types/api";

/** A poll that has not answered in this long is treated as lost: a stalled
 * socket must not hold the dashboard on a stale frame until the browser gives
 * up. The handshake is exempt — a cold backend has to build a world first. */
const POLL_TIMEOUT_MS = 4000;
/** An outage backs off from 2 s to 30 s instead of hammering a dead server. */
const BACKOFF_MIN_MS = 2000;
const BACKOFF_MAX_MS = 30_000;

/** Merge the seeded window into what this tab has already seen.
 *
 * The seed arrives after the first delta, so the newest tick is in both. Live
 * rows win at the seam (they are the ones the dashboard is drawing), and the
 * result stays one row per tick, oldest first, capped at the dashboard window.
 */
export function mergeHistorySeed(
  live: TelemetrySample[],
  seed: TelemetrySample[],
  limit = 30,
): TelemetrySample[] {
  const byTick = new Map<number, TelemetrySample>();
  for (const row of seed) byTick.set(row.tick, row);
  for (const row of live) byTick.set(row.tick, row); // live wins
  return [...byTick.values()].sort((a, b) => a.tick - b.tick).slice(-limit);
}

/** One cancellable request at a time. Controls can request an immediate refresh
 * without racing older polls. History and simulation time always come from Python. */
export function useTelemetry() {
  const [config, setConfig] = useState<Config | null>(null);
  const [data, setData] = useState<Snapshot | null>(null);
  const [status, setStatus] = useState<"connecting" | "live" | "reconnecting">(
    "connecting",
  );
  const [error, setError] = useState<string | null>(null);
  /** True while a cold backend is assembling this tab's world (its handshake). */
  const [warming, setWarming] = useState(false);
  /** Wall-clock time of the last snapshot that arrived, for "last update". */
  const [lastUpdateAt, setLastUpdateAt] = useState<number | null>(null);
  /** Delay before the next attempt: the normal poll interval, or the backoff. */
  const [retryDelay, setRetryDelay] = useState(0);
  const refreshRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let busy = false,
      again = false,
      cursor = 0,
      cfg: Config | null = null,
      runId = "",
      seen = false,
      // Successful polls in a row reset the delay; failures double it.
      failures = 0,
      // The wire carries only the newest dashboard sample; the dashboard keeps
      // its own rolling window (same 30 samples the server used to send), so the
      // sparklines and the 30 m chart read exactly the same numbers.
      history: TelemetrySample[] = [],
      // The first frame fills the dashboard window from the server once, so the
      // sparklines and the 30 m chart start with a real 30 samples instead of
      // one point that grows a tick at a time. Once per run, never retried on a
      // live poll: a failed seed just leaves the window to fill from deltas.
      seededRun = "",
      seeding = false,
      latest: Snapshot | null = null;
    async function poll() {
      if (abort.signal.aborted) return;
      if (busy) {
        again = true;
        return;
      }
      clearTimeout(timer);
      // Hidden tabs stop fetching (radio, JSON.parse and a full React render
      // nobody sees). The run keeps simulating server-side; becoming visible
      // polls immediately — the delta is a complete snapshot, so one request
      // catches up with no stale flash in between.
      if (document.hidden && seen) {
        timer = setTimeout(poll, 1000);
        return;
      }
      busy = true;
      try {
        if (!cfg) {
          // Anonymous reads are served from the server's shared engine, so claim
          // this tab's own run first. Without it every poll would be another
          // visitor's world and controls would belong to no run at all.
          // A cold backend has to build a 300-site world before it can answer.
          // Say so honestly instead of showing a stalled "Establishing
          // telemetry uplink…" for the length of one engine build.
          const slow = setTimeout(() => setWarming(true), 300);
          try {
            await api.startSession(abort.signal);
          } finally {
            clearTimeout(slow);
            setWarming(false);
          }
          cfg = await api.config(abort.signal);
          if (!cfg.presentation)
            throw new Error(
              "Updated presentation API not found. Restart the backend.",
            );
          setConfig(cfg);
        }
        // Per-poll budget: a request that never answers is an outage too.
        const next = await api.delta(
          cursor,
          AbortSignal.any([abort.signal, AbortSignal.timeout(POLL_TIMEOUT_MS)]),
        );
        if (abort.signal.aborted) return;
        // Complete bounded readouts replace rather than merge stale entities.
        if (runId !== next.run_id) {
          runId = next.run_id;
          history = []; // a new run starts its own window
        }
        const newest =
          next.dashboard.history[next.dashboard.history.length - 1];
        if (newest && history[history.length - 1]?.tick !== newest.tick)
          history = [...history, newest].slice(-30);
        next.dashboard.history = history;
        cursor = next.tick;
        seen = true;
        failures = 0;
        latest = next;
        setData(next);
        if (runId !== seededRun && !seeding) {
          // Fire-and-forget: the console is already usable, the seeded window
          // lands a moment later. No extra polling — one request per run.
          seeding = true;
          const target = runId;
          void (async () => {
            try {
              const seeded = await api.telemetryHistory("30m", target);
              if (abort.signal.aborted || target !== runId) return;
              history = mergeHistorySeed(history, seeded.samples);
              if (latest && latest.run_id === target) {
                const filled = {
                  ...latest,
                  dashboard: { ...latest.dashboard, history },
                };
                latest = filled;
                setData(filled);
              }
            } catch {
              // Silent by design: the window fills from live ticks instead.
            } finally {
              seeding = false;
              seededRun = target;
            }
          })();
        }
        setLastUpdateAt(Date.now());
        setStatus("live");
        setError(null);
      } catch (err) {
        failures += 1;
        if (!abort.signal.aborted) {
          setStatus("reconnecting");
          // A timeout carries its own reason; say what happened instead of
          // showing the generic "The operation was aborted."
          setError(
            (err as { name?: string } | null)?.name === "TimeoutError"
              ? `No response within ${POLL_TIMEOUT_MS / 1000} s`
              : err instanceof Error
                ? err.message
                : "Connection lost",
          );
        }
      } finally {
        busy = false;
        if (!abort.signal.aborted) {
          const base = cfg?.presentation.poll_ms ?? 1000;
          const wait = !failures
            ? base
            : Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** (failures - 1));
          timer = setTimeout(poll, again ? 0 : wait);
          again = false;
          setRetryDelay(wait);
        }
      }
    }
    const onVisibilityChange = () => {
      if (!document.hidden && !busy && !abort.signal.aborted) {
        clearTimeout(timer);
        void poll();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    refreshRef.current = () => {
      void poll();
    };
    void poll();
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      abort.abort();
      clearTimeout(timer);
      refreshRef.current = () => undefined;
    };
  }, []);
  return {
    config,
    data,
    status,
    error,
    warming,
    lastUpdateAt,
    retryDelay,
    refresh: useCallback(() => refreshRef.current(), []),
  };
}
