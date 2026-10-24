import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../services/api";
import type { Config, Snapshot } from "../types/api";

/** One cancellable request at a time. Controls can request an immediate refresh
 * without racing older polls. History and simulation time always come from Python. */
export function useTelemetry() {
  const [config, setConfig] = useState<Config | null>(null);
  const [data, setData] = useState<Snapshot | null>(null);
  const [status, setStatus] = useState<"connecting" | "live" | "reconnecting">(
    "connecting",
  );
  const [error, setError] = useState<string | null>(null);
  const refreshRef = useRef<() => void>(() => undefined);
  useEffect(() => {
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let busy = false,
      again = false,
      cursor = 0,
      cfg: Config | null = null,
      runId = "",
      seen = false;
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
          cfg = await api.config(abort.signal);
          if (!cfg.presentation)
            throw new Error(
              "Updated presentation API not found. Restart the backend.",
            );
          setConfig(cfg);
        }
        const next = await api.delta(cursor, abort.signal);
        if (abort.signal.aborted) return;
        // Complete bounded readouts replace rather than merge stale entities.
        if (runId !== next.run_id) runId = next.run_id;
        cursor = next.tick;
        seen = true;
        setData(next);
        setStatus("live");
        setError(null);
      } catch (err) {
        if (!abort.signal.aborted) {
          setStatus("reconnecting");
          setError(err instanceof Error ? err.message : "Connection lost");
        }
      } finally {
        busy = false;
        if (!abort.signal.aborted) {
          timer = setTimeout(
            poll,
            again ? 0 : (cfg?.presentation.poll_ms ?? 1000),
          );
          again = false;
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
    refresh: useCallback(() => refreshRef.current(), []),
  };
}
