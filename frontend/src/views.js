// Page views. Each view turns the latest backend snapshot into HTML. Actions
// are delegated: elements carry data-action attributes handled in main.js.
import { esc, num, pct } from "./util.js";
import { sparkline, donut, legendRows, sevChip, fmtSince } from "./components.js";
import { counterfactualTable } from "./panels.js";

export const OFFLINE = (cfg) => new Set(cfg.presentation.offline_statuses);
export const districtName = (snap, id) => snap.agg.find((a) => a.id === id)?.name ?? `District ${id}`;
const statusColor = (cfg, s) => cfg.status_colors[s] ?? "#4B6192";
const sevColor = (cfg, s) => cfg.presentation.severity_colors?.[s] ?? "#4B6192";

export function nodeCounts(snap, cfg) {
  const off = OFFLINE(cfg);
  let offline = 0, degraded = 0, ai = 0;
  for (const n of snap.nodes) {
    if (off.has(n.status)) offline++;
    else if (n.status !== cfg.presentation.healthy_status) degraded++;
    if (n.warn) ai++;
  }
  return { offline, degraded, ai, total: snap.nodes.length };
}

function kpiTile(label, value, sub = "", tone = "") {
  return `<div class="kt ${tone}"><span class="t2 sm">${esc(label)}</span><b class="big2">${value}</b><span class="sm t2">${sub}</span></div>`;
}

function powerSlices(snap, cfg) {
  return (snap.dashboard.power ?? []).map((p) => ({
    label: p.name === "Generator" ? "Diesel DG" : p.name,
    value: p.count,
    color: cfg.presentation.power_colors[p.name] ?? "#4B6192",
  }));
}

function logRows(logs, cfg, limit = 30, sev = "") {
  return logs.filter((l) => !sev || l.severity === sev).slice(-limit).reverse().map((l) => `
    <div class="logrow"><span class="m t2">${esc(l.time)}</span>${sevChip(l.severity, sevColor(cfg, l.severity))}
      <span>${esc(l.message)}</span>${l.node_id ? `<button class="linkish m" data-action="open-node" data-id="${esc(l.node_id)}">${esc(l.node_id)}</button>` : ""}</div>`).join("")
    || `<div class="t2 sm">No events yet.</div>`;
}

// ------------------------------------------------------------------ overview
function overview(snap, cfg) {
  const k = snap.kpis, c = nodeCounts(snap, cfg), d = snap.dashboard;
  const slices = powerSlices(snap, cfg);
  const series = d.history ?? [];
  const traffic = d.traffic_change_pct != null
    ? `${d.traffic_change_pct >= 0 ? "+" : ""}${d.traffic_change_pct.toFixed(1)}% traffic vs 1 h ago`
    : "traffic baseline forming";
  return `
  <div class="kp">
    <div><span class="t2 sm">Network availability</span><div class="big">${pct(k.availability, 2)}</div>
      <div class="sm t2">${num(c.total - c.offline - c.degraded)} of ${num(c.total)} sites healthy · ${traffic}</div></div>
    <div class="s"><span class="t2 sm">Throughput</span><b>${num(d.current.throughput_gbps, 2)} Gbps</b></div>
    <div class="s"><span class="t2 sm">Drop rate</span><b>${pct(d.current.drop_rate, 2)}</b></div>
    <div class="s"><span class="t2 sm">Sim time</span><b class="m">${esc(k.sim_time)}</b></div>
  </div>
  <div class="kgrid">
    ${kpiTile("Offline sites", num(c.offline), `${num(c.degraded)} degraded`, c.offline ? "crit" : "")}
    ${kpiTile("Open incidents", num(d.incidents.length), `${num(k.injected)} faults injected`, d.incidents.length ? "warn" : "")}
    ${kpiTile("Crews active", `${num(k.active_teams)} / ${num(cfg.num_teams)}`, `${num(d.fleet.REPAIRING ?? 0)} repairing`)}
    ${kpiTile("MTTR", `${num(k.mttr_min, 0)} min`, `${num(k.repairs)} repairs`)}
    ${kpiTile("AI actionable", num(d.actionable_predictions), `${num(d.active_ats)} ATS latches`, c.ai ? "ai" : "")}
    ${kpiTile("Fuel thefts", num(k.fuel_thefts), `${num(k.ats_failures)} ATS failures`)}
  </div>
  <div class="cols">
    <div>
      <div class="sec"><h3>Recent alerts</h3>${logRows(snap.logs, cfg, 8)}</div>
      <div class="sec"><h3>Availability · last hour</h3>${sparkline(series.map((s) => s.availability), { color: "#0C9C83", min: 90, max: 100 })}</div>
    </div>
    <div>
      <div class="sec"><h3>Site power &amp; fleet</h3>
        <div class="donutrow">${donut(slices)}<div class="legend">${legendRows(slices)}</div></div>
        <div class="fleet">${Object.entries(d.fleet).map(([s, n]) => `<span class="m"><b>${num(n)}</b> ${esc(s.toLowerCase().replace("_", " "))}</span>`).join("")}</div>
      </div>
      <div class="sec"><h3>Go to</h3>
        <button class="btn" data-action="goto" data-view="live">Live network →</button>
        <button class="btn" data-action="goto" data-view="ai">AI predictions →</button>
        <button class="btn" data-action="goto" data-view="mnt">Maintenance →</button></div>
    </div>
  </div>`;
}

