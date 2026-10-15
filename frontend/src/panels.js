// Side inspector and modal dialogs. Modals are rendered into #modal and
// closed with Escape, the close button, or a backdrop click.
import { api } from "./api.js";
import { getState, refreshNow } from "./store.js";
import { esc, $, num, pct, toast } from "./util.js";
import { gaugeBar, sevChip, legendRows } from "./components.js";
import study from "./data/counterfactual_summary.json";

export function openModal(title, bodyHtml, { wide = false, onMount } = {}) {
  const root = $("#modal");
  root.innerHTML = `<div class="backdrop" data-close></div>
    <section class="modal ${wide ? "wide" : ""}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <header><h3>${esc(title)}</h3><button class="btn" data-close aria-label="Close">✕</button></header>
      <div class="mbody">${bodyHtml}</div></section>`;
  root.hidden = false;
  root.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", closeModal));
  onMount?.(root.querySelector(".mbody"));
}

export function closeModal() {
  const root = $("#modal");
  root.hidden = true;
  root.innerHTML = "";
}

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { closeModal(); closeInspector(); }
});

// ---------------------------------------------------------------- inspector
export function openInspector(id) {
  const st = getState();
  const n = st.nodeById.get(id);
  if (!n) return;
  const cfg = st.config;
  const panel = $("#ap");
  const district = st.snap.agg.find((a) => a.id === n.agg)?.name ?? `District ${n.agg}`;
  const statusName = cfg.status_names[n.status] ?? "Unknown";
  const color = cfg.status_colors[n.status] ?? "#4B6192";
  const gauges = Object.entries(cfg.gauges ?? {})
    .filter(([k]) => Number.isFinite(n[k]))
    .map(([k, spec]) => gaugeBar(n[k], spec, cfg.metric_labels?.[k] ?? k)).join("");
  const kv = [
    ["Power source", n.power], ["Power config", cfg.power_configs?.[n.pwr] ?? n.pwr],
    ["Battery", pct(n.battery, 0)], ["Fuel", pct(n.fuel, 0)],
    ["Throughput", `${num(n.throughput, 1)} Mbps`], ["Latency", `${num(n.latency, 1)} ms`],
    ["PRB load", pct(n.prb, 0)], ["Dust", num(n.dust, 2)],
  ].map(([k, v]) => `<div><span class="t2 sm">${esc(k)}</span><b>${esc(v)}</b></div>`).join("");
  const faulty = n.status !== cfg.presentation.healthy_status;
  const kinds = cfg.presentation.fault_options.map((o) => `<option value="${o.value}">${esc(o.label)}</option>`).join("");
  panel.innerHTML = `
    <div class="ph"><div><h3 class="m">${esc(n.id)}</h3><div class="sm t2">${esc(district)} · ${n.ring >= 0 ? `fibre ring ${n.ring}` : "unprotected"}</div></div>
      <button class="btn" data-close-panel aria-label="Close inspector">✕</button></div>
    <div class="status-line"><i style="background:${esc(color)}"></i><b>${esc(statusName)}</b>
      ${n.critical ? `<span class="chip" style="--c:#D42F52">critical site</span>` : ""}
      ${n.dispatched ? `<span class="chip" style="--c:#1479C4">crew assigned</span>` : ""}
      ${n.warn ? `<span class="chip" style="--c:#6A4BD8">AI prediction</span>` : ""}</div>
    <div class="kv">${kv}</div>
    <div class="sec"><h3>Signal & plant</h3>${gauges || `<div class="t2 sm">No gauge readings.</div>`}</div>
    ${n.warn ? `<div class="ai-box"><h4>Predictive assessment <span class="src">AI estimate</span></h4>
      <div class="sm t2">The Commander's live verdict sits at or above break-even precision for this site.</div></div>` : ""}
    <div class="sec"><h3>Simulate a fault</h3>
      <div class="tb"><select id="ins-kind" aria-label="Fault type">${kinds}</select>
      <button class="cta" id="ins-inject" ${faulty ? "disabled" : ""}>Inject fault</button></div>
      ${faulty ? `<div class="sm t2">Site is already in a fault state.</div>` : ""}</div>`;
  panel.classList.add("open");
  panel.querySelector("[data-close-panel]").onclick = closeInspector;
  panel.querySelector("#ins-inject")?.addEventListener("click", async () => {
    const kind = Number(panel.querySelector("#ins-kind").value);
    try {
      await api.inject(id, kind, st.runId);
      toast(`${id}: ${cfg.status_names[kind]} injected`);
      refreshNow();
    } catch (err) { toast(err.message, true); }
  });
}

export function closeInspector() {
  $("#ap").classList.remove("open");
}

// ---------------------------------------------------------------- scenarios
export function openScenario(kind = "fault") {
  const st = getState();
  if (!st.snap) return;
  const cfg = st.config;
  if (kind === "cut") {
    const rings = st.snap.rings.map((r) => `<option value="${r.id}">Ring ${r.id} · ${r.nodes.length} sites · ${num(r.circumference_km, 1)} km${r.isolated ? " (isolated)" : ""}</option>`).join("");
    openModal("Fibre isolation scenario", `
      <p class="sm t2">A double cut on one protected ring is rare in real life (about twice a simulated year),
        so this demo triggers it on command and isolates that ring's sites.</p>
      <label class="field">Ring<select id="sc-ring">${rings}</select></label>
      <div class="tb"><button class="cta" id="sc-go">Confirm double cut</button></div>`, {
      onMount: (b) => b.querySelector("#sc-go").onclick = async () => {
        try {
          const r = await api.cut(Number(b.querySelector("#sc-ring").value), st.runId);
          toast(r.reason || "Double cut applied. Watch the ring and crews.");
          closeModal(); refreshNow();
        } catch (err) { toast(err.message, true); }
      },
    });
    return;
  }
  const nodes = st.snap.nodes.filter((n) => n.status === cfg.presentation.healthy_status)
    .map((n) => `<option value="${esc(n.id)}">${esc(n.id)} · ${esc(st.snap.agg.find((a) => a.id === n.agg)?.name ?? "")}</option>`).join("");
  const kinds = cfg.presentation.fault_options.map((o) => `<option value="${o.value}">${esc(o.label)}</option>`).join("");
  openModal("Inject a site fault", `
    <p class="sm t2">Pick a healthy site and a fault class. The engine applies the degradation and the Commander reacts.</p>
    <label class="field">Site<select id="sc-node">${nodes}</select></label>
    <label class="field">Fault<select id="sc-kind">${kinds}</select></label>
    <div class="tb"><button class="cta" id="sc-go">Inject fault</button></div>`, {
    onMount: (b) => b.querySelector("#sc-go").onclick = async () => {
      try {
        await api.inject(b.querySelector("#sc-node").value, Number(b.querySelector("#sc-kind").value), st.runId);
        toast("Fault injected");
        closeModal(); refreshNow();
      } catch (err) { toast(err.message, true); }
    },
  });
}

// ------------------------------------------------------- counterfactual report
const ARMS = {
  A: "No AI · reactive dispatch",
  B: "Advisory · human approval",
  C: "Autonomous · tier-1 + tier-2",
  D: "Clairvoyant (upper bound)",
};

export function counterfactualTable() {
  const a = study.arms.A;
  const rows = ["A", "B", "C", "D"].map((k) => {
    const x = study.arms[k];
    const dt = x.downtime_tower_min.mean, cost = x.cost_tower_min.mean;
    const saved = study.headline.saved_vs_A[k];
    return `<tr><td><b>${k}</b> ${esc(ARMS[k])}</td>
      <td class="m">${x.availability.mean.toFixed(2)} ± ${x.availability.ci95.toFixed(2)}</td>
      <td class="m">${num(dt)}</td>
      <td class="m">${saved ? num(saved.downtime_saved_tower_min, 1) : "—"}</td>
      <td class="m">${num(x.pre_empted?.mean ?? 0, 0)}</td>
      <td class="m">${num(x.false_dispatches.mean, 1)}</td>
      <td class="m">${num(cost)}</td></tr>`;
  }).join("");
  const h = study.headline;
  return `<div class="stats3">
      <div><span class="t2 sm">Downtime removed vs no AI</span><b class="big2">${num(h.saved_vs_A.C.downtime_saved_tower_min)}</b><span class="sm t2">tower-minutes (C)</span></div>
      <div><span class="t2 sm">Share of clairvoyant headroom</span><b class="big2">${h.pct_of_clairvoyant_downtime_reduction.toFixed(1)}%</b><span class="sm t2">honest, uncapped</span></div>
      <div><span class="t2 sm">Autonomous worse than no AI?</span><b class="big2">${h.autonomous_worse_than_no_ai ? "Yes" : "No"}</b><span class="sm t2">${study.meta.n_seeds} seeds × ${study.meta.days} days</span></div></div>
    <div class="tablewrap"><table><thead><tr><th>Arm</th><th>Availability %</th><th>Downtime</th><th>Saved vs A</th><th>Pre-empts</th><th>False dispatches</th><th>Cost</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="sm t2">Source: <span class="m">reports/counterfactual_summary.json</span> (regenerated on the corrected engine, 2026-10-15). Mean over seeds; ± is the 95% CI.</p>`;
}

export function openCounterfactual() {
  openModal("Counterfactual impact report", counterfactualTable(), { wide: true });
}

// ---------------------------------------------------------------- run history
export async function openHistory() {
  openModal("Run history", `<div class="sm t2">Loading…</div>`, {
    wide: true,
    onMount: async (b) => {
      try {
        const { summaries } = await api.history();
        b.innerHTML = summaries.length ? `<div class="tablewrap"><table><thead><tr><th>Completed</th><th>Seed</th><th>Days</th><th>Availability</th><th>Injected</th><th>Repairs</th><th>MTTR (min)</th><th>AI</th><th>Pre-empts</th><th>False</th></tr></thead><tbody>
          ${summaries.map((s) => `<tr><td class="m">${esc(s.completed_at.replace("T", " ").slice(0, 16))}</td><td class="m">${s.seed}</td><td class="m">${s.simulated_days}</td>
            <td class="m">${s.availability.toFixed(2)}%</td><td class="m">${s.injected}</td><td class="m">${s.repairs}</td><td class="m">${num(s.mttr_min, 1)}</td>
            <td>${esc(s.ai_enabled ? s.ai_mode : "off")}</td><td class="m">${s.pre_empted}</td><td class="m">${s.false_dispatches}</td></tr>`).join("")}
          </tbody></table></div>` : `<div class="t2">No completed runs yet. A 30-day run is recorded when it finishes.</div>`;
      } catch (err) { b.innerHTML = `<div class="t2">${esc(err.message)}</div>`; }
    },
  });
}

export function openAbout(cfg) {
  openModal("About SuliNOC", `
    <p>SuliNOC is a predictive network-operations console for a simulated LTE network in Sulaymaniyah.
      A deterministic engine generates telemetry, faults and crew work; an AI Commander pre-empts failures
      it can predict, and a human can approve or veto its tier-2 actions.</p>
    <p class="sm t2">All telemetry, positions, incidents and crew movements are simulated. Nothing real is monitored or dispatched.</p>
    <div class="tb"><a class="btn" href="/docs" target="_blank" rel="noopener">Explore the API</a>
      <span class="sm t2 m">${cfg.num_nodes} sites · ${cfg.num_teams} crews · ${cfg.tick_minutes} min ticks</span></div>`);
}

export function legendFor(slices) { return legendRows(slices); }
export { sevChip };
