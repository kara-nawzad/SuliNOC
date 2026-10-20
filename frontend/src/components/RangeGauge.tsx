import type { GaugeSpec } from "../types/api";

/** Good / warning / failing, judged with the backend's thresholds (config.gauges).
 * `lower_bad` metrics fail when they fall; the others fail when they rise. */
export type GaugeState = "ok" | "warn" | "bad";

export function gaugeState(value: number, g: GaugeSpec): GaugeState {
  const ok = g.lower_bad ? value >= g.good : value <= g.good;
  if (ok) return "ok";
  const warn = g.lower_bad ? value >= g.warn : value <= g.warn;
  return warn ? "warn" : "bad";
}

/** Display units and decimals per metric. `scale` converts the stored value
 * (dust is a 0..1 fraction shown as a percentage). Mirrors the new UI's GU table. */
export const GAUGE_UNITS: Record<
  string,
  { unit: string; scale?: number; decimals: number }
> = {
  rsrp: { unit: "dBm", decimals: 1 },
  sinr: { unit: "dB", decimals: 1 },
  cqi: { unit: "/ 15", decimals: 0 },
  vswr: { unit: ": 1", decimals: 2 },
  prb: { unit: "%", decimals: 1 },
  throughput: { unit: "Mbps", decimals: 1 },
  loss: { unit: "%", decimals: 1 },
  latency: { unit: "ms", decimals: 1 },
  jitter: { unit: "ms", decimals: 1 },
  s11: { unit: "dB", decimals: 1 },
  temp: { unit: "°C", decimals: 1 },
  cpu: { unit: "%", decimals: 1 },
  dust: { unit: "%", scale: 100, decimals: 1 },
  voltage: { unit: "V", decimals: 1 },
  battery: { unit: "%", decimals: 1 },
  fuel: { unit: "%", decimals: 1 },
};

/** Bar colours (fills and markers) and text colours. The text colours are darker
 * so small labels stay readable on the light panels. */
const FILL = { ok: "#0c9c83", warn: "#c27400", bad: "#d42f52" } as const;
const TEXT = { ok: "#0a6f5c", warn: "#8a4f00", bad: "#b3203f" } as const;
const WORD = { ok: "Good", warn: "Warning", bad: "Failing" } as const;
const BAND = {
  ok: "rgba(12, 156, 131, 0.22)",
  warn: "rgba(194, 116, 0, 0.22)",
  bad: "rgba(212, 47, 82, 0.28)",
} as const;

function fmt(value: number, decimals: number): string {
  return value.toFixed(decimals);
}

/** A range slider: the scale runs from lo to hi, tinted by good / warning / failing
 * bands from the backend thresholds, with a marker at the current reading. */
export function RangeGauge({
  label,
  metric,
  value,
  spec,
}: {
  label: string;
  metric: string;
  value: number;
  spec?: GaugeSpec;
}) {
  const units = GAUGE_UNITS[metric] ?? { unit: "", decimals: 1 };
  const s = units.scale ?? 1;
  const shown = `${fmt(value * s, units.decimals)}${units.unit ? " " + units.unit : ""}`;
  if (!spec || !Number.isFinite(value)) {
    return (
      <div className="range-gauge is-unrated">
        <div className="range-head">
          <span>{label}</span>
          <b className="range-value">{shown}</b>
        </div>
      </div>
    );
  }
  const st = gaugeState(value, spec);
  const span = spec.hi - spec.lo;
  const pct = Math.max(0, Math.min(100, ((value - spec.lo) / span) * 100));
  // Band edges are the thresholds that fall inside the scale, in order.
  const edges = [...new Set([spec.lo, spec.hi, spec.good, spec.warn, spec.bad])]
    .filter((x) => x >= spec.lo && x <= spec.hi)
    .sort((a, b) => a - b);
  const bands = edges.slice(0, -1).map((a, i) => {
    const b = edges[i + 1];
    const mid = gaugeState((a + b) / 2, spec);
    return (
      <i
        key={`${a}-${b}`}
        className="range-band"
        style={{
          left: `${(((a - spec.lo) / span) * 100).toFixed(2)}%`,
          width: `${(((b - a) / span) * 100).toFixed(2)}%`,
          background: BAND[mid],
        }}
      />
    );
  });
  const scaleText = (x: number) => `${fmt(x * s, units.decimals)}${units.unit ? " " + units.unit : ""}`;
  return (
    <div className={`range-gauge is-${st}`}>
      <div className="range-head">
        <span>{label}</span>
        <b className="range-value" style={{ color: TEXT[st] }}>
          {shown}
          <small>{WORD[st]}</small>
        </b>
      </div>
      <div
        className="range-track"
        role="meter"
        aria-label={label}
        aria-valuemin={spec.lo * s}
        aria-valuemax={spec.hi * s}
        aria-valuenow={value * s}
        aria-valuetext={`${shown}, ${WORD[st]}`}
      >
        {bands}
        <i className="range-fill" style={{ width: `${pct}%`, background: FILL[st] }} />
        <em className="range-mark" style={{ left: `${pct}%`, borderColor: FILL[st] }} />
      </div>
      <div className="range-scale">
        <span>{scaleText(spec.lo)}</span>
        <span>
          good {scaleText(spec.good)} · bad {scaleText(spec.bad)}
        </span>
        <span>{scaleText(spec.hi)}</span>
      </div>
    </div>
  );
}
