// Live operations map on Leaflet with CARTO Voyager tiles. Sites, fibre rings,
// crews and the static geography all use real lat/lon, so the simulation sits on
// the actual streets of Sulaymaniyah. Public API mirrors the old SVG map:
// update(snap, cfg), setSelected(id), applyFilter(fn), reset(), destroy().
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { esc } from "./util.js";

// CARTO requires a free basemap key for raster tiles. It is read at build time
// from VITE_CARTO_KEY so it never lives in the source tree.
const CARTO_KEY = import.meta.env.VITE_CARTO_KEY ?? "";
const TILE_URL = `https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png${CARTO_KEY ? `?key=${encodeURIComponent(CARTO_KEY)}` : ""}`;
const ATTRIBUTION = '&copy; <a href="https://carto.com/">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const START = { center: [35.5558, 45.4351], zoom: 12 };
const ROAD = "#A9C2E6", LINK = "#0284c7", CUT = "#ef4444", WHITE = "#ffffff";

// Crisp white maintenance-van badge (same design as the SVG crew marker).
const VAN_HTML = `<svg viewBox="-13 -11 26 22" width="26" height="22" aria-hidden="true">
  <rect x="-13" y="-11" width="26" height="22" rx="7" fill="#ffffff" stroke="#0284c7" stroke-width="2"/>
  <g transform="translate(0 0.5)">
    <path d="M-8 3 V-2 Q-8 -4 -6 -4 H1 L4 -1 H7.5 Q8.5 -1 8.5 0 V3 Z" fill="#0c4a6e"/>
    <path d="M-3.5 -3 H0 L2.5 -1 H-3.5 Z" fill="#bae6fd"/>
    <rect x="-1.5" y="-0.5" width="3" height="1.2" fill="#e0f2fe"/>
    <circle cx="-4.5" cy="3.5" r="2" fill="#0c4a6e" stroke="#fff" stroke-width="1"/>
    <circle cx="5" cy="3.5" r="2" fill="#0c4a6e" stroke="#fff" stroke-width="1"/>
  </g></svg>`;

const label = (text, cls = "") =>
  L.divIcon({ className: `map-label ${cls}`, html: esc(text), iconSize: null });

// Quadratic curve from the depot to a site, bowed to the north like the design's
// schematic route. Returns sample points as [lat, lon].
function routeCurve(a, b, n = 48) {
  const dLat = b[0] - a[0], dLon = b[1] - a[1];
  const len = Math.hypot(dLat, dLon) || 1;
  let nLat = -dLon / len, nLon = dLat / len;
  if (nLat < 0) { nLat = -nLat; nLon = -nLon; }
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const c = [mid[0] + nLat * 0.2 * len, mid[1] + nLon * 0.2 * len];
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n, k = (1 - u) ** 2, m = 2 * (1 - u) * u, q = u * u;
    pts.push([k * a[0] + m * c[0] + q * b[0], k * a[1] + m * c[1] + q * b[1]]);
  }
  return pts;
}

export class LiveMap {
  constructor(el, { onSelect = () => {}, onHover = () => {} } = {}) {
    this.el = el;
    this.onSelect = onSelect;
    this.onHover = onHover;
    this.selected = null;
    this.bounds = null;
    this.cfgKey = "";
    this.visible = () => true;
    this.nodes = new Map();   // site id -> circleMarker
    this.crews = new Map();   // crew name -> marker
    this.halos = new Map();   // site id -> soft status halo (design: .halo)
    this.siteRings = new Map(); // site id -> ring (pulses on faults, dashed for AI warnings)
    this.vanPos = new Map();  // crew name -> [lat, lon] on the drawn route
    this.rips = new Map();    // site id -> pulsing ripple marker (fault or AI warning)
    this.latest = null;

    const map = L.map(el, { center: START.center, zoom: START.zoom, zoomControl: false, attributionControl: true });
    this.map = map;
    L.control.zoom({ position: "bottomright" }).addTo(map);
    L.tileLayer(TILE_URL, { attribution: ATTRIBUTION, subdomains: "abcd", maxZoom: 19, detectRetina: true }).addTo(map);

    // Panes keep the layering explicit: geography < fibre < sites < vans.
    map.createPane("fibre").style.zIndex = 430;
    map.createPane("sites").style.zIndex = 620;
    map.createPane("vans").style.zIndex = 640;
    this.static = L.layerGroup().addTo(map);
    this.fibre = L.layerGroup().addTo(map);
    this.siteLayer = L.layerGroup().addTo(map);
    this.vanLayer = L.layerGroup().addTo(map);
    this.selRing = L.circleMarker([0, 0], { pane: "sites", radius: 11, color: LINK, weight: 2, fill: false, interactive: false });

    this.resizeObs = new ResizeObserver(() => map.invalidateSize());
    this.resizeObs.observe(el);
    setTimeout(() => map.invalidateSize(), 0);
  }

