import { useEffect, useMemo, useRef, useState } from "react";
import type {
  Config,
  Snapshot,
  TelemetrySample,
  TelemetryTimeframe,
} from "../types/api";
import { api } from "../services/api";
import { NumberTween } from "./NumberTween";
import { PanelHeading } from "./ui";
import { lineChart } from "../charts.js";
import { simTimeToMinutes } from "../adapters.js";

const TIMEFRAMES: TelemetryTimeframe[] = ["30m", "24h", "7d"];
const WINDOW_MINUTES: Record<TelemetryTimeframe, number> = {
  "30m": 30,
  "24h": 24 * 60,
  "7d": 7 * 24 * 60,
};

type Metric = "throughput_gbps" | "prb";

/** Redraw and append counters, exposed for measurement (window.__chartStats). */
const stats = { redraws: 0, appends: 0 };
if (typeof window !== "undefined")
  (window as unknown as { __chartStats: typeof stats }).__chartStats = stats;

function mergeSamples(
  sources: TelemetrySample[][],
  firstTick: number,
  lastTick: number,
) {
  const byTick = new Map<number, TelemetrySample>();
  for (const source of sources) {
    for (const sample of source) {
      if (sample.tick >= firstTick && sample.tick <= lastTick)
        byTick.set(sample.tick, sample);
    }
  }
  return [...byTick.values()].sort((a, b) => a.tick - b.tick);
}

