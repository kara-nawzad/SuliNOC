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
});