  destroy() {
    this.resizeObs.disconnect();
    this.map.remove();
  }

  reset() {
    if (this.bounds) {
      const b = this.bounds;
      this.map.fitBounds([[b.lat_min, b.lon_min], [b.lat_max, b.lon_max]], { padding: [30, 30] });
    } else {
      this.map.setView(START.center, START.zoom);
    }
  }

  applyFilter(fn) {
    this.visible = fn;
    if (this.latest) this.styleSites();
  }

  setSelected(id) {
    this.selected = id;
    this.styleSites();
    const m = id ? this.nodes.get(id) : null;
    if (m) {
      this.selRing.setLatLng(m.getLatLng()).addTo(this.siteLayer);
    } else {
      this.selRing.remove();
    }
  }

  // Static geography: roads, aggregation sites, EPCs and depot. Redrawn only if the config changes.
  drawStatic(cfg) {
    const key = JSON.stringify([cfg.bounds, cfg.map_center]);
    if (this.cfgKey === key) return;
    this.cfgKey = key;
    this.bounds = cfg.bounds;
    this.static.clearLayers();
    for (const r of cfg.presentation?.roads ?? []) {
      L.polyline(r.path, { color: ROAD, weight: 3, opacity: 0.8, lineCap: "round", interactive: false }).addTo(this.static);
    }
    for (const s of cfg.agg_sites ?? []) {
      L.circle([s.lat, s.lon], { radius: 320, color: s.color, weight: 0, fillColor: s.color, fillOpacity: 0.12, interactive: false }).addTo(this.static);
      L.marker([s.lat, s.lon], { icon: label(s.name, "map-label-agg"), interactive: false, keyboard: false }).addTo(this.static);
    }
    for (const [name, e] of [["EPC", cfg.epc_primary], ["EPC backup", cfg.epc_backup]]) {
      if (!e) continue;
      L.marker([e.lat, e.lon], { icon: L.divIcon({ className: "epc-icon", html: "", iconSize: [14, 14] }), interactive: false, keyboard: false }).addTo(this.static);
      L.marker([e.lat, e.lon], { icon: label(name, "map-label-epc"), interactive: false, keyboard: false }).addTo(this.static);
    }
    if (cfg.depot) {
      L.marker([cfg.depot.lat, cfg.depot.lon], { icon: label("Depot", "map-label-epc"), interactive: false, keyboard: false }).addTo(this.static);
    }
  }

  styleSites() {
    if (!this.latest) return;
    const colors = this.latest.cfg.status_colors ?? {};
    const healthy = this.latest.cfg.presentation?.healthy_status ?? 0;
    for (const [id, m] of this.nodes) {
      const n = this.latest.nodeById.get(id);
      if (!n) continue;
      const on = this.visible(n);
      const col = colors[n.status] ?? "#4DDB9B";
      const bad = n.status !== healthy;
      const halo = this.halos.get(id), ring = this.siteRings.get(id);
      halo?.setStyle({ fillColor: col, fillOpacity: on ? (bad ? 0.3 : n.warn ? 0.25 : 0.16) : 0.04 });
      if (ring) {
        if (bad) ring.setStyle({ color: col, opacity: 0.8, dashArray: null });
        else if (n.warn) ring.setStyle({ color: "#6A4BD8", opacity: 0.9, dashArray: "3 3" });
        else ring.setStyle({ opacity: 0 });
        ring._path?.classList.toggle("ring-crit", bad);
      }
      m.setStyle({
        fillColor: colors[n.status] ?? "#4DDB9B",
        fillOpacity: on ? 0.95 : 0.14,
        opacity: on ? 1 : 0.14,
        color: WHITE,
        weight: id === this.selected ? 3 : 2,
      });
    }
  }

