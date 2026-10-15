// SuliNOC console entry point: hero intro, navigation, top-bar simulation
// controls, search, and the live update loop that feeds every view.
import "./style.css";
import "./app.css";
import { api } from "./api.js";
import { getState, subscribe, loadConfig, startPolling, refreshNow } from "./store.js";
import { $, $$, esc, num, toast, reduceMotion } from "./util.js";
import { NetworkMap } from "./map.js";
import { VIEWS, nodeCounts, OFFLINE, districtName } from "./views.js";
import { openInspector, closeInspector, openScenario, openCounterfactual, openHistory, openAbout, closeModal } from "./panels.js";

const NAV = [
  ["ov", "Overview", "M3 3h7v7H3zM14 3h7v4h-7zM14 11h7v10h-7zM3 14h7v7H3z"],
  ["live", "Live network", "M3 12h4l3-8 4 16 3-8h4"],
  ["towers", "Tower inventory", "M12 8v13M8 21h8M7.5 4.5a6 6 0 000 7M16.5 4.5a6 6 0 010 7"],
  ["topo", "Topology", "M4 12a8 8 0 1016 0 8 8 0 10-16 0M12 4v16"],
  ["inc", "Incidents", "M12 3l10 18H2zM12 10v5M12 18v.5"],
  ["ai", "AI predictions", "M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"],
  ["ana", "Analytics", "M4 20V10M10 20V4M16 20v-7M22 20H2"],
  ["mnt", "Maintenance", "M3 17l6-6 4 4 8-8M14 7h7v7"],
  ["set", "Settings", "M12 15a3 3 0 100-6 3 3 0 000 6zM19 12l2-1-2-3-2 1-2-1-1-2h-4l-1 2-2 1-2-1-2 3 2 1v2l-2 1 2 3 2-1 2 1 1 2h4l1-2 2-1 2 1 2-3-2-1z"],
];
const SPEEDS = [0.5, 1, 2, 4, 8];

// Shared UI context: filters, search, and which view is open.
const ctx = {
  view: location.hash.replace("#", "") || "ov",
  query: "",
  district: "",
  status: "all",
  sev: "",
  tf: "30m",
  tele: null,
  armedRing: null,
  selected: null,
};
if (!NAV.some(([k]) => k === ctx.view)) ctx.view = "ov";

let map = null;
let heroMap = null;

// -------------------------------------------------------------------- hero
function bootHero(cfg) {
  const hm = $("#hm");
  heroMap = new NetworkMap(hm, { interactive: false });
  const enter = () => {
    $("#hero").classList.add("off");
    setTimeout(() => ($("#hero").hidden = true), 400);
  };
  $("#enter").onclick = enter;
  $("#skip").onclick = enter;
  $("#hero-sub").textContent = `${cfg.num_nodes} sites · ${cfg.agg_sites.length} districts · live from the engine`;
}

// -------------------------------------------------------------------- shell
function buildNav() {
  $("#side").innerHTML = `<div class="wm"><img class="logo" src="/assets/suli-noc-logo.png" alt="SuliNOC"></div>` +
    NAV.map(([k, label, d]) => `<button data-view="${k}" title="${label}"><svg viewBox="0 0 24 24"><path d="${d}"/></svg><span>${label}</span></button>`).join("");
  $("#side").addEventListener("click", (e) => {
    const b = e.target.closest("[data-view]");
    if (b) go(b.dataset.view);
  });
}

function go(view) {
  ctx.view = view;
  history.replaceState(null, "", `#${view}`);
  $$("#side button").forEach((b) => b.classList.toggle("on", b.dataset.view === view));
  $("#main").dataset.v = view;
  if (view === "ana") loadTelemetry();
  paint(true);
}

function paint(animate = false) {
  const st = getState();
  const snap = st.snap, cfg = st.config;
  if (!snap || !cfg) return;
  const view = $("#view");
  if (ctx.view === "live") {
    // The live map is persistent; it updates in place so pan and zoom survive.
    if (!view.querySelector("#netmap")) {
      view.innerHTML = VIEWS.live(snap, cfg, ctx);
      view.classList.toggle("anim", animate);
      map = new NetworkMap($("#netmap"), {
        onSelect: (id) => selectNode(id),
        onHover: (id, e) => showTip(id, e),
      });
      map.selected = ctx.selected;
    }
    map.update(snap, cfg);
    applyMapFilter(snap, cfg);
    return;
  }
  map = null;
  // Other views re-render from the snapshot; keep scroll position stable.
  const scroll = $("#main").scrollTop;
  view.innerHTML = VIEWS[ctx.view](snap, cfg, ctx);
  $("#main").scrollTop = scroll;
  if (animate) { view.classList.remove("anim"); void view.offsetWidth; view.classList.add("anim"); }
}

function applyMapFilter(snap, cfg) {
  const off = OFFLINE(cfg);
  const healthy = cfg.presentation.healthy_status;
  const show = (n) => {
    if (ctx.district !== "" && String(n.agg) !== String(ctx.district)) return false;
    if (ctx.status === "fault") return n.status !== healthy;
    if (ctx.status === "offline") return off.has(n.status);
    if (ctx.status === "ai") return n.warn;
    return true;
  };
  for (const el of $$("#netmap .nd")) {
    const n = getState().nodeById.get(el.dataset.id);
    el.classList.toggle("fade", !!n && !show(n));
  }
}

