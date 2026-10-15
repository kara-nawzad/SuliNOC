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
    for (const [id, m] of this.nodes) {
      const n = this.latest.nodeById.get(id);
      if (!n) continue;
      const on = this.visible(n);
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
    for (const t of snap.teams ?? []) {
      if (t.target_lat != null) {
        L.polyline([[t.lat, t.lon], [t.target_lat, t.target_lon]], { pane: "fibre", color: LINK, weight: 1.5, dashArray: "4 4", opacity: 0.8, interactive: false }).addTo(this.fibre);
      }
    }

    // Sites: created once, then moved and restyled in place so hover and selection survive.
    for (const n of snap.nodes) {
      let m = this.nodes.get(n.id);
      if (!m) {
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
      m.setLatLng([t.lat, t.lon]);
      m.setTooltipContent(tip);
    }
    for (const [name, m] of this.crews) {
      if (!seen.has(name)) { m.remove(); this.crews.delete(name); }
    }
  }
}
