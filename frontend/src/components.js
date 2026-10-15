// Small presentational helpers shared by views and panels.
import { esc, num } from "./util.js";

export function sparkline(values, { w = 320, h = 64, color = "#1479C4", min, max } = {}) {
  const vals = values.filter((v) => Number.isFinite(v));
  if (vals.length < 2) return `<div class="m t2 sm">Collecting samples…</div>`;
  const lo = min ?? Math.min(...vals), hi = max ?? Math.max(...vals);
  const span = hi - lo || 1;
  const step = w / (vals.length - 1);
  const d = vals.map((v, i) => `${i ? "L" : "M"}${(i * step).toFixed(1)} ${(h - ((v - lo) / span) * (h - 6) - 3).toFixed(1)}`).join("");
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="trend">
    <path d="${d}" fill="none" stroke="${color}" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`;
}

export function donut(slices, { size = 150, thick = 22 } = {}) {
  const total = slices.reduce((a, s) => a + s.value, 0) || 1;
  const r = (size - thick) / 2, c = 2 * Math.PI * r;
  let off = 0;
  const arcs = slices.filter((s) => s.value > 0).map((s) => {
    const len = (s.value / total) * c;
    const arc = `<circle r="${r}" cx="${size / 2}" cy="${size / 2}" fill="none" stroke="${s.color}" stroke-width="${thick}"
      stroke-dasharray="${len} ${c - len}" stroke-dashoffset="${-off}" transform="rotate(-90 ${size / 2} ${size / 2})"><title>${esc(s.label)}: ${num(s.value)}</title></circle>`;
    off += len;
    return arc;
  }).join("");
  return `<svg class="donut" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="breakdown">
    <circle r="${r}" cx="${size / 2}" cy="${size / 2}" fill="none" stroke="var(--ln)" stroke-width="${thick}" opacity=".35"/>${arcs}
    <text x="50%" y="48%" text-anchor="middle" class="big2">${num(total)}</text><text x="50%" y="62%" text-anchor="middle" class="mt">sites</text></svg>`;
}

export function legendRows(slices) {
  const total = slices.reduce((a, s) => a + s.value, 0) || 1;
  return slices.map((s) => `<div class="lg"><i style="background:${s.color}"></i><span>${esc(s.label)}</span>
    <b class="m">${num(s.value)}</b><span class="t2 m">${((s.value / total) * 100).toFixed(0)}%</span></div>`).join("");
}

export function gaugeBar(value, spec, label) {
  const { lo, hi, warn, bad, lower_bad: lowerBad = false } = spec;
  const p = Math.max(0, Math.min(1, (value - lo) / (hi - lo || 1)));
  const isBad = lowerBad ? value <= bad : value >= bad;
  const isWarn = lowerBad ? value <= warn : value >= warn;
  const cls = isBad ? "crit" : isWarn ? "warn" : "ok";
  const mark = (v) => `<i class="tick" style="left:${(((v - lo) / (hi - lo || 1)) * 100).toFixed(1)}%"></i>`;
  return `<div class="gauge ${cls}"><div class="gh"><span>${esc(label)}</span><b class="m">${num(value, Math.abs(hi) < 10 ? 2 : 1)}</b></div>
    <div class="gt"><i style="width:${(p * 100).toFixed(1)}%"></i>${mark(warn)}${mark(bad)}</div></div>`;
}

export function sevChip(sev, color) {
  return `<span class="chip" style="--c:${esc(color ?? "#4B6192")}">${esc(sev)}</span>`;
}

export function fmtSince(tick, cfg, now) {
  const mins = Math.max(0, (now - tick) * (cfg?.tick_minutes ?? 5));
  if (mins < 60) return `${Math.round(mins)} min ago`;
  return `${(mins / 60).toFixed(1)} h ago`;
}
