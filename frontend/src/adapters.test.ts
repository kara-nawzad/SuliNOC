import { describe, expect, it } from "vitest";
import {
  CrewTrips,
  historyPoints,
  simTimeToMinutes,
  towerClass,
  type TeamLike,
} from "./adapters.js";
import { hhmm, niceTicks, xLabel } from "./charts.js";

describe("backend adapters", () => {
  it("converts simulation times and rejects malformed values", () => {
    expect(simTimeToMinutes("D1 00:00")).toBe(0);
    expect(simTimeToMinutes("D3 11:00")).toBe(2 * 1440 + 660);
    expect(simTimeToMinutes("bad")).toBeNull();
  });

  it("maps tower status and selection to the intended visual flags", () => {
    const config = { presentation: { offline_statuses: [4, 5] } };
    expect(
      towerClass(
        { id: "priority", status: 0, warn: false, critical: true },
        config,
        null,
      ).halo,
    ).toBe(false);
    expect(
      towerClass({ id: "selected", status: 0 }, config, "selected").halo,
    ).toBe(true);
    expect(towerClass({ id: "offline", status: 4 }, config, null).cls).toBe(
      "crit",
    );
    expect(towerClass({ id: "warning", status: 2 }, config, null).cls).toBe(
      "warn",
    );
  });

  it("keeps crew routes fixed and derives progress from server ETA", () => {
    const trips = new CrewTrips((lat, lon) => [lon * 100, lat * 100]);
    const idle: TeamLike = {
      id: 1,
      lat: 35.55,
      lon: 45.42,
      state: "IDLE",
      target_lat: null,
      target_lon: null,
      eta: 0,
    };
    expect(trips.update(idle).moving).toBe(false);

    const enRoute: TeamLike = {
      ...idle,
      state: "EN_ROUTE",
      target_lat: 35.56,
      target_lon: 45.44,
      eta: 4,
    };
    const start = trips.update(enRoute);
    expect(start.progress).toBe(0);
    expect(start.moving).toBe(true);

    const halfway = trips.update({
      ...enRoute,
      lat: 35.555,
      lon: 45.43,
      eta: 2,
    });
    expect(halfway.progress).toBeCloseTo(0.5);
    expect(halfway.route).toBe(start.route);
    expect(
      trips.update({ ...enRoute, eta: 0, state: "REPAIRING" }).moving,
    ).toBe(false);
  });

  it("creates chart points from the backend's real history fields", () => {
    const history = [
      { tick: 0, sim_time: "D1 00:00", throughput_gbps: 45.0 },
      { tick: 1, sim_time: "D1 00:05", throughput_gbps: 45.2 },
      { tick: 2, sim_time: "D1 04:45", throughput_gbps: 44.9 },
    ];
    expect(historyPoints(history, "throughput_gbps")).toHaveLength(3);
    expect(xLabel(285, 1440)).toBe("04:45");
    expect(xLabel(1440 * 3 + 5, 10080)).toBe("D4");
    expect(niceTicks(96.4, 100)).toEqual([96, 97, 98, 99, 100]);
    expect(hhmm(0)).toBe("00:00");
  });
});
