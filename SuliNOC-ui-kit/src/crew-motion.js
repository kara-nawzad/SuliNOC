// Smooth crew motion. No dependencies. Works in any plane: pass projected coordinates
// (for Leaflet use L.CRS.EPSG3857.project(latlng) and .unproject() on the way out).
const lerpAngle = (a, b, t) => a + ((((b - a + 540) % 360) - 180) * t);
export class CrewMotion {
  constructor({ render, tau = 260, yUp = true } = {}) {
    this.render = render; this.tau = tau; this.yUp = yUp; this.paused = false; this.crews = new Map();
    this.reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    this._raf = 0; this._last = 0; this._loop = (n) => { this.step(n); this._raf = this.crews.size ? requestAnimationFrame(this._loop) : 0; };
  }
  // Call on EVERY backend update. route: [[x,y],...]. progress: 0..1 along the route. moving: false when parked/repairing.
  set(id, { route, progress, moving = true }, now = performance.now()) {
    let c = this.crews.get(id);
    const same = c && c.route.length === route.length && c.route[0][0] === route[0][0] && c.route.at(-1)[1] === route.at(-1)[1];
    if (!c || !same) {
      const cum = [0]; for (let i = 1; i < route.length; i++) cum[i] = cum[i - 1] + Math.hypot(route[i][0] - route[i - 1][0], route[i][1] - route[i - 1][1]);
      c = { route, cum, L: cum.at(-1) || 1, s: 0, sT: 0, tU: now, v: 0, gap: 1000, heading: 0, flip: false, first: true }; this.crews.set(id, c);
    }
    const sT = Math.min(1, Math.max(0, progress)) * c.L;
    if (c.first) { c.s = sT; c.first = false; }
    else { const dt = (now - c.tU) / 1000; if (dt > 0.05) { c.gap = dt * 1000; c.v = moving ? 0.5 * c.v + 0.5 * Math.max(0, (sT - c.sT) / dt) : 0; } }
    if (!moving) c.v = 0;
    c.sT = sT; c.tU = now; c.moving = moving; this.start();
  }
  remove(id) { this.crews.delete(id); }
  setPaused(p) { this.paused = p; }
  start() { if (!this._raf) { this._last = 0; this._raf = requestAnimationFrame(this._loop); } }
  at(c, s) { // point on the route at distance s
    let i = 1; while (i < c.cum.length - 1 && c.cum[i] < s) i++;
    const a = c.route[i - 1], b = c.route[i], seg = (c.cum[i] - c.cum[i - 1]) || 1, t = Math.min(1, Math.max(0, (s - c.cum[i - 1]) / seg));
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  }
  step(now) {
    const dt = this._last ? Math.min(0.1, (now - this._last) / 1000) : 0.016; this._last = now;
    const k = this.reduce ? 1 : 1 - Math.exp(-dt * 1000 / this.tau);
    for (const [id, c] of this.crews) {
      const ahead = this.paused || !c.moving ? 0 : Math.min((now - c.tU), c.gap * 1.5) / 1000;
      const pred = Math.min(c.L, c.sT + c.v * ahead);
      c.s += (pred - c.s) * k;
      const p = this.at(c, c.s), q = this.at(c, Math.min(c.L, c.s + c.L * 0.01)), r = this.at(c, Math.max(0, c.s - c.L * 0.01));
      const dx = q[0] - r[0], dy = (q[1] - r[1]) * (this.yUp ? -1 : 1);
      if (Math.hypot(dx, dy) > 1e-9) c.heading = lerpAngle(c.heading, Math.atan2(dy, dx) * 180 / Math.PI, Math.max(k, 0.08));
      const cos = Math.cos(c.heading * Math.PI / 180); if (cos < -0.2) c.flip = true; else if (cos > 0.2) c.flip = false;
      this.render(id, { x: p[0], y: p[1], heading: c.heading, flip: c.flip, moving: c.moving && Math.abs(pred - c.s) > c.L * 0.0005, progress: c.s / c.L });
    }
  }
}
