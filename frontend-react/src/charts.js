// Small SVG line chart with readable typography. No dependencies.
export function niceTicks(min, max, n = 4) {
  const span = max - min || 1, raw = span / n, p = 10 ** Math.floor(Math.log10(raw)), f = raw / p;
  const step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p, lo = Math.floor(min / step) * step, out = [];
  for (let v = lo; v <= max + step * 0.001; v += step) out.push(+v.toFixed(6)); return out;
}
export const hhmm = (m) => String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(Math.floor(m % 60)).padStart(2, '0');
export function xLabel(m, spanMin) { return spanMin > 1440 ? (m % 1440 < spanMin / 12 ? 'D' + (Math.floor(m / 1440) + 1) : '') : hhmm(m); }
export function lineChart(host, { color = '#0C9C83', unit = '', decimals = 1, zero = false, onNote = () => {} } = {}) {
  // The drawing width follows the host's real width, so axis text keeps its CSS size
  // (12 px) instead of being scaled down with a fixed 640-unit viewBox.
  let W = 640; const H = 220, L = 46, R = 12, T = 14, B = 28; let pts = [];
  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img"><g class="g"></g><path class="ln" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/><circle class="dot" r="3.5" fill="${color}" stroke="#fff" stroke-width="1.5"/><line class="cr" y1="${T}" y2="${H - B}"/></svg><div class="ch-tip" hidden></div>`;
  const svg = host.querySelector('svg'), g = svg.querySelector('.g'), ln = svg.querySelector('.ln'), dot = svg.querySelector('.dot'), cr = svg.querySelector('.cr'), tip = host.querySelector('.ch-tip');
  let sx, sy, raf = 0, dom = null;
  const fit = () => { const w = Math.round(host.clientWidth); if (w >= 200 && w !== W) { W = w; svg.setAttribute('viewBox', `0 0 ${W} ${H}`); } };
  const draw = () => { raf = 0; fit(); if (!pts.length) return;
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]); let lo = zero ? 0 : Math.min(...ys), hi = Math.max(...ys);
    if (dom) { lo = dom[0]; hi = dom[1]; } else { if (hi === lo) { hi += 1; lo -= 1; } const pad = (hi - lo) * 0.08; if (!zero) lo -= pad; hi += pad; }
    const fixed = (v) => (dom ? String(+v.toFixed(decimals)) : v.toFixed(decimals));
    const ticks = niceTicks(lo, hi), y0 = Math.min(ticks[0], lo), y1 = Math.max(ticks.at(-1), hi), x0 = xs[0], x1 = xs.at(-1), span = x1 - x0 || 1;
    sx = (x) => L + ((x - x0) / span) * (W - L - R); sy = (v) => T + (1 - (v - y0) / (y1 - y0 || 1)) * (H - T - B);
    let s = ''; for (const v of ticks) s += `<line class="gl" x1="${L}" x2="${W - R}" y1="${sy(v)}" y2="${sy(v)}"/><text class="ay" x="${L - 8}" y="${sy(v) + 4}" text-anchor="end">${fixed(v)}</text>`;
    if (span > 1440) { // long windows: one label at every midnight, e.g. 00:00 D2
      for (let m = Math.ceil(x0 / 1440) * 1440; m <= x1; m += 1440) s += `<text class="ax" x="${sx(m)}" y="${H - 8}" text-anchor="middle">00:00 D${Math.floor(m / 1440) + 1}</text>`;
    } else {
      for (let i = 0; i < 5; i++) { const x = x0 + (span * i) / 4, lab = xLabel(x, span); if (lab) s += `<text class="ax" x="${sx(x)}" y="${H - 8}" text-anchor="${i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}">${lab}</text>`; }
    }
    g.innerHTML = s; ln.setAttribute('d', pts.map((p, i) => (i ? 'L' : 'M') + sx(p[0]).toFixed(1) + ' ' + sy(p[1]).toFixed(1)).join(''));
    dot.setAttribute('cx', sx(x1)); dot.setAttribute('cy', sy(pts.at(-1)[1]));
    onNote(!dom && !zero && y0 > 0 ? `Axis starts at ${y0.toFixed(decimals)}${unit}, not zero.` : ''); };
  svg.addEventListener('pointermove', (e) => { if (!pts.length) return; const r = svg.getBoundingClientRect(), x = ((e.clientX - r.left) / r.width) * W;
    let best = pts[0]; for (const p of pts) if (Math.abs(sx(p[0]) - x) < Math.abs(sx(best[0]) - x)) best = p;
    cr.setAttribute('x1', sx(best[0])); cr.setAttribute('x2', sx(best[0])); cr.style.opacity = 1; tip.hidden = false;
    tip.textContent = `${hhmm(best[0])}  ${best[1].toFixed(decimals)} ${unit}`; tip.style.left = Math.min(r.width - 120, (sx(best[0]) / W) * r.width + 8) + 'px'; });
  svg.addEventListener('pointerleave', () => { cr.style.opacity = 0; tip.hidden = true; });
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { if (pts.length && !raf) raf = requestAnimationFrame(draw); }) : null;
  ro?.observe(host);
  return {
    setData(next) { pts = next; if (!raf) raf = requestAnimationFrame(draw); },
    /** Fix the y-axis to [min, max]; pass null to return to automatic. */
    setDomain(min, max) { dom = min == null ? null : [min, max]; if (!raf) raf = requestAnimationFrame(draw); },
    append(p) { pts.push(p); if (!raf) raf = requestAnimationFrame(draw); },
    destroy() { ro?.disconnect(); },
  };
}
