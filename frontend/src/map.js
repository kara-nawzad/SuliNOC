// Schematic SVG network map. Projects the backend's lat/lon into a 1000x600
// viewBox using the engine's bounds, so the picture matches the real geography
// the simulation uses. Static layers (roads, depot, EPCs) are drawn once per
// config; dynamic layers (sites, rings, crews) are redrawn each snapshot.
import { esc } from "./util.js";

const NS = "http://www.w3.org/2000/svg";
const W = 1000, H = 600;


// The design's intro layout: 36 towers in seven clusters, the same links and the
// same pulse timings, reproduced from the design's seeded generator.
export function designGraph() {
  let sd = 7;
  const R = (n) => {
    let a = n += 0x6D2B79F5;
    a = Math.imul(a ^ a >>> 15, a | 1);
    a ^= a + Math.imul(a ^ a >>> 7, a | 61);
    return ((a ^ a >>> 14) >>> 0) / 4294967296;
  };
  const rnd = () => R(sd++);
  const CC = [[470, 290], [640, 240], [330, 350], [560, 430], [250, 190], [770, 390], [420, 160]];
  const T = [];
  for (let i = 0; i < 36; i++) {
    const c = CC[i % 7], g = () => (rnd() + rnd() + rnd() - 1.5) * 110;
    rnd();                                  // site name
    const x = Math.round(c[0] + g());
    const y = Math.round(c[1] + g() * 0.7);
    for (let k = 0; k < 6; k++) rnd();      // rsrp, sinr, prb, drop, temp, batt
    T.push({ id: i, x, y });
  }
  const L = [];
  T.forEach((a) => {
    T.map((b) => [b.id, (a.x - b.x) ** 2 + (a.y - b.y) ** 2])
      .filter((o) => o[0] != a.id).sort((p, q) => p[1] - q[1]).slice(0, 2)
      .forEach((o) => {
        if (!L.some((l) => (l[0] == o[0] && l[1] == a.id) || (l[0] == a.id && l[1] == o[0]))) L.push([a.id, o[0]]);
      });
  });
  const picks = [3, 11, 18, 25, 31, 40].filter((i) => L[i]).map((i) => ({ l: L[i], t: rnd() }));
  return { pos: T.map((t) => [t.x, t.y]), links: L, picks };
}

export function projector(bounds) {
  const latMid = (bounds.lat_min + bounds.lat_max) / 2;
  const kx = Math.cos((latMid * Math.PI) / 180);
  const spanX = (bounds.lon_max - bounds.lon_min) * kx;
  const spanY = bounds.lat_max - bounds.lat_min;
  const pad = 40;
  const s = Math.min((W - 2 * pad) / spanX, (H - 2 * pad) / spanY);
  const ox = (W - spanX * s) / 2, oy = (H - spanY * s) / 2;
  return ([lat, lon]) => [
    ox + (lon - bounds.lon_min) * kx * s,
    oy + (bounds.lat_max - lat) * s,
  ];
}

const pts = (list, p) => list.map((c) => p(c).map((v) => v.toFixed(1)).join(",")).join(" ");

export class NetworkMap {
  constructor(svg, { interactive = true, onSelect = () => {}, onHover = () => {}, hero = false } = {}) {
    this.svg = svg;
    this.interactive = interactive;
    this.hero = hero;
    this.heroLinks = null;   // [siteIdA, siteIdB] pairs (design: L)
    this.heroPos = new Map(); // site id -> [x, y] in the schematic viewBox
    this.heroPulses = [];    // travelling pulse dots riding the links (design: PL)
    this.heroRaf = 0;
    this.heroIds = null;     // the 36 sites shown in the intro, as in the design
    this.onSelect = onSelect;
    this.onHover = onHover;
    this.view = { x: 0, y: 0, w: W, h: H };
    this.selected = null;
    this.project = null;
    this.key = "";
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    if (interactive) this.bindInteraction();
  }

