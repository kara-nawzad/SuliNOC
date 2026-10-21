import { describe, expect, it } from "vitest";
import type { Config, Snapshot } from "../types/api";
import { answerWave } from "./waveAssistant";

function makeData(overrides: Record<string, unknown> = {}): Snapshot {
  return {
    run_id: "run-1",
    tick: 42,
    kpis: { sim_time: "D1 03:30", availability: 99.5 },
    nodes: [
      {
        id: "S001",
        agg: 1,
        status: 0,
        power: "Grid",
        ats: false,
        throughput: 4.2,
        prb: 45,
        loss: 0.2,
        battery: 93,
      },
    ],
    teams: [],
    ai: { ai_enabled: true, ai_mode: "ml", pending: [] },
    dashboard: {
      current: {
        online: 10,
        degraded: 1,
        offline: 0,
        throughput_gbps: 5.2,
        prb: 44,
        drop_rate: 0.2,
      },
      incidents: [],
      power: [{ name: "Grid", count: 10, fraction: 1 }],
      active_ats: 0,
      fuel_thefts: 0,
      fleet: {
        IDLE: 2,
        EN_ROUTE: 0,
        STANDBY: 0,
        REPAIRING: 0,
        RETURNING: 0,
      },
      actionable_predictions: 0,
      forecast: null,
    },
    ...overrides,
  } as unknown as Snapshot;
}

const config = {
  status_names: { 0: "Healthy", 1: "Offline" },
  presentation: { healthy_status: 0 },
  agg_sites: [{ id: 1, name: "Bakrajo" }],
} as unknown as Config;

describe("Wave's telemetry-grounded assistant", () => {
  it("summarizes the current backend snapshot rather than inventing metrics", () => {
    const result = answerWave("How is the network?", makeData(), config);

    expect(result.text).toContain("D1 03:30 · tick 42");
    expect(result.text).toContain("99.50%");
    expect(result.text).toContain("5.2 Gbps");
    expect(result.expression).toBe("excited");
  });

  it("answers a site and district query from matching live rows", () => {
    const data = makeData();
    const site = answerWave("What is S001 doing?", data, config);
    const district = answerWave("How is Bakrajo?", data, config);

    expect(site.text).toContain("S001 · Bakrajo: Healthy");
    expect(site.text).toContain("throughput 4.2 Gbps");
    expect(district.text).toContain("Bakrajo: 1 of 1 sites are healthy");
  });

  it("lists active incidents and marks serious network conditions as alert", () => {
    const data = makeData({
      dashboard: {
        ...makeData().dashboard,
        incidents: [
          {
            severity: "CRITICAL",
            node_id: "S001",
            title: "Power loss",
            affected: 1,
            since_tick: 41,
          },
        ],
      },
    });
    const result = answerWave("Show me the alarms", data, config);

    expect(result.text).toContain("CRITICAL · S001: Power loss");
    expect(result.expression).toBe("alert");
  });

  it("summarizes the live power mix and crew deployment counts", () => {
    const dashboard = makeData().dashboard;
    const data = makeData({
      dashboard: {
        ...dashboard,
        power: [
          { name: "Grid", count: 8, fraction: 0.8 },
          { name: "Battery", count: 2, fraction: 0.2 },
        ],
        active_ats: 1,
        fuel_thefts: 3,
        fleet: {
          IDLE: 1,
          EN_ROUTE: 1,
          STANDBY: 0,
          REPAIRING: 0,
          RETURNING: 0,
        },
      },
      teams: [{ target: "S001" }],
    });
    const power = answerWave("How is site power?", data, config);
    const fleet = answerWave("Are crews available?", data, config);

    expect(power.text).toContain("grid 8 · battery 2");
    expect(power.text).toContain("1 active ATS failure");
    expect(power.text).toContain("3 run-total fuel-theft events");
    expect(fleet.text).toContain("1 idle, 1 en route");
    expect(fleet.text).toContain("1 crew has an active target");
  });

  it("reports predictor availability honestly and offers supported topics", () => {
    const disabled = makeData({
      ai: { ai_enabled: false, ai_mode: "off", pending: [] },
    });
    const prediction = answerWave(
      "What is the risk forecast?",
      disabled,
      config,
    );
    const help = answerWave("Can you do something else?", makeData(), config);

    expect(prediction.text).toContain("forecasting is currently off");
    expect(help.text).toContain("site ID or district");
  });
});
