import { afterEach, describe, expect, it, vi } from "vitest";
import { CrewMotion, type CrewRender } from "./crew-motion.js";

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
