// Smooth crew motion. Depends only on ./crew-motion.config.js. Works in any
// plane: pass projected coordinates (for Leaflet use L.CRS.EPSG3857.project(latlng)
// and .unproject() on the way out).
import { CREW_MOTION } from "./crew-motion.config.js";

const lerpAngle = (a, b, t) => a + (((b - a + 540) % 360) - 180) * t;
const POSITION_EPSILON = 0.01;
const FRAME_EPSILON = 0.0001;

// Remaining projected route distance in EPSG:3857 metres -> visual speed
// factor, interpolated between the configured band edges (crew-motion.config.js).
// Backend ETAs and team positions remain authoritative; this affects
// presentation only.
const BANDS = CREW_MOTION.bands;

export function distanceSpeedMultiplier(remainingMeters) {
  const distance = Number.isFinite(remainingMeters)
    ? Math.max(0, remainingMeters)
    : 0;
  if (distance <= BANDS[0].upToMeters) return BANDS[0].speed;
  for (let i = 1; i < BANDS.length; i += 1) {
    if (distance <= BANDS[i].upToMeters) {
      const lower = BANDS[i - 1];
      const upper = BANDS[i];
      const fraction =
        (distance - lower.upToMeters) /
        (upper.upToMeters - lower.upToMeters || 1);
      return lower.speed + (upper.speed - lower.speed) * fraction;
    }
  }
  return BANDS[BANDS.length - 1].speed;
}

// Gentle ease-in at departure and ease-out at arrival. Raw trip progress
// t (0..1) maps to eased progress: cosine speed ramps over the first and last
// `ease.ramp` of the trip, linear in between, normalized to still cover the
// whole route. Endpoints and the exact midpoint are preserved.
export function easeRouteProgress(t) {
  const ramp = Math.min(0.5, Math.max(0, CREW_MOTION.ease.ramp));
  if (ramp <= 0 || t <= 0 || t >= 1) return t;
  const total = 1 - ramp;
  if (t < ramp) {
    const v = t / 2 - (ramp / (2 * Math.PI)) * Math.sin((Math.PI * t) / ramp);
    return v / total;
  }
  if (t > 1 - ramp) {
    const u = 1 - t;
    const v = u / 2 - (ramp / (2 * Math.PI)) * Math.sin((Math.PI * u) / ramp);
    return 1 - v / total;
  }
  return (ramp / 2 + (t - ramp)) / total;
}

function sameRoute(a, b) {
  return (
    a.length === b.length &&
    a.every(
      (point, index) => point[0] === b[index][0] && point[1] === b[index][1],
    )
  );
}

export class CrewMotion {
  constructor({ render, tau = 260, yUp = true } = {}) {
    this.render = render;
    this.tau = tau;
    this.yUp = yUp;
    this.paused = false;
    this.crews = new Map();
    this.active = new Set();
    this.dirty = new Set();
    this.reduce =
      typeof matchMedia === "function" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches;
    this._raf = 0;
    this._last = 0;
    this._loop = (now) => {
      this._raf = 0;
      if (this.paused) return;
      this.step(now);
      if (this.active.size) this._raf = requestAnimationFrame(this._loop);
    };
  }

  // Call on every backend update. route: [[x,y],...], progress: 0..1 along
  // the route. moving is false when the crew is parked or repairing.
  set(id, { route, progress, moving = true }, now = performance.now()) {
    let crew = this.crews.get(id);
    if (!crew || !sameRoute(crew.route, route)) {
      const cumulative = [0];
      for (let i = 1; i < route.length; i++)
        cumulative[i] =
          cumulative[i - 1] +
          Math.hypot(
            route[i][0] - route[i - 1][0],
            route[i][1] - route[i - 1][1],
          );
      crew = {
        route,
        cumulative,
        length: cumulative.at(-1) || 1,
        s: 0,
        target: 0,
        updatedAt: now,
        velocity: 0,
        updateGap: 1000,
        heading: 0,
        flip: false,
        first: true,
        moving,
        rendered: null,
      };
      this.crews.set(id, crew);
    }

    const target = Math.min(1, Math.max(0, progress)) * crew.length;
    if (crew.first) {
      crew.s = target;
      crew.first = false;
    } else {
      const dt = (now - crew.updatedAt) / 1000;
      if (dt > 0.05) {
        crew.updateGap = dt * 1000;
        const observedVelocity = Math.max(0, (target - crew.target) / dt);
        const speedMultiplier = distanceSpeedMultiplier(crew.length - target);
        crew.velocity = moving
          ? 0.5 * crew.velocity + 0.5 * observedVelocity * speedMultiplier
          : 0;
      }
    }
    if (!moving) crew.velocity = 0;
    crew.target = target;
    crew.updatedAt = now;
    crew.moving = moving;

    this.dirty.add(id);
    this._refreshActivity(id, crew, now);
    if (!this.paused && !this.active.has(id)) this._flushDirty(id, now);
    this.start();
  }

  remove(id) {
    this.crews.delete(id);
    this.active.delete(id);
    this.dirty.delete(id);
    if (!this.active.size) this._stop();
  }