// ---------------------------------------------------------------- live map
function live(snap, cfg, ctx) {
  const districts = snap.agg.map((a) => `<option value="${a.id}" ${String(ctx.district) === String(a.id) ? "selected" : ""}>${esc(a.name)}</option>`).join("");
  const opts = [["all", "All sites"], ["fault", "Faults only"], ["offline", "Offline only"], ["ai", "AI-flagged"]]
    .map(([v, l]) => `<option value="${v}" ${ctx.status === v ? "selected" : ""}>${l}</option>`).join("");
  return `
  <div class="tb">
    <label class="sm t2">District <select data-filter="district"><option value="">All districts</option>${districts}</select></label>
    <label class="sm t2">Show <select data-filter="status">${opts}</select></label>
    <span class="sm t2 legendline" style="margin-left:auto">${legendInline(cfg)}</span></div>
  <div class="mapbox live"><svg id="netmap" class="map" role="img" aria-label="Live network map"></svg>
    <div class="zc"><button class="btn" data-action="map-reset">Reset view</button></div>
    <div class="crewlist">${snap.teams.map((t) => `<div class="m sm"><i class="dot2" style="background:${t.state === "IDLE" ? "#8BA3C7" : "#1479C4"}"></i>${esc(t.name)} · ${esc(t.state.toLowerCase().replace("_", " "))}${t.target ? ` → ${esc(t.target)}` : ""}</div>`).join("")}</div>
  </div>`;
}

export function legendInline(cfg) {
  return Object.entries(cfg.status_names).map(([k, v]) =>
    `<span class="lgi"><i style="background:${esc(cfg.status_colors[k])}"></i>${esc(v)}</span>`).join("");
}

// ---------------------------------------------------------------- towers
function towers(snap, cfg, ctx) {
  const q = (ctx.query ?? "").trim().toLowerCase();
  const healthy = cfg.presentation.healthy_status;
  const rows = snap.nodes.filter((n) => {
    if (ctx.district !== "" && ctx.district != null && String(n.agg) !== String(ctx.district)) return false;
    if (q && !(n.id.toLowerCase().includes(q) || districtName(snap, n.agg).toLowerCase().includes(q))) return false;
    return true;
  }).sort((a, b) => (b.status !== healthy) - (a.status !== healthy) || a.id.localeCompare(b.id));
  const districts = snap.agg.map((a) => `<option value="${a.id}" ${String(ctx.district) === String(a.id) ? "selected" : ""}>${esc(a.name)}</option>`).join("");
  return `
  <h2>Tower inventory</h2>
  <div class="tb"><label class="sm t2">District <select data-filter="tdistrict"><option value="">All districts</option>${districts}</select></label>
    <span class="sm t2 m">${num(rows.length)} of ${num(snap.nodes.length)} sites${q ? ` matching “${esc(q)}”` : ""}</span></div>
  <div class="tablewrap"><table><thead><tr><th>Site</th><th>District</th><th>Status</th><th>Power</th><th>RSRP</th><th>Throughput</th><th>Battery</th><th>Crew</th></tr></thead><tbody>
  ${rows.slice(0, 300).map((n) => `<tr class="r" data-action="open-node" data-id="${esc(n.id)}">
    <td class="m">${esc(n.id)}</td><td>${esc(districtName(snap, n.agg))}</td>
    <td><span class="dotlbl"><i style="background:${esc(statusColor(cfg, n.status))}"></i>${esc(cfg.status_names[n.status])}</span></td>
    <td>${esc(n.power)}${n.warn ? ` <span class="chip" style="--c:#6A4BD8">AI</span>` : ""}</td>
    <td class="m">${num(n.rsrp, 1)} dBm</td><td class="m">${num(n.throughput, 1)} Mbps</td><td class="m">${num(n.battery, 0)}%</td>
    <td class="t2">${n.dispatched ? "assigned" : ""}</td></tr>`).join("")}
  </tbody></table></div>${rows.length > 300 ? `<div class="sm t2">Showing first 300. Narrow by district or search.</div>` : ""}`;
}

// ---------------------------------------------------------------- topology
function topo(snap, cfg, ctx) {
  return `
  <h2>Fibre topology</h2>
  <p class="sm t2">Protected rings link sites to the core. A double cut isolates a ring; its sites then run on battery and generator until a crew restores the fibre.</p>
  <div class="ringgrid">${snap.rings.map((r) => {
    const cuts = r.cuts?.length ?? 0;
    const state = r.isolated ? `<span class="chip" style="--c:#D42F52">isolated</span>`
      : cuts ? `<span class="chip" style="--c:#C27400">${cuts} cut${cuts > 1 ? "s" : ""}</span>`
      : `<span class="chip" style="--c:#0C9C83">intact</span>`;
    const armed = ctx.armedRing === r.id;
    return `<div class="ringcard"><div class="rh"><b>Ring ${r.id}</b>${state}</div>
      ${ringSvg(r, snap, cfg)}
      <div class="sm t2 m">${r.nodes.length} sites · ${num(r.circumference_km, 1)} km</div>
      <button class="btn ${armed ? "danger" : ""}" data-action="ring-cut" data-ring="${r.id}" ${cuts >= 2 ? "disabled" : ""}>
        ${armed ? "Confirm double cut" : "Cut fibre (double)"}</button></div>`;
  }).join("")}</div>`;
}

function ringSvg(r, snap, cfg) {
  const pts = r.path.map(([lat, lon]) => [lon, -lat]);
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const span = Math.max(x1 - x0, y1 - y0, 0.001);
  const pad = 0.12 * span;
  const d = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(5)} ${p[1].toFixed(5)}`).join("") + "Z";
  const nodes = r.nodes.map((id) => snap.nodes.find((n) => n.id === id)).filter(Boolean).map((n) =>
    `<circle cx="${n.lon.toFixed(5)}" cy="${(-n.lat).toFixed(5)}" r="${(span * 0.02).toFixed(5)}" fill="${esc(statusColor(cfg, n.status))}"/>`).join("");
  return `<svg class="ringmap" viewBox="${x0 - pad} ${y0 - pad} ${span + 2 * pad} ${span + 2 * pad}" preserveAspectRatio="xMidYMid meet">
    <path d="${d}" fill="none" stroke="${r.isolated ? "#D42F52" : "#3768F5"}" stroke-width="${(span * 0.012).toFixed(5)}" ${r.isolated ? `stroke-dasharray="${(span * 0.03).toFixed(5)}"` : ""}/>${nodes}</svg>`;
}

