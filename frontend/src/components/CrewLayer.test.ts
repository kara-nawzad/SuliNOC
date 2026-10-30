import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CREW_MOTION } from "../crew-motion.config.js";
import {
  crewDivIcon,
  crewMarkerElement,
  repairRingDasharray,
  updateRepairTrack,
  type RepairTrack,
} from "./CrewLayer";

const styles = readFileSync("src/styles/app.css", "utf8");

type CrewLike = Parameters<typeof updateRepairTrack>[1];

const crew = (overrides: Partial<CrewLike> = {}): CrewLike => ({
  id: 1,
  state: "REPAIRING",
  target: "N-012",
  eta: 12,
  ...overrides,
});

describe("repair progress tracking", () => {
  it("ignores crews that are not repairing and clears their record", () => {
    const tracks = new Map<number, RepairTrack>();
    expect(updateRepairTrack(tracks, crew({ state: "EN_ROUTE" }))).toBe(0);
    expect(tracks.size).toBe(0);

    updateRepairTrack(tracks, crew());
    expect(tracks.size).toBe(1);
    expect(
      updateRepairTrack(tracks, crew({ state: "RETURNING", eta: 0 })),
    ).toBe(0);
    expect(tracks.size).toBe(0);
  });

  it("captures the first repairing ETA as the mission total", () => {
    const tracks = new Map<number, RepairTrack>();
    expect(updateRepairTrack(tracks, crew({ eta: 24 }))).toBe(0);
    expect(tracks.get(1)).toEqual({ target: "N-012", startEta: 24 });
  });

  it("reports progress as the ETA counts down", () => {
    const tracks = new Map<number, RepairTrack>();
    updateRepairTrack(tracks, crew({ eta: 12 }));
    expect(updateRepairTrack(tracks, crew({ eta: 6 }))).toBeCloseTo(0.5, 5);
    expect(updateRepairTrack(tracks, crew({ eta: 1 }))).toBeCloseTo(11 / 12, 5);
    expect(updateRepairTrack(tracks, crew({ eta: 0 }))).toBe(1);
  });

  it("clamps a glitched ETA above the recorded total", () => {
    const tracks = new Map<number, RepairTrack>();
    updateRepairTrack(tracks, crew({ eta: 4 }));
    expect(updateRepairTrack(tracks, crew({ eta: 9 }))).toBe(0);
  });

  it("re-records when the crew starts repairing a different site", () => {
    const tracks = new Map<number, RepairTrack>();
    updateRepairTrack(tracks, crew({ eta: 24, target: "N-001" }));
    expect(updateRepairTrack(tracks, crew({ eta: 8, target: "N-002" }))).toBe(
      0,
    );
    expect(tracks.get(1)).toEqual({ target: "N-002", startEta: 8 });
  });

  it("treats a first sight of ETA 0 as a one-tick mission", () => {
    const tracks = new Map<number, RepairTrack>();
    expect(updateRepairTrack(tracks, crew({ eta: 0 }))).toBe(1);
  });

  it("tracks crews independently", () => {
    const tracks = new Map<number, RepairTrack>();
    updateRepairTrack(tracks, crew({ id: 1, eta: 10 }));
    updateRepairTrack(tracks, crew({ id: 2, eta: 4 }));
    expect(updateRepairTrack(tracks, crew({ id: 1, eta: 5 }))).toBeCloseTo(
      0.5,
      5,
    );
    expect(updateRepairTrack(tracks, crew({ id: 2, eta: 1 }))).toBeCloseTo(
      0.75,
      5,
    );
  });
});

describe("repair ring dash pattern", () => {
  const { segments, radiusPx } = CREW_MOTION.repairRing;
  const circumference = 2 * Math.PI * radiusPx;
  // Each pattern is k dash/gap pairs followed by a 0-dash and a
  // full-circumference gap, so k notches are lit and nothing else.
  const values = (lit: number) =>
    repairRingDasharray(lit).trim().split(/\s+/).map(Number);
  const litCount = (lit: number) => values(lit).length / 2 - 1;
  const body = (lit: number) => values(lit).slice(0, -2).join(" ");

  it("lights nothing at zero progress", () => {
    const pattern = values(0);
    expect(pattern).toHaveLength(2);
    expect(pattern[0]).toBe(0);
  });

  it("lights one notch per segment at full progress", () => {
    expect(litCount(segments)).toBe(segments);
    expect(litCount(segments + 5)).toBe(segments);
  });

  it("grows by exactly one notch per step", () => {
    for (let lit = 0; lit < segments; lit += 1) {
      expect(litCount(lit)).toBe(lit);
      expect(body(lit + 1).startsWith(body(lit))).toBe(true);
    }
  });

  it("rounds fractional progress to whole notches", () => {
    expect(litCount(3.4)).toBe(3);
    expect(litCount(3.6)).toBe(4);
  });

  it("never repeats around the circle and stays positive", () => {
    for (let lit = 0; lit <= segments; lit += 1) {
      const pattern = values(lit);
      expect(pattern.every((v) => v >= 0)).toBe(true);
      expect(pattern.reduce((a, b) => a + b, 0)).toBeGreaterThan(circumference);
    }
  });
});

