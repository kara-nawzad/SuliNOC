import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../services/api";
import type { Config, Snapshot } from "../types/api";
import { WaveChat } from "./WaveChat";

vi.mock("../services/api", () => ({
  api: { delta: vi.fn() },
}));

function makeSnapshot(): Snapshot {
  return {
    run_id: "wave-test-run",
    tick: 42,
    kpis: { sim_time: "D1 12:00", availability: 99.5 },
    nodes: [],
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
      power: [],
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
  } as unknown as Snapshot;
}

const config = {
  status_names: {},
  presentation: { healthy_status: 0 },
  agg_sites: [],
} as unknown as Config;
const refresh = vi.fn();

function openWave() {
  fireEvent.click(screen.getByRole("button", { name: "Open Wave assistant" }));
}

function askWave(question: string) {
  fireEvent.change(screen.getByRole("textbox", { name: "Message Wave" }), {
    target: { value: question },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send message to Wave" }));
}

describe("Wave chatbot", () => {
  afterEach(() => {
    cleanup();
    sessionStorage.clear();
    vi.clearAllMocks();
  });

  it("fetches live telemetry, answers, and keeps the conversation on close/reopen", async () => {
    let resolveSnapshot!: (snapshot: Snapshot) => void;
    const response = new Promise<Snapshot>((resolve) => {
      resolveSnapshot = resolve;
    });
    vi.mocked(api.delta).mockReturnValue(response);

    render(
      <WaveChat
        data={makeSnapshot()}
        config={config}
        connection="live"
        refresh={refresh}
      />,
    );
    openWave();
    expect(
      await screen.findAllByRole("img", { name: "Wave, focused expression" }),
    ).toHaveLength(2);
    askWave("How is the network?");

    expect(
      screen.getAllByRole("img", { name: "Wave, thinking expression" }),
    ).toHaveLength(2);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Checking the latest simulation snapshot",
    );
    expect(api.delta).toHaveBeenCalledWith(42);

    await act(async () => {
      resolveSnapshot(makeSnapshot());
      await response;
    });
    expect(
      await screen.findByText(/network availability is 99\.50%/),
    ).toBeInTheDocument();
    expect(
      await screen.findAllByRole("img", { name: "Wave, excited expression" }),
    ).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Close Wave panel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    openWave();

    expect(screen.getByText("How is the network?")).toBeInTheDocument();
    expect(
      screen.getByText(/network availability is 99\.50%/),
    ).toBeInTheDocument();
  });

  it("shows an actionable error when the live snapshot request fails", async () => {
    vi.mocked(api.delta).mockRejectedValue(new Error("Gateway unavailable"));
    render(
      <WaveChat
        data={makeSnapshot()}
        config={config}
        connection="live"
        refresh={refresh}
      />,
    );
    openWave();
    askWave("List incidents");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Gateway unavailable",
    );
    expect(
      screen.getAllByRole("img", { name: "Wave, alert expression" }),
    ).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Refresh telemetry" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  });
});