// ---------------------------------------------------------------- incidents
function incidents(snap, cfg, ctx) {
  const inc = snap.dashboard.incidents;
  return `
  <h2>Incidents</h2>
  <h3 class="sub">Active</h3>
  ${inc.length ? `<div class="tablewrap"><table><thead><tr><th>Incident</th><th>Site</th><th>Severity</th><th>Affected</th><th>Since</th><th>Crew</th></tr></thead><tbody>
  ${inc.map((i) => `<tr class="${i.node_id ? "r" : ""}" ${i.node_id ? `data-action="open-node" data-id="${esc(i.node_id)}"` : ""}>
    <td><b>${esc(i.title)}</b><div class="sm t2">${esc(i.detail)}</div></td><td class="m">${esc(i.node_id ?? "—")}</td>
    <td>${sevChip(i.severity.toUpperCase(), sevColor(cfg, i.severity.toUpperCase()))}</td><td class="m">${num(i.affected)}</td>
    <td class="m t2">${esc(fmtSince(i.since_tick, cfg, snap.tick))}</td><td>${i.dispatched ? "assigned" : `<span class="t2">awaiting</span>`}</td></tr>`).join("")}
  </tbody></table></div>` : `<div class="t2">No active incidents. The network is healthy.</div>`}
  <h3 class="sub">Event log</h3>
  <div class="tb"><label class="sm t2">Severity <select data-filter="sev"><option value="">All</option>
    ${["CRITICAL", "MAJOR", "MINOR", "WARNING", "INFO", "CLEARED"].map((s) => `<option ${ctx.sev === s ? "selected" : ""}>${s}</option>`).join("")}</select></label></div>
  <div class="logbox">${logRows(snap.logs, cfg, 60, ctx.sev)}</div>`;
}

