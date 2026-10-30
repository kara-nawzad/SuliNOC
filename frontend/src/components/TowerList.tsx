import { memo, useMemo, useState } from "react";
import { Search } from "lucide-react";
import type { Config, NodeData, Snapshot } from "../types/api";
import { PanelHeading } from "./ui";

/** Telemetry replaces every node object each second, even when nothing visible
 * changed. This is the table's data slice: exactly the fields a row renders
 * (plus the header's length/faulty counts), so 300 rows only re-render when a
 * shown value actually moves. Exported for the slice tests. */
export function sameTowerRows(
  previous: { data: Snapshot; config: Config; onSelect: (id: string) => void },
  next: { data: Snapshot; config: Config; onSelect: (id: string) => void },
) {
  if (previous.config !== next.config || previous.onSelect !== next.onSelect)
    return false;
  const a = previous.data.nodes;
  const b = next.data.nodes;
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (!sameTowerRow(a[i], b[i])) return false;
  }
  return true;
}

/** Does this row print differently?
 *
 * Exactly the cells the row shows — id, status (name + colour), `prb.toFixed(1)`,
 * cqi, ring, cluster — plus the two fields the sort uses (`status` for
 * faulty-first, `id` for the tie-break), so a reorder still re-renders. A PRB
 * value that only moves in the second decimal prints the same number, and used
 * to re-render ~298 of 300 rows every second. Exported for the slice tests. */
export function sameTowerRow(row: NodeData, other: NodeData) {
  return (
    row.id === other.id &&
    row.status === other.status &&
    row.cqi === other.cqi &&
    row.ring === other.ring &&
    row.cluster === other.cluster &&
    (row.prb === other.prb || row.prb.toFixed(1) === other.prb.toFixed(1))
  );
}

/** Every tower in the current run, faulty ones first. Values are the backend's
 * live fields for this tick; nothing is estimated here. */
export const TowerList = memo(function TowerList({
  data,
  config,
  onSelect,
}: {
  data: Snapshot;
  config: Config;
  onSelect: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [cluster, setCluster] = useState(0);
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...data.nodes]
      .filter(
        (n) =>
          n.id.toLowerCase().includes(q) &&
          (cluster === 0 || n.cluster === cluster),
      )
      .sort(
        (a, b) =>
          Number(a.status === config.presentation.healthy_status) -
            Number(b.status === config.presentation.healthy_status) ||
          a.id.localeCompare(b.id),
      );
  }, [data.nodes, query, cluster, config]);
  const faulty = data.nodes.filter(
    (n) => n.status !== config.presentation.healthy_status,
  ).length;
  return (
    <section id="towers" className="glass towers-panel" aria-label="Towers">
      <PanelHeading
        title="Towers"
        right={
          <span className="mono towers-count">
            {data.nodes.length} SITES · {faulty} FAULTY
          </span>
        }
      />
      {/* Search and the count share one row: the table starts higher and the
          panel reads as a data table rather than a form. */}
      <div className="towers-tools">
        <label className="towers-search">
          <Search size={14} aria-hidden="true" />
          <input
            type="search"
            placeholder="Filter by tower ID"
            aria-label="Filter towers"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <select
          className="towers-cluster"
          aria-label="Filter by cluster"
          value={cluster}
          onChange={(e) => setCluster(Number(e.target.value))}
        >
          <option value={0}>All clusters</option>
          <option value={1}>Cluster 1</option>
          <option value={2}>Cluster 2</option>
          <option value={3}>Cluster 3</option>
        </select>
        <span className="towers-hint">
          Faulty sites first · select a row to inspect it on the network
        </span>
      </div>
      <div className="tower-table" role="table" aria-label="Tower status">
        <div className="tower-row tower-head" role="row">
          <span role="columnheader">Tower</span>
          <span role="columnheader">Status</span>
          <span role="columnheader">PRB</span>
          <span role="columnheader">CQI</span>
          <span role="columnheader">Ring</span>
          <span role="columnheader">Cluster</span>
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
            <span role="cell">Cluster {n.cluster}</span>
          </button>
        ))}
      </div>
      {!rows.length && (
        <p className="towers-empty" role="status">
          No tower matches “{query}”.
        </p>
      )}
    </section>
  );
}, sameTowerRows);
