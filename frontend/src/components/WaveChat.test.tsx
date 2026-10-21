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
import type { Snapshot } from "../types/api";
import type { WaveChatReply, WaveProviderState } from "../types/wave";
import { WaveChat } from "./WaveChat";

vi.mock("../services/api", () => ({
  api: { waveStatus: vi.fn(), waveChat: vi.fn() },
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

function providerStatus(
  status: WaveProviderState["status"],
): WaveProviderState {
  return {
    provider: "openai",
    model: status === "connected" ? "gpt-4.1-mini" : "",
    configured: status !== "missing_key" && status !== "unavailable",
    verified: status === "connected",
    status,
    detail: status,
  };
}

function reply(
  answer = "The current simulation snapshot is available.",
): WaveChatReply {
  return {
    answer,
    provider: "openai",
    model: "gpt-4.1-mini",
    ai_connected: true,
    run_id: "wave-test-run",
    tick: 42,
    sim_time: "D1 12:00",
  };
}

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

function renderWave() {
  return render(
    <WaveChat data={makeSnapshot()} connection="live" refresh={refresh} />,
  );
}

describe("Wave generative assistant", () => {
  afterEach(() => {
    cleanup();
    sessionStorage.clear();
    vi.clearAllMocks();
  });

  it("sends a grounded request, shows thinking/responding, and preserves history on reopen", async () => {
    vi.mocked(api.waveStatus).mockResolvedValue(providerStatus("not_verified"));
    let resolveReply!: (value: WaveChatReply) => void;
    const response = new Promise<WaveChatReply>((resolve) => {
      resolveReply = resolve;
    });
    vi.mocked(api.waveChat).mockReturnValue(response);

    renderWave();
    openWave();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      screen.getByRole("group", { name: "Suggested questions" }),
    ).toBeInTheDocument();
    askWave("How is the network?");

    expect(
      screen.getAllByRole("img", { name: "Wave, thinking state" }),
    ).toHaveLength(2);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Wave is checking this simulation snapshot",
    );
    expect(api.waveChat).toHaveBeenCalledWith(
      "How is the network?",
      "wave-test-run",
      [],
    );

    await act(async () => {
      resolveReply(reply("The snapshot shows the network state at D1 12:00."));
      await response;
    });
    expect(
      await screen.findByText(
        "The snapshot shows the network state at D1 12:00.",
      ),
    ).toBeInTheDocument();
    expect(
      await screen.findAllByRole("img", { name: "Wave, responding state" }),
    ).toHaveLength(2);
    expect(await screen.findByText(/OpenAI connected/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close Wave panel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    openWave();
    expect(screen.getByText("How is the network?")).toBeInTheDocument();
    expect(
      screen.getByText("The snapshot shows the network state at D1 12:00."),
    ).toBeInTheDocument();
  });

  it("reports missing server configuration and retries the same question", async () => {
    const missingKey = providerStatus("missing_key");
    vi.mocked(api.waveStatus)
      .mockResolvedValueOnce(missingKey)
      .mockResolvedValue(missingKey);
    vi.mocked(api.waveChat)
      .mockRejectedValueOnce(
        new Error(
          "Wave’s AI is not configured. Add OPENAI_API_KEY to the backend deployment environment; no key is stored in the browser.",
        ),
      )
      .mockResolvedValue(reply("OpenAI answered after configuration."));

    renderWave();
    openWave();
    expect(await screen.findByText("AI setup required")).toBeInTheDocument();
    askWave("List incidents");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Add OPENAI_API_KEY to the backend deployment environment",
    );
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(
      screen.getAllByRole("img", { name: "Wave, offline state" }),
    ).toHaveLength(2);

    fireEvent.click(screen.getByRole("button", { name: "Refresh telemetry" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(
      await screen.findByText("OpenAI answered after configuration."),
    ).toBeInTheDocument();
    expect(api.waveChat).toHaveBeenCalledTimes(2);
    expect(api.waveChat).toHaveBeenLastCalledWith(
      "List incidents",
      "wave-test-run",
      [],
    );
    expect(screen.getAllByText("List incidents")).toHaveLength(1);
    expect(await screen.findByText(/OpenAI connected/)).toBeInTheDocument();
  });

  it("sends recent conversation turns to the server for follow-up questions", async () => {
    vi.mocked(api.waveStatus).mockResolvedValue(providerStatus("not_verified"));
    vi.mocked(api.waveChat)
      .mockResolvedValueOnce(reply("One active simulated incident."))
      .mockResolvedValueOnce(
        reply("It is the same incident in the current snapshot."),
      );

    renderWave();
    openWave();
    askWave("How many incidents?");
    expect(
      await screen.findByText("One active simulated incident."),
    ).toBeInTheDocument();

    askWave("Tell me more about it.");
    expect(
      await screen.findByText(
        "It is the same incident in the current snapshot.",
      ),
    ).toBeInTheDocument();
    expect(api.waveChat).toHaveBeenNthCalledWith(
      2,
      "Tell me more about it.",
      "wave-test-run",
      [
        { role: "user", content: "How many incidents?" },
        { role: "assistant", content: "One active simulated incident." },
      ],
    );
  });

  it("uses a suggested question as a real server request", async () => {
    vi.mocked(api.waveStatus).mockResolvedValue(providerStatus("not_verified"));
    vi.mocked(api.waveChat).mockResolvedValue(reply());
    renderWave();
    openWave();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Are there any active power problems?",
      }),
    );
    await waitFor(() => expect(api.waveChat).toHaveBeenCalledOnce());
    expect(api.waveChat).toHaveBeenCalledWith(
      "Are there any active power problems?",
      "wave-test-run",
      [],
    );
  });
});
