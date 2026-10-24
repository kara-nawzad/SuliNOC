import { afterEach, describe, expect, it, vi } from "vitest";
import { CrewMotion, type CrewRender } from "./crew-motion.js";
import { distanceSpeedMultiplier, easeRouteProgress } from "./crew-motion.js";
import { CREW_MOTION } from "./crew-motion.config.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("production crew motion", () => {
  it("smoothly follows confirmed route progress without large frame jumps", () => {
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 1),
    );

    const frames: CrewRender[] = [];
    const motion = new CrewMotion({
      render: (_id, frame) => frames.push(frame),
    });
    const route: [number, number][] = [
      [0, 0],
      [100, 0],
      [100, 100],
    ];
    let now = 0;
    let previous: CrewRender | undefined;
    let maxJump = 0;

    for (let tick = 0; tick <= 10; tick += 1) {
      now = tick * 1000;
      motion.set(1, { route, progress: tick / 10 }, now);
      for (let frame = 0; frame < 60; frame += 1) {
        motion.step(now + frame * 16.7);
        const current = frames.at(-1);
        expect(current).toBeDefined();
        if (previous && current) {
          maxJump = Math.max(
            maxJump,
            Math.hypot(current.x - previous.x, current.y - previous.y),
          );
        }
        previous = current;
      }
    }

    const last = frames.at(-1);
    expect(maxJump).toBeLessThanOrEqual(3);
    expect(last?.progress).toBeGreaterThanOrEqual(0.85);
    expect(last?.x).toBeCloseTo(100, 0);
    expect(last?.y).toBeCloseTo(100, 0);
  });

  it("gently speeds up farther dispatches and avoids tier-boundary jumps", () => {
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 1),
    );

    const progressAfter = (routeLength: number) => {
      const frames: CrewRender[] = [];
      const motion = new CrewMotion({
        render: (_id, frame) => frames.push(frame),
      });
      const route: [number, number][] = [
        [0, 0],
        [routeLength, 0],
      ];
      motion.set(1, { route, progress: 0, moving: true }, 0);
      motion.set(1, { route, progress: 0.1, moving: true }, 1000);
      for (let now = 1016; now <= 1500; now += 16) motion.step(now);
      return frames.at(-1)!.progress;
    };

    const nearby = progressAfter(1500);
    const midrange = progressAfter(6000);
    const distant = progressAfter(15000);
    expect(midrange).toBeGreaterThan(nearby);
    expect(distant).toBeGreaterThan(midrange);
    expect(distant).toBeLessThan(1);
    expect(Math.abs(progressAfter(5999) - progressAfter(6001))).toBeLessThan(
      0.002,
    );
  });

  it("renders a settled parked crew once without keeping a frame loop alive", () => {
    const requestFrame = vi.fn(() => 1);
    const render = vi.fn();
    vi.stubGlobal("requestAnimationFrame", requestFrame);
    const motion = new CrewMotion({ render });

    motion.set(
      1,
      {
        route: [
          [0, 0],
          [10, 0],
        ],
        progress: 0.5,
        moving: false,
      },
      0,
    );
    motion.step(16);
    motion.step(32);

    expect(render).toHaveBeenCalledOnce();
    expect(requestFrame).not.toHaveBeenCalled();
  });

  it("stops requesting frames after a parked crew settles at its new position", () => {
    const pending: FrameRequestCallback[] = [];
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      pending.push(callback);
      return pending.length;
    });
    vi.stubGlobal("requestAnimationFrame", requestFrame);
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const frames: CrewRender[] = [];
    const motion = new CrewMotion({
      render: (_id, frame) => frames.push(frame),
    });

    motion.set(
      1,
      {
        route: [
          [0, 0],
          [10, 0],
        ],
        progress: 0,
        moving: false,
      },
      0,
    );
    motion.set(
      1,
      {
        route: [
          [0, 0],
          [10, 0],
        ],
        progress: 1,
        moving: false,
      },
      1000,
    );

    let count = 0;
    while (pending.length && count < 200) {
      const callback = pending.shift()!;
      callback(1016 + count * 16);
      count += 1;
    }

    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(200);
    expect(pending).toHaveLength(0);
    expect(frames.at(-1)?.x).toBeCloseTo(10, 2);
  });

  it("cancels the active frame while paused and resumes motion cleanly", () => {
    const requestFrame = vi.fn(() => 1);
    const cancelFrame = vi.fn();
    vi.stubGlobal("requestAnimationFrame", requestFrame);
    vi.stubGlobal("cancelAnimationFrame", cancelFrame);
    const frames: CrewRender[] = [];
    const motion = new CrewMotion({
      render: (_id, frame) => frames.push(frame),
    });
    const route: [number, number][] = [
      [0, 0],
      [10, 0],
    ];

    motion.set(1, { route, progress: 0, moving: false }, 0);
    motion.set(1, { route, progress: 1, moving: false }, 1000);
    motion.step(1016);
    expect(frames.at(-1)?.moving).toBe(true);

    motion.setPaused(true);
    expect(cancelFrame).toHaveBeenCalledOnce();
    expect(frames.at(-1)?.moving).toBe(false);
    motion.setPaused(false);
    expect(requestFrame).toHaveBeenCalledTimes(2);
  });
});

