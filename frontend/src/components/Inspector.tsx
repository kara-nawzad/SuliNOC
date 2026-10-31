import { MapPin, Wrench, Zap, ShieldCheck } from "lucide-react";
import type { Config, NodeData } from "../types/api";
import { RangeGauge } from "./RangeGauge";
import { tone } from "./ui";
import { Modal } from "./ui";

/** The same categories as the new UI's site inspector. */
const GROUPS: { title: string; keys: string[] }[] = [
  {
    title: "Telecom",
    keys: [
      "rsrp",
      "sinr",
      "cqi",
      "prb",
      "throughput",
      "latency",
      "loss",
      "jitter",
    ],
  },
  { title: "Antenna & feeder", keys: ["vswr", "s11"] },
  { title: "Equipment", keys: ["cpu", "temp", "dust"] },
];

export function Inspector({
  node,
  config,
  onClose,
  onInject,
}: {
  node?: NodeData;
  config: Config;
  onClose: () => void;
  onInject: (id: string) => void;
}) {
  const gaugeFor = (key: string) => {
    const value = node ? (node[key as keyof NodeData] as number) : NaN;
    return (
      <RangeGauge
        key={key}
        label={config.metric_labels[key] ?? key}
        metric={key}
        value={value}
        spec={config.gauges?.[key]}
      />
    );
  };
  if (!node) return null;
  return (
    <Modal title={node.id} eyebrow="SITE INSPECTOR" onClose={onClose}>
      <div className="inspector">
        <div className="inspector-place">
          <MapPin size={14} />
          {config.agg_sites.find((a) => a.id === node.agg)?.name}{" "}
          <span>·</span> Cluster {node.cluster} <span>·</span> Ring{" "}
          {node.ring}
        </div>
        <span
          className="severity site-status"
          style={tone(config.status_colors[node.status])}
        >
          {config.status_names[node.status]}
        </span>
        <div className="inspector-tags">
          <span>{config.presentation.generation_names[node.gen]}</span>
          {node.critical && (
            <span>
              <ShieldCheck size={14} /> Priority site
            </span>
          )}
          {node.repairing ? (
            <span>
              <Wrench size={14} /> Repairing
            </span>
          ) : node.dispatched ? (
            <span>Crew dispatched</span>
          ) : null}
        </div>
        {GROUPS.map((group) => (
          <section className="spec-group" key={group.title}>
            <h3>{group.title}</h3>
            {group.keys.map(gaugeFor)}
          </section>
        ))}
        <section className="spec-group">
          <h3>
            <Zap size={14} /> Power · {node.pwr}
            {config.power_configs[node.pwr]
              ? ` · ${config.power_configs[node.pwr]}`
              : ""}
          </h3>
          <div className="range-source">
            Source now:{" "}
            <b
              style={{ color: config.presentation.power_colors[node.power] }}
            >
              {node.power}
            </b>
          </div>
          {["voltage", "battery", "fuel"].map(gaugeFor)}
          <p className="small-muted">
            Fuel is tank percentage; tank capacity in liters is not modeled.
          </p>
        </section>
        {node.ats && (
          <div
            className="inline-warning"
            style={tone(config.presentation.palette.critical)}
          >
            ATS failure to crank · maintenance required
          </div>
        )}
        {node.warn && (
          <div
            className="inline-warning"
            style={tone(config.presentation.palette.prediction)}
          >
            Oracle warning · next {config.presentation.prediction_horizon_min}{" "}
            min
          </div>
        )}
        <button
          className="button secondary inspector-action"
          disabled={node.status !== config.presentation.healthy_status}
          onClick={() => onInject(node.id)}
        >
          <Zap size={14} /> Inject fault on this site
        </button>
        <div className="inspector-coords mono">
          {node.lat.toFixed(5)} N / {node.lon.toFixed(5)} E
        </div>
      </div>
    </Modal>
  );
}
