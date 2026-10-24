import { describe, expect, it } from "vitest";
import { CREW_MOTION } from "../crew-motion.config.js";
import {
  repairRingDasharray,
  updateRepairTrack,
  type RepairTrack,
} from "./CrewLayer";

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