const RING = CREW_MOTION.repairRing;

/** One CSS rule block, without its neighbours. */
const ruleOf = (selector: string): string => {
  const start = styles.indexOf(`${selector} {`);
  expect(start).toBeGreaterThan(-1);
  return styles.slice(start, styles.indexOf("}", start));
};

/** The truck glyph's ink box, stroke included: the paths span x 3..21, y 6..17
 * with a 1.7 stroke, and the wheels hang down to y = 20. */
const TRUCK_INK = { x0: 2.15, x1: 21.85, y0: 5.15, y1: 20.0 };

const viewBox = (svg: Element): number[] =>
  (svg.getAttribute("viewBox") ?? "").split(/[\s,]+/).map(Number);

describe("crew marker geometry", () => {
  it("anchors the icon on its centre, not on a corner", () => {
    const icon = crewDivIcon("#0f8a8a");
    const size = icon.options.iconSize as [number, number];
    expect(size).toEqual([
      CREW_MOTION.marker.sizePx,
      CREW_MOTION.marker.sizePx,
    ]);
    expect(icon.options.iconAnchor).toEqual([size[0] / 2, size[1] / 2]);
    // A half-pixel anchor would blur the circle and push it off the crew.
    expect(CREW_MOTION.marker.sizePx % 2).toBe(0);
  });

  it("lets the tile fill the icon box instead of restating a pixel size", () => {
    const tile = ruleOf(".crew-marker");
    expect(tile).toContain("width: 100%");
    expect(tile).toContain("height: 100%");
    expect(tile).not.toMatch(/width:\s*\d+px/);
    expect(tile).not.toMatch(/height:\s*\d+px/);
    // The skin must not pin the tile back to a hard-coded size either.
    const skin = ruleOf(".app-shell .crew-marker");
    expect(skin).not.toMatch(/(width|height):\s*\d+px/);
  });

  it("centres the truck glyph inside its own viewBox", () => {
    const truck = crewMarkerElement("#0f8a8a").querySelector("svg")!;
    const [x, y, w, h] = viewBox(truck);
    const inkX = (TRUCK_INK.x0 + TRUCK_INK.x1) / 2;
    const inkY = (TRUCK_INK.y0 + TRUCK_INK.y1) / 2;
    expect(Math.abs(x + w / 2 - inkX)).toBeLessThan(0.2);
    expect(Math.abs(y + h / 2 - inkY)).toBeLessThan(0.2);
  });

  it("sizes the repair ring from the config and draws it about its centre", () => {
    const tile = crewMarkerElement("#0f8a8a");
    const ring = tile.querySelector(".crew-repair-ring")!;
    expect(tile.style.getPropertyValue("--crew-ring-size")).toBe(
      `${RING.sizePx}px`,
    );
    expect(viewBox(ring)).toEqual([0, 0, RING.sizePx, RING.sizePx]);
    const circle = ring.querySelector("circle")!;
    expect(Number(circle.getAttribute("cx"))).toBe(RING.sizePx / 2);
    expect(Number(circle.getAttribute("cy"))).toBe(RING.sizePx / 2);
    // The stroke stays inside the ring's own box, so nothing is clipped.
    expect(RING.radiusPx + RING.strokePx / 2).toBeLessThanOrEqual(
      RING.sizePx / 2,
    );
    // ...and the ring floats clear of the tile instead of sitting under it.
    expect(RING.sizePx).toBeGreaterThan(CREW_MOTION.marker.sizePx);
  });

  it("keeps the ring concentric with the tile by CSS, not by offsets", () => {
    const rule = ruleOf(".crew-marker > .crew-repair-ring");
    expect(rule).toContain("top: 50%");
    expect(rule).toContain("left: 50%");
    expect(rule).toContain("translate(-50%, -50%)");
    expect(rule).toContain("var(--crew-ring-size");
    expect(rule).not.toMatch(/top:\s*-\d/);
    expect(rule).not.toMatch(/left:\s*-\d/);
    const skin = ruleOf(".app-shell .crew-marker > .crew-repair-ring");
    expect(skin).toContain("var(--crew-ring-size");
    expect(skin).not.toMatch(/(top|left):\s*-?\d+px/);
  });
});