// ---------------------------------------------------------------- AI
function ai(snap, cfg) {
  const a = snap.ai ?? {}, pend = a.pending ?? [];
  const ctl = snap.control;
  const on = !!a.ai_enabled;
  const prec = a.precision != null ? `${(a.precision * 100).toFixed(1)}%` : "—";
  const breakEven = a.break_even_precision != null ? `${(a.break_even_precision * 100).toFixed(0)}%` : "—";
  return `
  <div class="aihead"><h2>AI predictions</h2>
    <label class="switch"><input type="checkbox" data-action="ai-toggle" ${on ? "checked" : ""}><span>${on ? "AI enabled" : "AI disabled"}</span></label>
    <span class="sm t2">mode <b class="m">${esc(a.ai_mode ?? "off")}</b> · policy <b class="m">${esc(a.ai_policy ?? "—")}</b></span></div>
  <div class="kgrid">
    ${kpiTile("Pre-empted", num(a.pre_empted ?? 0), `${num(a.acted_upon ?? 0)} acted on`, "ai")}
    ${kpiTile("Precision", prec, `break-even ${breakEven}`)}
    ${kpiTile("False dispatches", num(a.false_dispatches ?? 0), "charged to the AI")}
    ${kpiTile("Crew hours saved", num(a.crew_hours_saved ?? 0, 1), "vs reactive dispatch")}
  </div>
  <div class="sec"><h3>Awaiting approval</h3>
    ${pend.length ? `<div class="tablewrap"><table><thead><tr><th>Site</th><th>Predicted fault</th><th>Probability</th><th>Proposed action</th><th>Auto-approve</th><th></th></tr></thead><tbody>
      ${pend.map((p) => `<tr><td class="m">${esc(p.node_id)}</td><td>${esc(p.label)}</td><td class="m">${(p.probability * 100).toFixed(1)}%</td>
        <td>${esc(p.action)}</td><td class="m">${p.eta != null ? `${Math.max(0, Math.round(p.eta))} s` : "manual"}</td>
        <td><button class="btn" data-action="approve" data-id="${p.action_id}">Approve</button>
            <button class="btn" data-action="veto" data-id="${p.action_id}">Veto</button></td></tr>`).join("")}
      </tbody></table></div>` : `<div class="t2">No pending AI actions.</div>`}
    <div class="tb"><label class="sm t2">Auto-approve after
      <input type="number" min="0" max="600" step="5" value="${ctl.auto_approve_seconds ?? 0}" id="auto-s" style="width:90px"> s</label>
      <button class="btn" data-action="ai-auto">Apply</button><span class="sm t2">0 = an operator decides every action</span></div>
  </div>
  <div class="sec"><h3>Highest-risk sites</h3>
    <div class="tablewrap"><table><thead><tr><th>Site</th><th>District</th><th>Status</th></tr></thead><tbody>
    ${(snap.dashboard.top_cells ?? []).slice(0, 8).map((c) => `<tr class="r" data-action="open-node" data-id="${esc(c.node_id)}"><td class="m">${esc(c.node_id)}</td><td>${esc(c.district)}</td><td class="t2">${esc(c.status ?? "")}</td></tr>`).join("") || `<tr><td colspan="3" class="t2">No elevated risk.</td></tr>`}
    </tbody></table></div>
    ${snap.dashboard.forecast ? `<div class="sm t2">Top forecast: <b class="m">${esc(snap.dashboard.forecast.node_id)}</b> at ${(snap.dashboard.forecast.probability * 100).toFixed(1)}% failure probability in the next ${cfg.presentation.prediction_horizon_min} min.</div>` : ""}
  </div>`;
}