  setPaused(paused) {
    const next = !!paused;
    if (this.paused === next) return;
    this.paused = next;
    if (next) {
      this._stop();
      const now = performance.now();
      for (const id of this.active) {
        const crew = this.crews.get(id);
        if (crew) this._renderIfChanged(id, crew, now);
      }
      return;
    }
    const now = performance.now();
    for (const [id, crew] of this.crews) {
      this._refreshActivity(id, crew, now);
      if (!this.active.has(id)) this._flushDirty(id, now);
    }
    this.start();
  }

  start() {
    if (this.paused || !this.active.size || this._raf) return;
    this._last = 0;
    this._raf = requestAnimationFrame(this._loop);
  }

  _stop() {
    if (!this._raf) return;
    if (typeof cancelAnimationFrame === "function")
      cancelAnimationFrame(this._raf);
    this._raf = 0;
  }

  _targetAt(crew, now) {
    const ahead =
      this.paused || !crew.moving
        ? 0
        : Math.max(0, Math.min(now - crew.updatedAt, crew.updateGap * 1.5)) /
          1000;
    return Math.min(crew.length, crew.target + crew.velocity * ahead);
  }

  _needsAnimation(crew, now) {
    return Math.abs(this._targetAt(crew, now) - crew.s) > POSITION_EPSILON;
  }

  _refreshActivity(id, crew, now) {
    if (this._needsAnimation(crew, now)) this.active.add(id);
    else this.active.delete(id);
  }

  _frame(crew, now, smoothing) {
    // The drawn position follows the eased progress, so every trip starts
    // gently, cruises, then decelerates into its arrival. Heading samples
    // stay on the raw progress: they read the local route direction.
    const point = this.at(
      crew,
      easeRouteProgress(crew.s / crew.length) * crew.length,
    );
    const forward = this.at(
      crew,
      Math.min(crew.length, crew.s + crew.length * 0.01),
    );
    const backward = this.at(crew, Math.max(0, crew.s - crew.length * 0.01));
    const dx = forward[0] - backward[0];
    const dy = (forward[1] - backward[1]) * (this.yUp ? -1 : 1);
    if (Math.hypot(dx, dy) > 1e-9) {
      crew.heading = lerpAngle(
        crew.heading,
        (Math.atan2(dy, dx) * 180) / Math.PI,
        Math.max(smoothing, 0.08),
      );
    }
    const cosine = Math.cos((crew.heading * Math.PI) / 180);
    if (cosine < -0.2) crew.flip = true;
    else if (cosine > 0.2) crew.flip = false;
    const target = this._targetAt(crew, now);
    return {
      x: point[0],
      y: point[1],
      heading: crew.heading,
      flip: crew.flip,
      moving: !this.paused && Math.abs(target - crew.s) > crew.length * 0.0005,
      progress: crew.s / crew.length,
    };
  }

  _renderIfChanged(
    id,
    crew,
    now,
    smoothing = this.reduce ? 1 : 1 - Math.exp((-16 * 1000) / this.tau),
  ) {
    const frame = this._frame(crew, now, smoothing);
    const last = crew.rendered;
    if (
      !last ||
      Math.abs(frame.x - last.x) > FRAME_EPSILON ||
      Math.abs(frame.y - last.y) > FRAME_EPSILON ||
      Math.abs(frame.heading - last.heading) > FRAME_EPSILON ||
      Math.abs(frame.progress - last.progress) > FRAME_EPSILON ||
      frame.flip !== last.flip ||
      frame.moving !== last.moving
    ) {
      this.render(id, frame);
      crew.rendered = frame;
    }
    this.dirty.delete(id);
  }

  _flushDirty(id, now) {
    const crew = this.crews.get(id);
    if (!crew || !this.dirty.has(id)) return;
    this._renderIfChanged(id, crew, now);
  }

  at(crew, distance) {
    if (crew.route.length === 1) return crew.route[0];
    let i = 1;
    while (i < crew.cumulative.length - 1 && crew.cumulative[i] < distance) i++;
    const a = crew.route[i - 1];
    const b = crew.route[i];
    const segment = crew.cumulative[i] - crew.cumulative[i - 1] || 1;
    const t = Math.min(
      1,
      Math.max(0, (distance - crew.cumulative[i - 1]) / segment),
    );
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  }

  step(now) {
    if (this.paused) return;
    const dt = this._last ? Math.min(0.1, (now - this._last) / 1000) : 0.016;
    this._last = now;
    const smoothing = this.reduce ? 1 : 1 - Math.exp((-dt * 1000) / this.tau);

    for (const id of [...this.active]) {
      const crew = this.crews.get(id);
      if (!crew) {
        this.active.delete(id);
        continue;
      }
      const target = this._targetAt(crew, now);
      crew.s += (target - crew.s) * smoothing;
      if (Math.abs(target - crew.s) <= POSITION_EPSILON) crew.s = target;
      this._renderIfChanged(id, crew, now, smoothing);
      this._refreshActivity(id, crew, now);
    }

    for (const id of this.dirty) {
      if (!this.active.has(id)) this._flushDirty(id, now);
    }
  }
}
