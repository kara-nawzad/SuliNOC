import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  Config,
  Snapshot,
  TelemetryHistory,
  TelemetrySample,
} from "../types/api";
import { api } from "../services/api";
import { TrafficQualityCard } from "./TrafficQualityCard";

vi.mock("../services/api", () => ({
  api: { telemetryHistory: vi.fn() },
}));
vi.mock("./NumberTween", () => ({
  NumberTween: ({ value }: { value: number }) => <span>{value}</span>,
}));

function sample(tick: number): TelemetrySample {
  const minutes = tick * 5;
  const day = Math.floor(minutes / 1440) + 1;
  const dayMinutes = minutes % 1440;
  const hours = String(Math.floor(dayMinutes / 60)).padStart(2, "0");
  const rest = String(dayMinutes % 60).padStart(2, "0");
  return {
    tick,
    sim_time: `D${day} ${hours}:${rest}`,
    availability: 99,
    incidents: 0,
    power_events: 0,
    throughput_gbps: 32 + tick / 100,
    drop_rate: 0.4,
    prb: 45,
    online: 295,
    degraded: 4,
    offline: 1,
  };
}

function makeConfig() {
  return {
    tick_minutes: 5,
    presentation: {
      palette: { fiber: "#1479c4", prediction: "#7355db" },
    },
  } as unknown as Config;
}

function makeSnapshot(): Snapshot {
  const history = [sample(99), sample(100)];
  return {
    run_id: "run-1",
    tick: 100,
    dashboard: { current: history.at(-1), history },
  } as unknown as Snapshot;
}

describe("TrafficQualityCard history windows", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it.each(["24h", "7d"] as const)(
    "redraws when %s history backfills before the current tick",
    async (timeframe) => {
      let resolveHistory!: (history: TelemetryHistory) => void;
      const historyRequest = new Promise<TelemetryHistory>((resolve) => {
        resolveHistory = resolve;
      });
      vi.mocked(api.telemetryHistory).mockReturnValue(historyRequest);
      vi.stubGlobal(
        "requestAnimationFrame",
        vi.fn(() => 1),
      );
      vi.stubGlobal("cancelAnimationFrame", vi.fn());

      const stats = (window as unknown as { __chartStats: { redraws: number } })
        .__chartStats;
      const initialRedraws = stats.redraws;
      render(
        <TrafficQualityCard data={makeSnapshot()} config={makeConfig()} />,
      );
      await waitFor(() => expect(stats.redraws).toBe(initialRedraws + 1));

      fireEvent.click(screen.getByRole("button", { name: timeframe }));
      await waitFor(() =>
        expect(api.telemetryHistory).toHaveBeenCalledWith(timeframe, "run-1"),
      );
      await waitFor(() => expect(stats.redraws).toBe(initialRedraws + 2));

      const result: TelemetryHistory = {
        run_id: "run-1",
        timeframe,
        tick_minutes: 5,
        samples: [20, 40, 60, 80, 100].map(sample),
      };
      await act(async () => {
        resolveHistory(result);
        await historyRequest;
      });

      await waitFor(() => expect(stats.redraws).toBe(initialRedraws + 3));
    },
  );
});
