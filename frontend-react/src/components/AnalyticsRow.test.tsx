/**
 * "Site power & fleet" donut contract.
 *
 * Regression guard: the donut and legend must render the LIVE per-source
 * counts from `data.dashboard.power` (the server's tally of every site's
 * current power_source). An earlier build showed a frozen Grid: 300 — the
 * backend never left Grid — and a stale hard-coded chart would look the same
 * from the browser. These tests pin the frontend half of that contract:
 * slices and legend numbers follow the payload, in real time.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AnalyticsRow } from "./AnalyticsRow";
import type { Config, PowerSource, Snapshot } from "../types/api";

vi.mock("../services/api", () => ({
  api: {
    telemetryHistory: vi.fn().mockResolvedValue({ run_id: "r1", samples: [] }),
  },
}));

const powerColors: Record<PowerSource, string> = {
  Grid: "#00ff00",
  Battery: "#ffaa00",
  Generator: "#aa00ff",
  Solar: "#00aaff",
};

function powerRow(mix: Partial<Record<PowerSource, number>>) {
  const names: PowerSource[] = ["Grid", "Battery", "Generator", "Solar"];
  return names.map((name) => ({
    name,
    count: mix[name] ?? 0,
    fraction: (mix[name] ?? 0) / 300,
  }));
}

function makeConfig() {
  return {
    num_nodes: 300,
    num_teams: 10,
    break_even_precision: 0.4375,
    tick_minutes: 5,
    status_colors: {
      0: "#0f0", 1: "#ff0", 2: "#ff0", 3: "#f0f", 4: "#f00", 5: "#f80",
    },
    gauges: {
      prb: { lo: 0, hi: 100, good: 60, warn: 85, bad: 95, lower_bad: false },
    },
    presentation: {
      palette: {
        prediction: "#a0f", warning: "#fa0", healthy: "#0f0",
        critical: "#f00", fiber: "#0af", crew: "#ccc",
      },
      power_colors: powerColors,
      prediction_horizon_min: 60,
      severity_colors: {},
    },
  } as unknown as Config;
}

function makeSnapshot(mix: Partial<Record<PowerSource, number>>) {
  return {
    run_id: "r1",
    tick: 100,
    ai: { ai_enabled: false },
    dashboard: {
      top_cells: [],
      forecast: null,
      power: powerRow(mix),
      fleet: { IDLE: 10, EN_ROUTE: 0, STANDBY: 0, REPAIRING: 0, RETURNING: 0 },
      active_ats: 2,
      history: [],
      current: {
        availability: 99, throughput_gbps: 12, prb: 40, erab_drop: 0.1,
      },
    },
  } as unknown as Snapshot;
}

/** legend rows as {label: count} read from the rendered DOM */
function legendCounts(container: HTMLElement) {
  const rows = container.querySelectorAll(".power-legend > span");
  const out: Record<string, string> = {};
  rows.forEach((row) => {
    const label = row.querySelector("b")!.textContent ?? "";
    const name = (row.textContent ?? "").replace(label, "").trim();
    out[name] = label;
  });
  return out;
}

function renderRow(mix: Partial<Record<PowerSource, number>>) {
  return render(
    <AnalyticsRow
      data={makeSnapshot(mix)}
      config={makeConfig()}
      onSelect={vi.fn()}
      onFleet={vi.fn()}
    />,
  );
}

describe("Site power & fleet donut", () => {
  it("renders live per-source counts and the Diesel DG legend label", () => {
    const { container } = renderRow(
      { Grid: 150, Solar: 60, Battery: 50, Generator: 40 },
    );
    expect(screen.getByText("Diesel DG")).toBeInTheDocument();
    expect(screen.queryByText("Generator")).not.toBeInTheDocument();
    // legend numbers come from the payload, not from a frozen 300/0/0/0
    expect(legendCounts(container)).toEqual({
      Grid: "150",
      Battery: "50",
      "Diesel DG": "40",
      Solar: "60",
    });
  });

  it("draws one donut segment per power source, colored from config", () => {
    const { container } = renderRow(
      { Grid: 240, Solar: 30, Battery: 20, Generator: 10 },
    );
    const svg = container.querySelector(
      'svg[aria-label="Current site power-source distribution"]',
    )!;
    // animated slices carry pathLength=100; the backdrop circle does not
    const segments = svg.querySelectorAll("circle[pathLength='100']");
    expect(segments).toHaveLength(4);
    for (const color of Object.values(powerColors)) {
      expect(
        [...segments].some((c) => c.getAttribute("stroke") === color),
      ).toBe(true);
    }
  });

  it("follows the payload when power shifts at runtime", () => {
    const { container, rerender } = renderRow({ Grid: 300 });
    expect(legendCounts(container)).toEqual({
      Grid: "300",
      Battery: "0",
      "Diesel DG": "0",
      Solar: "0",
    });

    // grid faults push sites onto battery and the diesel plant
    rerender(
      <AnalyticsRow
        data={makeSnapshot({ Grid: 210, Battery: 60, Generator: 30 })}
        config={makeConfig()}
        onSelect={vi.fn()}
        onFleet={vi.fn()}
      />,
    );
    expect(legendCounts(container)).toEqual({
      Grid: "210",
      Battery: "60",
      "Diesel DG": "30",
      Solar: "0",
    });
  });
});