// ---------------------------------------------------------------- analytics
function analytics(snap, cfg, ctx) {
  const h = ctx.tele;
  const tf = ctx.tf ?? "30m";
  const s = h?.samples ?? [];
  const chart = (label, key, color, fmt) => {
    const vals = s.map((x) => x[key]);
    const last = vals.length ? vals[vals.length - 1] : null;
    return `<div class="chartcard"><div class="rh"><span class="t2 sm">${esc(label)}</span><b class="m">${last != null ? fmt(last) : "—"}</b></div>${sparkline(vals, { color })}</div>`;
  };
  return `
  <div class="aihead"><h2>Analytics</h2>
    <div class="seg">${["30m", "24h", "7d"].map((t) => `<button class="${t === tf ? "on" : ""}" data-action="tf" data-tf="${t}">${t}</button>`).join("")}</div>
    <span class="sm t2">${h ? `${s.length} samples · ${h.tick_minutes} min resolution` : "Loading…"}</span></div>
  <div class="chartgrid">
    ${chart("Availability", "availability", "#0C9C83", (v) => `${v.toFixed(2)}%`)}
    ${chart("Throughput", "throughput_gbps", "#3768F5", (v) => `${v.toFixed(2)} Gbps`)}
    ${chart("Drop rate", "drop_rate", "#D42F52", (v) => `${v.toFixed(2)}%`)}
    ${chart("PRB load", "prb", "#6A4BD8", (v) => `${v.toFixed(0)}%`)}
    ${chart("Incidents", "incidents", "#C27400", (v) => num(v))}
    ${chart("Offline sites", "offline", "#D42F52", (v) => num(v))}
  </div>
  <div class="sec"><h3>Counterfactual impact</h3>
    <p class="sm t2">Same faults, same seeds, four policies. The AI's gain is measured against the no-AI baseline.</p>
    ${counterfactualTable()}
    <div class="tb"><button class="btn" data-action="cf">Open full report</button></div></div>
  <div class="sec"><h3>Completed runs</h3>
    <button class="btn" data-action="history">Open run history</button></div>`;
}

// ---------------------------------------------------------------- maintenance
function maint(snap, cfg) {
  const queue = snap.nodes.filter((n) => n.dispatched || n.repairing);
  return `
  <h2>Maintenance</h2>
  <div class="kgrid">${Object.entries(snap.dashboard.fleet).map(([s, n]) => kpiTile(s.toLowerCase().replace("_", " "), num(n), "crews")).join("")}</div>
  <div class="sec"><h3>Crews</h3><div class="tablewrap"><table><thead><tr><th>Crew</th><th>Skill</th><th>State</th><th>Target</th><th>ETA</th><th>Missions</th></tr></thead><tbody>
  ${snap.teams.map((t) => `<tr><td><b>${esc(t.name)}</b></td><td class="t2">${esc(t.skill)}</td><td>${esc(t.state.toLowerCase().replace("_", " "))}</td>
    <td class="m">${esc(t.target ?? "—")}</td><td class="m">${t.eta ? `${t.eta} ticks` : "—"}</td><td class="m">${num(t.missions)}</td></tr>`).join("")}
  </tbody></table></div></div>
  <div class="sec"><h3>Work queue</h3>${queue.length ? queue.map((n) => `<div class="row" data-action="open-node" data-id="${esc(n.id)}">
    <span class="m">${esc(n.id)}</span><span class="g">${esc(cfg.status_names[n.status])}</span><span class="t2 sm">${n.repairing ? "repairing" : "crew assigned"}</span></div>`).join("") : `<div class="t2">No open work orders.</div>`}</div>`;
}

// ---------------------------------------------------------------- settings
function settings(snap, cfg) {
  const p = cfg.presentation, c = snap.control;
  return `
  <h2>Simulation settings</h2>
  <div class="sec"><h3>Speed</h3>
    <div class="tb"><input type="range" id="speed" min="${p.speed_min}" max="${p.speed_max}" step="0.25" value="${c.speed}">
      <b class="m" id="speed-v">${c.speed}×</b><button class="btn" data-action="speed-apply">Apply</button></div>
    <p class="sm t2">Simulated time runs faster or slower.</p></div>
  <div class="sec"><h3>Run</h3>
    <div class="kv"><div><span class="t2 sm">Run</span><b class="m">${esc(snap.run_id.slice(0, 8))}</b></div>
      <div><span class="t2 sm">Seed</span><b class="m">${c.seed}</b></div>
      <div><span class="t2 sm">Sim time</span><b class="m">${esc(snap.kpis.sim_time)}</b></div>
      <div><span class="t2 sm">Tick</span><b class="m">${num(snap.tick)}</b></div>
      <div><span class="t2 sm">Tick length</span><b class="m">${cfg.tick_minutes} min</b></div>
      <div><span class="t2 sm">Sites / crews</span><b class="m">${cfg.num_nodes} / ${cfg.num_teams}</b></div></div></div>
  <div class="sec"><h3>Scenarios</h3>
    <div class="tb"><button class="btn" data-action="scenario" data-kind="fault">Inject a site fault…</button>
      <button class="btn" data-action="scenario" data-kind="cut">Fibre isolation scenario…</button>
      <button class="btn" data-action="about">About SuliNOC</button></div></div>`;
}

export const VIEWS = { ov: overview, live, towers, topo, inc: incidents, ai, ana: analytics, mnt: maint, set: settings };