export function TrafficQualityCard({
  data,
  config,
}: {
  data: Snapshot;
  config: Config;
}) {
  const [timeframe, setTimeframe] = useState<TelemetryTimeframe>("30m");
  const [metric, setMetric] = useState<Metric>("throughput_gbps");
  const [longHistory, setLongHistory] = useState<TelemetrySample[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const requestId = useRef(0);
  const primaryHost = useRef<HTMLDivElement>(null);
  const dropHost = useRef<HTMLDivElement>(null);
  const primaryNote = useRef<HTMLParagraphElement>(null);
  const dropNote = useRef<HTMLParagraphElement>(null);
  const charts = useRef<{
    primary: ReturnType<typeof lineChart> | null;
    drop: ReturnType<typeof lineChart> | null;
    fed: { key: string; first: number; last: number };
  }>({ primary: null, drop: null, fed: { key: "", first: -1, last: -1 } });

  useEffect(() => {
    const request = ++requestId.current;
    if (timeframe === "30m") {
      setHistoryError(null);
      return () => {
        requestId.current += 1;
      };
    }
    setHistoryError(null);
    setLongHistory([]);
    void api
      .telemetryHistory(timeframe, data.run_id)
      .then((result) => {
        if (request !== requestId.current || result.run_id !== data.run_id)
          return;
        setLongHistory(result.samples);
      })
      .catch((error: unknown) => {
        if (request !== requestId.current) return;
        setHistoryError(
          error instanceof Error
            ? error.message
            : "Could not load this telemetry window.",
        );
      });
    return () => {
      requestId.current += 1;
    };
  }, [timeframe, data.run_id]);

  const sampleLimitTicks = Math.floor(
    WINDOW_MINUTES[timeframe] / config.tick_minutes,
  );
  const firstTick = Math.max(0, data.tick - sampleLimitTicks);
  const samples = useMemo(() => {
    const sources =
      timeframe === "30m"
        ? [data.dashboard.history]
        : [longHistory, data.dashboard.history];
    return mergeSamples(sources, firstTick, data.tick);
  }, [data.dashboard.history, data.tick, firstTick, longHistory, timeframe]);

  // Create both charts once; afterwards they are only fed (setData / append).
  useEffect(() => {
    const p = config.presentation.palette;
    const primary = lineChart(primaryHost.current!, {
      color: p.fiber,
      decimals: 2,
      onNote: (text: string) => {
        if (primaryNote.current) primaryNote.current.textContent = text;
      },
    });
    const drop = lineChart(dropHost.current!, {
      color: p.prediction,
      unit: "%",
      decimals: 1,
      zero: true,
      onNote: (text: string) => {
        if (dropNote.current) dropNote.current.textContent = text;
      },
    });
    drop.setDomain(0, 2);
    charts.current.primary = primary;
    charts.current.drop = drop;
    return () => {
      primaryHost.current && (primaryHost.current.innerHTML = "");
      dropHost.current && (dropHost.current.innerHTML = "");
      charts.current.primary?.destroy();
      charts.current.drop?.destroy();
      charts.current.primary = null;
      charts.current.drop = null;
      charts.current.fed = { key: "", first: -1, last: -1 };
    };
  }, [config]);

  // Feed the charts. Same window and metric: append only the new ticks.
  // A new window, metric or run, or a trimmed window start, does setData once.
  useEffect(() => {
    const c = charts.current;
    if (!c.primary || !c.drop) return;
    const key = `${timeframe}|${metric}|${data.run_id}`;
    const rows = samples
      .map((s) => ({ x: simTimeToMinutes(s.sim_time), tick: s.tick, s }))
      .filter((r): r is { x: number; tick: number; s: TelemetrySample } => r.x !== null);
    const first = rows[0]?.tick ?? -1;
    const last = rows.at(-1)?.tick ?? -1;
    const fed = c.fed;
    // Only a new timeframe, metric or run resets the chart. Window trimming
    // does not: the kit's chart cannot drop points, so rebuilding on each trim
    // would redraw every tick. The 30 min view therefore runs from the moment
    // it was opened, and the provenance line says so.
    // Fixed axis: QCI 9 traffic 20–50 Gbps; PRB stays automatic.
    c.primary.setDomain(metric === "throughput_gbps" ? 20 : null, 50);
    if (fed.key !== key) {
      c.primary.setData(rows.map((r) => [r.x, r.s[metric]]));
      c.drop.setData(rows.map((r) => [r.x, r.s.drop_rate]));
      stats.redraws += 1;
      c.fed = { key, first, last };
    } else if (last > fed.last) {
      const fresh = rows.filter((r) => r.tick > fed.last);
      for (const r of fresh) {
        c.primary.append([r.x, r.s[metric]]);
        c.drop.append([r.x, r.s.drop_rate]);
      }
      stats.appends += fresh.length;
      c.fed = { key, first, last };
    }
  }, [samples, timeframe, metric, data.run_id]);

  const current = data.dashboard.current;
  const metricValue = current[metric];
  const coverageMinutes =
    samples.length > 1
      ? (samples.at(-1)!.tick - samples[0].tick) * config.tick_minutes
      : 0;
  const requestedMinutes = WINDOW_MINUTES[timeframe];
  const primaryLabel = metric === "prb" ? "PRB utilization" : "QCI 9 traffic";
  const primaryUnit = metric === "prb" ? "%" : "Gbps";
  const decimals = metric === "prb" ? 1 : 2;

  return (
    <article className="glass analytics-card traffic-card">
      <PanelHeading
        title="Traffic & quality"
        right={
          <div
            className="timeframe-tabs"
            role="group"
            aria-label="Telemetry timeframe"
          >
            {TIMEFRAMES.map((option) => (
              <button
                key={option}
                type="button"
                className={timeframe === option ? "selected" : ""}
                aria-pressed={timeframe === option}
                onClick={() => setTimeframe(option)}
              >
                {option}
              </button>
            ))}
          </div>
        }
      />
      <div className="chart-summary">
        <div>
          <NumberTween value={metricValue} decimals={decimals} />
          <span>{primaryUnit === "%" ? "% PRB" : "Gbps"}</span>
        </div>
        <div
          className="segmented"
          role="group"
          aria-label="Primary chart metric"
        >
          <button
            type="button"
            className={metric === "throughput_gbps" ? "selected" : ""}
            aria-pressed={metric === "throughput_gbps"}
            onClick={() => setMetric("throughput_gbps")}
          >
            Traffic
          </button>
          <button
            type="button"
            className={metric === "prb" ? "selected" : ""}
            aria-pressed={metric === "prb"}
            onClick={() => setMetric("prb")}
          >
            PRB
          </button>
        </div>
      </div>
      <h3 className="chart-title">{primaryLabel}</h3>
      <p className="chart-subtitle">{primaryUnit}</p>
      <p className="chart-note" ref={primaryNote} />
      <div className="ch-wrap" ref={primaryHost} role="img" aria-label={`${timeframe} ${primaryLabel} history`} />
      <h3 className="chart-title">E-RAB drop proxy</h3>
      <p className="chart-subtitle" title="Simulator aggregate packet-loss proxy, not a bearer-level measurement">
        % · independent scale
      </p>
      <p className="chart-note" ref={dropNote} />
      <div className="ch-wrap" ref={dropHost} role="img" aria-label={`${timeframe} E-RAB drop proxy history`} />
      <p className="chart-provenance">
        {historyError
          ? historyError
          : `${samples.length} samples · ${coverageMinutes} of ${requestedMinutes} sim min · ` +
            (timeframe === "30m"
              ? "actual server samples, 5-minute simulation ticks, from when this view opened"
              : "actual current-run samples; longer windows fill as simulation time advances")}
      </p>
    </article>
  );
}