describe("distance speed bands", () => {
  it("maps band edges to their configured speeds", () => {
    expect(distanceSpeedMultiplier(0)).toBe(1);
    expect(distanceSpeedMultiplier(1500)).toBe(1);
    expect(distanceSpeedMultiplier(3000)).toBeCloseTo(1.1, 5);
    expect(distanceSpeedMultiplier(4500)).toBeCloseTo(1.2, 5);
    expect(distanceSpeedMultiplier(9000)).toBeCloseTo(1.45, 5);
    expect(distanceSpeedMultiplier(15000)).toBeCloseTo(1.6, 5);
    expect(distanceSpeedMultiplier(25000)).toBeCloseTo(1.6, 5);
  });

  it("changes speed smoothly across band edges", () => {
    for (const edge of [1500, 4500, 9000, 15000]) {
      const below = distanceSpeedMultiplier(edge - 1);
      const at = distanceSpeedMultiplier(edge);
      const above = distanceSpeedMultiplier(edge + 1);
      expect(Math.abs(at - below)).toBeLessThan(0.001);
      expect(Math.abs(above - at)).toBeLessThan(0.001);
    }
  });

  it("never slows down as trips get longer", () => {
    let previous = -Infinity;
    for (let distance = 0; distance <= 30000; distance += 50) {
      const speed = distanceSpeedMultiplier(distance);
      expect(speed).toBeGreaterThanOrEqual(previous);
      previous = speed;
    }
  });
});

describe("route progress easing", () => {
  it("keeps the endpoints and midpoint exact", () => {
    expect(easeRouteProgress(0)).toBe(0);
    expect(easeRouteProgress(1)).toBe(1);
    expect(easeRouteProgress(0.5)).toBe(0.5);
  });

  it("departs gently and creeps into arrival", () => {
    const { ramp } = CREW_MOTION.ease;
    expect(easeRouteProgress(ramp / 2)).toBeLessThan(ramp / 2);
    expect(easeRouteProgress(0.06)).toBeLessThan(0.06);
    expect(easeRouteProgress(0.94)).toBeGreaterThan(0.94);
    expect(1 - easeRouteProgress(0.99)).toBeLessThan(0.001);
  });

  it("moves monotonically forward across the whole trip", () => {
    let previous = 0;
    for (let step = 0; step <= 2000; step += 1) {
      const eased = easeRouteProgress(step / 2000);
      expect(eased).toBeGreaterThanOrEqual(previous - 1e-12);
      previous = eased;
    }
  });

  it("draws the eased position while reporting raw progress", () => {
    const requestFrame = vi.fn(() => 1);
    vi.stubGlobal("requestAnimationFrame", requestFrame);
    const frames: CrewRender[] = [];
    const motion = new CrewMotion({
      render: (_id, frame) => frames.push(frame),
    });
    const route: [number, number][] = [
      [0, 0],
      [10, 0],
    ];

    // Early in the trip the truck is drawn behind its linear position.
    motion.set(1, { route, progress: 0.06, moving: false }, 0);
    motion.step(16);
    expect(frames.at(-1)?.x).toBeLessThan(0.6);
    expect(frames.at(-1)?.x).toBeGreaterThan(0);
    expect(frames.at(-1)?.progress).toBeCloseTo(0.06, 5);

    // Midpoint of the route is still the midpoint after easing.
    motion.set(1, { route, progress: 0.5, moving: false }, 1000);
    for (let i = 0; i < 60; i += 1) motion.step(1016 + i * 100);
    expect(frames.at(-1)?.x).toBeCloseTo(5, 1);
    expect(frames.at(-1)?.progress).toBeCloseTo(0.5, 5);
  });
});
