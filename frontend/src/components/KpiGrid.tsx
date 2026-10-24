import {
  Activity,
  RadioTower,
  Zap,
  Network,
  ArrowUpRight,
  ArrowDownRight,
  Waves,
  Gauge,
} from "lucide-react";
import type { Config, Snapshot, TelemetrySample } from "../types/api";
import { NumberTween } from "./NumberTween";
import { PanelInfoButton, Sparkline, tone } from "./ui";

export function KpiGrid({ data, config }: { data: Snapshot; config: Config }) {
  const { current: now, history, traffic_change_pct: change } = data.dashboard;
  const powerAtsEvents = Math.max(
    0,
    now.power_events - data.dashboard.fuel_thefts,
  );
  const p = config.presentation.palette;
  const cards = [
    {
      key: "availability",
      label: "Network availability",
      value: now.availability,
      unit: "%",
      decimals: 2,
      icon: Activity,
      color: p.healthy,
      note: "In-service site availability",
    },
    {
      key: "online",
      label: "Sites operational",
      value: now.online,
      unit: `/ ${config.num_nodes}`,
      decimals: 0,
      icon: RadioTower,
      color: p.healthy,
      note: `${data.dashboard.operational_pct.toFixed(1)}% of network in service`,
    },
    {
      key: "incidents",
      label: "Active incidents",
      value: now.incidents,
      unit: "",
      decimals: 0,
      icon: Network,
      color: now.incidents ? p.critical : p.healthy,
      note: "Correlated · X.733 alarms",
    },
    {
      key: "power_events",
      label: "Site power alarms",
      value: now.power_events,
      unit: "",
      decimals: 0,
      icon: Zap,
      color: p.warning,
      note: `Run total: ${powerAtsEvents} ATS · ${data.dashboard.fuel_thefts} thefts`,
    },
    {
      key: "throughput_gbps",
      label: "QCI 9 throughput",
      value: now.throughput_gbps,
      unit: "Gbps",
      decimals: 2,
      icon: Waves,
      color: p.fiber,
      note:
        change === null
          ? "Collecting 1-hour baseline"
          : `${change > 0 ? "+" : ""}${change.toFixed(1)}% vs last sim hour`,
    },
    {
      key: "drop_rate",
      label: "E-RAB drop rate",
      value: now.drop_rate,
      unit: "%",
      decimals: 2,
      icon: Gauge,
      color: p.prediction,
      note: "Mean synthetic site counter",
    },
  ];
  return (
    <section
      className="kpi-grid"
      aria-label="Network key performance indicators"
    >
      {cards.map(
        ({ key, label, value, unit, decimals, icon: Icon, color, note }) => (
          <article className="glass kpi-card" key={key} style={tone(color)}>
            <div className="kpi-title">
              <span className="kpi-title-label">{label}</span>
              <div className="kpi-title-actions">
                <Icon size={14} aria-hidden="true" />
                <PanelInfoButton title={label} compact />
              </div>
            </div>
            <div className="kpi-value">
              <NumberTween value={value} decimals={decimals} />
              <span className="kpi-unit">{unit}</span>
              <Sparkline
                values={history.map(
                  (h) => h[key as keyof TelemetrySample] as number,
                )}
                color={color}
              />
            </div>
            <div className="kpi-note">
              {key === "throughput_gbps" && change !== null ? (
                change >= 0 ? (
                  <ArrowUpRight size={14} />
                ) : (
                  <ArrowDownRight size={14} />
                )
              ) : (
                <span
                  className="tiny-dash"
                  style={
                    key === "incidents"
                      ? { backgroundColor: p.critical }
                      : undefined
                  }
                />
              )}
              {note}
            </div>
          </article>
        ),
      )}
    </section>
  );
}