function showTip(id, e) {
  const tip = $("#tip");
  const n = id ? getState().nodeById.get(id) : null;
  if (!n) { tip.style.opacity = 0; return; }
  const cfg = getState().config;
  tip.innerHTML = `<b class="m">${esc(n.id)}</b><div class="sm t2">${esc(districtName(getState().snap, n.agg))}</div>
    <div class="sm"><i class="dot2" style="background:${esc(cfg.status_colors[n.status])}"></i>${esc(cfg.status_names[n.status])}</div>`;
  tip.style.left = `${e.clientX + 14}px`;
  tip.style.top = `${e.clientY + 14}px`;
  tip.style.opacity = 1;
}

function selectNode(id) {
  ctx.selected = id;
  map?.setSelected(id);
  openInspector(id);
}

// ------------------------------------------------------------------ top bar
function bindBar() {
  $("#tg").onclick = () => $("#app").classList.toggle("c");
  $("#q").addEventListener("input", (e) => {
    ctx.query = e.target.value;
    if (ctx.view !== "towers") go("towers");
    else paint();
  });
  $("#q").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const q = e.target.value.trim().toLowerCase();
    const hit = getState().snap?.nodes.find((n) => n.id.toLowerCase().includes(q));
    if (hit) selectNode(hit.id);
  });
  addEventListener("keydown", (e) => {
    if (e.target.matches("input,select,textarea")) return;
    if (e.key === "/") { e.preventDefault(); $("#q").focus(); }
    if (e.key === "[") $("#app").classList.toggle("c");
  });
  $("#simctl").addEventListener("click", (e) => simAction(e.target.closest("[data-sim]")?.dataset.sim));
  $("#simctl").addEventListener("change", (e) => {
    if (e.target.matches("[data-sim=ai]")) setAi(e.target.checked);
  });
}

async function simAction(name) {
  const st = getState();
  if (!name || !st.snap) return;
  const run = st.runId;
  try {
    if (name === "pause") { await (st.snap.control.paused ? api.resume(run) : api.pause(run)); }
    if (name === "step") { await api.step(run); toast("Advanced one simulation tick"); }
    if (name === "speed") {
      const cur = st.snap.control.speed;
      const next = SPEEDS.find((s) => s > cur) ?? SPEEDS[0];
      const v = Math.min(st.config.presentation.speed_max, Math.max(st.config.presentation.speed_min, next));
      await api.speed(v, run);
    }
    if (name === "cut") { openScenario("cut"); return; }
    if (name === "inject") { openScenario("fault"); return; }
    refreshNow();
  } catch (err) {
    toast(err.message, true);
  }
}

async function setAi(enabled) {
  const st = getState();
  try {
    await api.ai(enabled, st.runId, st.snap.control.auto_approve_seconds ?? 0);
    toast(enabled ? "AI enabled" : "AI disabled");
    refreshNow();
  } catch (err) {
    toast(err.message, true);
    paint();
  }
}

// ------------------------------------------------------------- delegation
function bindDelegation() {
  const onClick = async (e) => {
    const el = e.target.closest("[data-action]");
    if (!el) return;
    const a = el.dataset.action;
    const st = getState();
    if (a === "open-node") return selectNode(el.dataset.id);
    if (a === "goto") return go(el.dataset.view);
    if (a === "map-reset") return map?.reset();
    if (a === "scenario") return openScenario(el.dataset.kind);
    if (a === "about") return openAbout(st.config);
    if (a === "history") return openHistory();
    if (a === "cf") return openCounterfactual();
    if (a === "tf") { ctx.tf = el.dataset.tf; ctx.tele = null; return loadTelemetry(true); }
    if (a === "speed-apply") {
      const v = Number($("#speed").value);
      try { await api.speed(v, st.runId); toast(`Speed set to ${v}×`); refreshNow(); }
      catch (err) { toast(err.message, true); }
      return;
    }
    if (a === "ai-auto") {
      const s = Math.max(0, Math.min(600, Number($("#auto-s").value) || 0));
      try { await api.ai(!!st.snap.ai?.ai_enabled, st.runId, s); toast(`Auto-approve ${s ? `after ${s} s` : "off"}`); refreshNow(); }
      catch (err) { toast(err.message, true); }
      return;
    }
    if (a === "ring-cut") {
      const ring = Number(el.dataset.ring);
      if (ctx.armedRing !== ring) {
        ctx.armedRing = ring;
        clearTimeout(bindDelegation.disarm);
        bindDelegation.disarm = setTimeout(() => { ctx.armedRing = null; paint(); }, 4000);
        return paint();
      }
      ctx.armedRing = null;
      try { const r = await api.cut(ring, st.runId); toast(r.reason || `Ring ${ring} double cut`, !!r.ok === false); refreshNow(); }
      catch (err) { toast(err.message, true); }
      return;
    }
    if (a === "approve" || a === "veto") {
      try {
        const fn = a === "approve" ? api.approve : api.veto;
        await fn(Number(el.dataset.id), st.runId);
        toast(a === "approve" ? "Action approved · crew dispatched" : "Action vetoed");
        refreshNow();
      } catch (err) { toast(err.message, true); }
    }
  };
  $("#view").addEventListener("click", onClick);
  $("#ap").addEventListener("click", onClick);
  $("#view").addEventListener("change", (e) => {
    const f = e.target.dataset.filter;
    if (!f) return;
    if (f === "district") ctx.district = e.target.value;
    if (f === "tdistrict") ctx.district = e.target.value;
    if (f === "status") ctx.status = e.target.value;
    if (f === "sev") ctx.sev = e.target.value;
    paint();
  });
  $("#view").addEventListener("input", (e) => {
    if (e.target.id === "speed") $("#speed-v").textContent = `${e.target.value}×`;
  });
  $("#view").addEventListener("change", async (e) => {
    if (e.target.dataset.action === "ai-toggle") setAi(e.target.checked);
  });
}