  setSelected(id) {
    this.selected = id;
    this.svg.querySelectorAll(".nd").forEach((el) =>
      el.classList.toggle("sel", el.dataset.id === id));
  }

  setView(v) {
    this.view = v;
    this.svg.setAttribute("viewBox", `${v.x} ${v.y} ${v.w} ${v.h}`);
  }

  reset() {
    this.setView({ x: 0, y: 0, w: W, h: H });
  }

  bindInteraction() {
    const svg = this.svg;
    svg.addEventListener("wheel", (e) => {
      e.preventDefault();
      const z = e.deltaY > 0 ? 1.12 : 0.89;
      const w = Math.min(W, Math.max(180, this.view.w * z)), h = w * (H / W);
      const cx = this.view.x + this.view.w / 2, cy = this.view.y + this.view.h / 2;
      this.setView({ x: cx - w / 2, y: cy - h / 2, w, h });
    }, { passive: false });
    let drag = null;
    svg.addEventListener("pointerdown", (e) => {
      if (e.target.closest(".nd")) return;
      drag = { x: e.clientX, y: e.clientY, v: { ...this.view } };
      svg.setPointerCapture(e.pointerId);
    });
    svg.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const k = this.view.w / svg.clientWidth;
      this.setView({ ...drag.v, x: drag.v.x - (e.clientX - drag.x) * k, y: drag.v.y - (e.clientY - drag.y) * k });
    });
    svg.addEventListener("pointerup", () => (drag = null));
    svg.addEventListener("click", (e) => {
      const g = e.target.closest(".nd");
      if (g) this.onSelect(g.dataset.id);
    });
    svg.addEventListener("pointerover", (e) => {
      const g = e.target.closest(".nd");
      this.onHover(g ? g.dataset.id : null, e);
    });
    svg.addEventListener("pointerleave", () => this.onHover(null));
  }

  // Static layer: geography that never changes during a run.
  drawStatic(cfg) {
    const key = JSON.stringify([cfg.bounds, cfg.map_center]);
    if (this.key === key) return;
    this.key = key;
    this.project = projector(cfg.bounds);
    const p = this.project;
    const g = this.layer("static");
    g.innerHTML = `
      ${(cfg.presentation?.roads ?? []).map((r) =>
        `<polyline class="road" points="${pts(r.path, p)}"><title>${esc(r.name)}</title></polyline>`).join("")}
      ${(cfg.agg_sites ?? []).map((s) => {
        const [x, y] = p([s.lat, s.lon]);
        return `<g class="agg"><circle cx="${x}" cy="${y}" r="26" fill="${esc(s.color)}" opacity=".10"/>
          <text class="mt" x="${x}" y="${y - 30}" text-anchor="middle">${esc(s.name)}</text></g>`;
      }).join("")}
      ${[["EPC", cfg.epc_primary], ["EPC backup", cfg.epc_backup]].map(([label, e]) => {
        if (!e) return "";
        const [x, y] = p([e.lat, e.lon]);
        return `<g class="epc"><rect x="${x - 7}" y="${y - 7}" width="14" height="14" rx="3" fill="#10265C"/>
          <text class="mt" x="${x + 12}" y="${y + 4}">${esc(label)}</text></g>`;
      }).join("")}
      ${cfg.depot ? (() => {
        const [x, y] = p([cfg.depot.lat, cfg.depot.lon]);
        return `<g class="depot"><path d="M${x - 9} ${y + 6}V${y - 4}L${x} ${y - 11}L${x + 9} ${y - 4}V${y + 6}Z" fill="#fff" stroke="#10265C" stroke-width="1.5"/>
          <text class="mt" x="${x + 12}" y="${y + 4}">Depot</text></g>`;
      })() : ""}`;
  }

  layer(name) {
    let g = this.svg.querySelector(`g[data-layer="${name}"]`);
    if (!g) {
      g = document.createElementNS(NS, "g");
      g.dataset.layer = name;
      this.svg.appendChild(g);
    }
    return g;
  }

  // Pick k sites spread across the network (farthest-point sampling), so the
  // intro shows a few well-spaced towers like the design rather than every site.
  heroSample(nodes, k = 36) {
    if (nodes.length <= k) return nodes;
    const d2 = (a, b) => (a.lat - b.lat) ** 2 + (a.lon - b.lon) ** 2;
    const chosen = [nodes[0]];
    const dist = nodes.map((n) => d2(n, nodes[0]));
    while (chosen.length < k) {
      let best = 0;
      for (let i = 1; i < dist.length; i++) if (dist[i] > dist[best]) best = i;
      chosen.push(nodes[best]);
      for (let i = 0; i < nodes.length; i++) dist[i] = Math.min(dist[i], d2(nodes[i], nodes[best]));
    }
    return chosen;
  }

  // Hero intro: the design's layout, links, pulses and AI flag.
  drawHero(snap) {
    if (this.heroLinks) return;
    const D = designGraph();
    const sample = [...snap.nodes].sort((a, b) => String(a.id).localeCompare(String(b.id))).slice(0, D.pos.length);
    this.heroPos = new Map(sample.map((n, i) => [n.id, D.pos[i]]));
    this.heroXY = new Map(sample.map((n, i) => [`${n.lat},${n.lon}`, D.pos[i]]));
    this.heroLinks = D.links.map(([i, j]) => [sample[i].id, sample[j].id]);
    this.heroPulses = D.picks.map((p) => ({ l: [sample[p.l[0]].id, sample[p.l[1]].id], t: p.t }));
    const pos = (id) => this.heroPos.get(id);
    this.layer("hlinks").innerHTML = this.heroLinks.map(([a, b], k) => {
      const A = pos(a), B = pos(b);
      return `<line class="lk" pathLength="1" x1="${A[0]}" y1="${A[1]}" x2="${B[0]}" y2="${B[1]}" style="--d:${900 + k * 14}ms"/>`;
    }).join("");
    this.layer("hpulses").innerHTML = this.heroPulses.map(() => '<circle class="pu" r="2.6"/>').join("");
    // AI flag: dashed lines from the flagged site to its neighbours, and its label.
    const flag = sample.find((n) => n.warn);
    if (flag) {
      const F = pos(flag.id);
      const lines = this.heroLinks.filter((l) => l.includes(flag.id)).map((l) => {
        const O = pos(l[0] === flag.id ? l[1] : l[0]);
        return `<line x1="${F[0]}" y1="${F[1]}" x2="${O[0]}" y2="${O[1]}" stroke="#A88BFA" stroke-width="1.4" stroke-dasharray="5 4" opacity=".85"/>`;
      }).join("");
      this.layer("haip").innerHTML = lines + `<text class="lbl" x="${F[0] + 14}" y="${F[1] + 4}">${flag.id} · model flag</text>`;
    }
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const tick = (now) => {
        if (!document.hidden) {
          const els = this.layer("hpulses").children;
          this.heroPulses.forEach((pu, i) => {
            const el = els[i]; if (!el) return;
            const t = ((now / 3200) + pu.t) % 1;
            const a = this.heroPos.get(pu.l[0]), b = this.heroPos.get(pu.l[1]);
            el.setAttribute("cx", a[0] + (b[0] - a[0]) * t);
            el.setAttribute("cy", a[1] + (b[1] - a[1]) * t);
            el.setAttribute("opacity", Math.sin(t * Math.PI));
          });
        }
        this.heroRaf = requestAnimationFrame(tick);
      };
      this.heroRaf = requestAnimationFrame(tick);
    }
  }

  // Dynamic layer: sites, fibre rings, crews. Called once per snapshot.
  update(snap, cfg) {
    if (!this.project) this.drawStatic(cfg);
    const p = this.project;
    if (this.hero) {
      if (!this.heroIds) this.heroIds = new Set(this.heroSample(snap.nodes).map((n) => n.id));
      snap = { ...snap, nodes: snap.nodes.filter((n) => this.heroIds.has(n.id)), rings: [], teams: [] };
      this.drawHero(snap);
      if (!this.heroWrapped && this.heroXY) {
        // Site positions on the intro come from the design layout; everything else keeps the projection.
        const base = this.project;
        this.project = (c) => this.heroXY.get(`${c[0]},${c[1]}`) ?? base(c);
        this.heroWrapped = true;
      }
    }
    const colors = cfg.status_colors ?? {};
    const offline = new Set(cfg.presentation?.offline_statuses ?? []);
    const healthy = cfg.presentation?.healthy_status ?? 0;

    this.layer("rings").innerHTML = (snap.rings ?? []).map((r) => {
      const cls = r.isolated ? "ring isolated" : "ring";
      const cuts = (r.cuts ?? []).map((c) => {
        const [x, y] = p([c.lat, c.lon]);
        return `<g class="cut"><line x1="${x - 7}" y1="${y - 7}" x2="${x + 7}" y2="${y + 7}"/><line x1="${x - 7}" y1="${y + 7}" x2="${x + 7}" y2="${y - 7}"/></g>`;
      }).join("");
      return `<polyline class="${cls}" points="${pts(r.path, p)}"/>${cuts}`;
    }).join("");

    const teams = (snap.teams ?? []).map((t) => {
      const [x, y] = p([t.lat, t.lon]);
      const route = t.target_lat != null
        ? (() => { const [tx, ty] = p([t.target_lat, t.target_lon]);
            return `<line class="route" x1="${x}" y1="${y}" x2="${tx}" y2="${ty}"/>`; })()
        : "";
      return `${route}<g class="crew ${esc(t.state)}" transform="translate(${x} ${y})">
        <rect class="badge" x="-13" y="-11" width="26" height="22" rx="7"/>
        <g class="van" transform="translate(0 0.5)">
          <path d="M-8 3 V-2 Q-8 -4 -6 -4 H1 L4 -1 H7.5 Q8.5 -1 8.5 0 V3 Z" fill="#0c4a6e"/>
          <path d="M-3.5 -3 H0 L2.5 -1 H-3.5 Z" fill="#bae6fd"/>
          <rect x="-1.5" y="-0.5" width="3" height="1.2" fill="#e0f2fe"/>
          <circle cx="-4.5" cy="3.5" r="2" fill="#0c4a6e" stroke="#fff" stroke-width="1"/>
          <circle cx="5" cy="3.5" r="2" fill="#0c4a6e" stroke="#fff" stroke-width="1"/>
        </g>
        <title>${esc(t.name)} · ${esc(t.state.toLowerCase())}</title></g>`;
    }).join("");
    this.layer("crews").innerHTML = teams;

    const nodes = snap.nodes.map((n, k) => {
      const [x, y] = p([n.lat, n.lon]);
      const off = offline.has(n.status);
      const fault = n.status !== healthy;
      const cls = ["nd", off ? "crit" : fault ? "warn" : "", n.critical ? "critical" : "",
        n.warn ? "ai" : "", n.dispatched ? "dispatched" : "", n.repairing ? "repairing" : ""]
        .filter(Boolean).join(" ");
      const fill = colors[n.status] ?? "#4DDB9B";
      return `<g class="${cls}" data-id="${esc(n.id)}" style="--d:${this.hero ? 1500 + (k % 6) * 140 + Math.floor(k / 6) * 40 : 0}ms" transform="translate(${x.toFixed(1)} ${y.toFixed(1)})">
        <circle class="halo" r="11"/><circle class="ring" r="13"/>
        <circle class="dot" r="${n.id === this.selected ? 6.5 : 4.5}" style="fill:${esc(fill)}"/></g>`;
    }).join("");
    this.layer("nodes").innerHTML = nodes;
    this.setSelected(this.selected);
  }
}
