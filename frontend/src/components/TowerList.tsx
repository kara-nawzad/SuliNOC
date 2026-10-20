import { useMemo, useState } from "react";
import type { Config, Snapshot } from "../types/api";
import { PanelHeading } from "./ui";

/** Every tower in the current run, faulty ones first. Values are the backend's
 * live fields for this tick; nothing is estimated here. */
export function TowerList({
  data,
  config,
  onSelect,
}: {
  data: Snapshot;
  config: Config;
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...data.nodes]
      .filter((n) => n.id.toLowerCase().includes(q))
      .sort(
        (a, b) =>
          Number(a.status === config.presentation.healthy_status) -
            Number(b.status === config.presentation.healthy_status) ||
          a.id.localeCompare(b.id),
      );
  }, [data.nodes, query, config]);
  const faulty = data.nodes.filter(
    (n) => n.status !== config.presentation.healthy_status,
  ).length;
  return (
    <section id="towers" className="glass towers-panel" aria-label="Towers">
      <PanelHeading
        title="Towers"
        right={
          <span className="mono">
            {data.nodes.length} SITES · {faulty} FAULTY
          </span>
        }
      />
      <p className="note">
        Live status of every tower in the current run. Select a row to inspect
        it on the live network.
      </p>
      <input
        type="search"
        placeholder="Filter by tower ID"
        aria-label="Filter towers"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="tower-table" role="table" aria-label="Tower status">
        <div className="tower-row tower-head" role="row">
          <span role="columnheader">Tower</span>
          <span role="columnheader">Status</span>
          <span role="columnheader">PRB</span>
          <span role="columnheader">CQI</span>
          <span role="columnheader">Ring</span>
        </div>
        {rows.map((n) => (
          <button
            key={n.id}
            type="button"
            role="row"
            className="tower-row"
            onClick={() => onSelect(n.id)}
          >
            <span className="mono" role="cell">
              {n.id}
            </span>
            <span role="cell" style={{ color: config.status_colors[n.status] }}>
              {config.status_names[n.status]}
            </span>
            <span role="cell">{n.prb.toFixed(1)}%</span>
            <span role="cell">{n.cqi}</span>
            <span className="mono" role="cell">
              {n.ring}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