// --------------------------------------------------------------- telemetry
// Telemetry is keyed to (run, timeframe). A failed request is not retried on
// every snapshot; the analytics view re-requests on a slow timer instead.
async function loadTelemetry(force = false) {
  const st = getState();
  if (!st.runId || ctx.view !== "ana") return;
  const key = `${st.runId}|${ctx.tf}`;
  if (!force && ctx.teleKey === key) return;
  ctx.teleKey = key;
  try {
    ctx.tele = await api.telemetryHistory(ctx.tf, st.runId);
    if (ctx.view === "ana") paint();
  } catch (err) {
    ctx.teleKey = null;
    ctx.tele = null;
    if (ctx.view === "ana") paint();
  }
}

setInterval(() => { if (ctx.view === "ana") loadTelemetry(true); }, 15000);

// ---------------------------------------------------------------- live loop
function onStoreEvent(kind, st) {
  const snap = st.snap;
  const off = $("#offline");
  if (kind === "offline") {
    off.hidden = false;
    off.textContent = `Backend unreachable — retrying. ${st.error ?? ""}`;
    return;
  }
  off.hidden = true;
  if (!snap) return;
  if (kind === "run") {
    ctx.tele = null;
    ctx.teleKey = null;
    ctx.selected = null;
    closeInspector();
    closeModal();
    map?.reset();
    toast("A new 30-day run has started");
    loadTelemetry();
  }
  if (snap.run_error) {
    off.hidden = false;
    off.textContent = `Engine error: ${snap.run_error}`;
  }
  $("#stat").textContent = `${num(snap.dashboard.incidents.length)} open incidents · ${num(nodeCounts(snap, st.config).offline)} sites offline`;
  $("#pausechip").textContent = snap.control.paused ? "paused" : "running";
  $("#pausechip").classList.toggle("paused", !!snap.control.paused);
  const pb = $("#simctl [data-sim=pause]");
  if (pb) pb.textContent = snap.control.paused ? "▶ Resume" : "❚❚ Pause";
  const sb = $("#simctl [data-sim=speed]");
  if (sb) sb.textContent = `${snap.control.speed}×`;
  const ai = $("#simctl [data-sim=ai]");
  if (ai && document.activeElement !== ai) ai.checked = !!snap.ai?.ai_enabled;
  $("#clk").textContent = snap.kpis.sim_time;
  $("#clk2").textContent = snap.kpis.sim_time;
  paint();
  if (ctx.view === "ana") loadTelemetry();
  if (ctx.selected && st.nodeById.has(ctx.selected) && $("#ap").classList.contains("open")) {
    openInspector(ctx.selected);
  }
}

function startClock() {
  const tick = () => { $("#clk2").textContent = new Date().toLocaleTimeString("en-GB"); };
  tick();
  setInterval(tick, 1000);
}

// -------------------------------------------------------------------- boot
async function boot() {
  $("#view").innerHTML = `<div class="boot"><div class="spinner"></div><span class="t2">Connecting to the engine…</span></div>`;
  let cfg;
  for (let attempt = 0; ; attempt++) {
    try { cfg = await loadConfig(); break; }
    catch (err) {
      $("#offline").hidden = false;
      $("#offline").textContent = `Backend unreachable — retrying. ${err.message}`;
      await new Promise((r) => setTimeout(r, Math.min(5000, 800 * (attempt + 1))));
    }
  }
  $("#offline").hidden = true;
  buildNav();
  bindBar();
  bindDelegation();
  bootHero(cfg);
  startClock();
  $("#app").classList.toggle("c", matchMedia("(max-width: 900px)").matches);
  if (reduceMotion()) document.documentElement.classList.add("rm");
  subscribe(onStoreEvent);
  startPolling();
  $$("#side button").forEach((b) => b.classList.toggle("on", b.dataset.view === ctx.view));
  $("#main").dataset.v = ctx.view;
  // The hero intro is for first visits; a reload that targets a view skips it.
  if (location.hash) { $("#hero").classList.add("off"); $("#hero").hidden = true; }
}

boot();