  // Dynamic layer: called once per snapshot.
  update(snap, cfg) {
    this.drawStatic(cfg);
    const nodeById = new Map(snap.nodes.map((n) => [n.id, n]));
    const colors = cfg.status_colors ?? {};
    this.latest = { snap, cfg, nodeById };

    // Fibre rings, cut markers and crew routes are rebuilt each snapshot.
    this.fibre.clearLayers();
    for (const r of snap.rings ?? []) {
      const iso = !!r.isolated;
      L.polyline(r.path, {
        pane: "fibre", className: iso ? "fibre iso" : "fibre",
        color: iso ? CUT : LINK, weight: iso ? 3 : 2, opacity: iso ? 1 : 0.75,
        dashArray: iso ? "6, 8" : null, interactive: false,
      }).addTo(this.fibre);
      for (const c of r.cuts ?? []) {
        L.circleMarker([c.lat, c.lon], { pane: "fibre", radius: 6, color: WHITE, weight: 2, fillColor: CUT, fillOpacity: 1, interactive: false }).addTo(this.fibre);
      }
    }
    this.vanPos.clear();
    const depot = cfg.depot ? [cfg.depot.lat, cfg.depot.lon] : null;
    for (const t of snap.teams ?? []) {
      if (t.target_lat == null || !depot) continue;
      const pts = routeCurve(depot, [t.target_lat, t.target_lon]);
      // Where the crew is on the curve: the nearest sample to its engine position.
      let idx = 0, best = Infinity;
      pts.forEach((p, i) => {
        const d = (p[0] - t.lat) ** 2 + (p[1] - t.lon) ** 2;
        if (d < best) { best = d; idx = i; }
      });
      this.vanPos.set(t.name, pts[idx]);
      L.polyline(pts, { pane: "fibre", color: WHITE, weight: 9, opacity: 0.85, interactive: false }).addTo(this.fibre);
      L.polyline(pts, { pane: "fibre", color: "#B7CDEB", weight: 5, interactive: false }).addTo(this.fibre);
      L.polyline(pts, { pane: "fibre", className: "route-ants", color: WHITE, weight: 1.6, dashArray: "6 8", interactive: false }).addTo(this.fibre);
      L.polyline(pts.slice(0, idx + 1), { pane: "fibre", color: "#D42F52", weight: 3.5, lineCap: "round", interactive: false }).addTo(this.fibre);
    }

    // Sites: created once, then moved and restyled in place so hover and selection survive.
    for (const n of snap.nodes) {
      let m = this.nodes.get(n.id);
      if (!m) {
        const halo = L.circleMarker([n.lat, n.lon], { pane: "sites", radius: 11, stroke: false, fillColor: LINK, fillOpacity: 0.16, interactive: false });
        const ring = L.circleMarker([n.lat, n.lon], { pane: "sites", radius: 13, color: "transparent", weight: 1.2, fill: false, interactive: false });
        halo.addTo(this.siteLayer);
        ring.addTo(this.siteLayer);
        this.halos.set(n.id, halo);
        this.siteRings.set(n.id, ring);
        m = L.circleMarker([n.lat, n.lon], { pane: "sites", radius: 6, className: "tower", color: WHITE, weight: 2, fillOpacity: 0.95 });
        m.on("click", () => this.onSelect(n.id));
        m.on("mouseover", (e) => { m.setStyle({ weight: 3 }); this.onHover(n.id, e.originalEvent); });
        m.on("mouseout", () => { m.setStyle({ weight: n.id === this.selected ? 3 : 2 }); this.onHover(null); });
        m.bindTooltip("", { direction: "top", offset: [0, -8] });
        m.addTo(this.siteLayer);
        this.nodes.set(n.id, m);
      }
      m.setLatLng([n.lat, n.lon]);
      m.setRadius(n.critical ? 7 : 6);
      m.setTooltipContent(`${esc(n.id)} · ${esc(cfg.status_names?.[n.status] ?? "")}`);
    }
    this.styleSites();
    if (this.selected) this.setSelected(this.selected);

    // Ripples as in the old console: a radar ripple for a faulted site, a sonar ping for an AI warning.
    const healthy = cfg.presentation?.healthy_status ?? 0;
    for (const n of snap.nodes) {
      const key = n.status !== healthy ? "fault" : n.warn ? "warn" : null;
      const cur = this.rips.get(n.id);
      if (cur?.key === key) continue;
      if (cur) { cur.marker.remove(); this.rips.delete(n.id); }
      if (key) {
        const marker = L.marker([n.lat, n.lon], {
          pane: "sites", interactive: false, keyboard: false, zIndexOffset: key === "fault" ? 400 : 350,
          icon: L.divIcon({ className: "tw-icon", iconSize: [12, 12], iconAnchor: [6, 6],
            html: `<div class="tw ${key}" style="--c:${colors[n.status] ?? "#4DDB9B"}"><i></i></div>` }),
        }).addTo(this.siteLayer);
        this.rips.set(n.id, { key, marker });
      }
    }

    // Maintenance vans: one marker per crew, moved along the real streets.
    const seen = new Set();
    for (const t of snap.teams ?? []) {
      seen.add(t.name);
      let m = this.crews.get(t.name);
      const tip = `${esc(t.name)} · ${esc(t.state.toLowerCase().replace("_", " "))}`;
      if (!m) {
        m = L.marker([t.lat, t.lon], {
          pane: "vans", keyboard: false,
          icon: L.divIcon({ className: "van-icon", html: VAN_HTML, iconSize: [26, 22], iconAnchor: [13, 11] }),
        });
        m.bindTooltip(tip, { direction: "top", offset: [0, -12] });
        m.addTo(this.vanLayer);
        this.crews.set(t.name, m);
      }
      const at = this.vanPos.get(t.name) ?? [t.lat, t.lon];
      m.setLatLng(at); // CSS transition on .van-icon glides it between polls
      m.setTooltipContent(t.target_lat != null ? `${tip} · ETA ${t.eta} ticks` : tip);
    }
    for (const [name, m] of this.crews) {
      if (!seen.has(name)) { m.remove(); this.crews.delete(name); }
    }
  }
}
