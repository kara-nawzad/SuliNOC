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
  api: {
    waveStatus: vi.fn(),
    waveChat: vi.fn(),
    // Streaming is tried first in the component; the factory default
    // pretends the backend predates the SSE route (a 404), so every test
    // that only mocks waveChat exercises the JSON fallback path.
    waveChatStream: vi.fn(async () => {
      const error = new Error("streaming route not available") as Error & {
        status?: number;
      };
      error.status = 404;
      throw error;
    }),
  },
}));

function makeSnapshot(activeIncidents = 0): Snapshot {
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
      incidents: Array.from({ length: activeIncidents }, (_, index) => ({
        id: `incident-${index}`,
        node_id: `S${index}`,
        title: `Incident ${index}`,
        detail: "Simulated incident",
        severity: "MAJOR",
        affected: 1,
        since_tick: 42,
        dispatched: false,
      })),
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
    mode:
      status === "missing_key" || status === "unavailable" ? "local" : "live",
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

/** Wave types replies out at reading pace; assertions wait for the tail. */
const TYPED = { timeout: 6000 } as const;

function openWave() {
  fireEvent.click(screen.getByRole("button", { name: "Open Wave assistant" }));
}

function askWave(question: string) {
  fireEvent.change(screen.getByRole("textbox", { name: "Message Wave" }), {
    target: { value: question },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send message to Wave" }));
}

/** The newest assistant bubble's rendered text. */
function typedReply(): HTMLElement | null {
  const nodes = document.querySelectorAll<HTMLElement>(
    ".wave-message--assistant .wave-message-content",
  );
  return nodes.length ? nodes[nodes.length - 1] : null;
}

function renderWave(activeIncidents = 0) {
  return render(
    <WaveChat
      data={makeSnapshot(activeIncidents)}
      connection="live"
      refresh={refresh}
    />,
  );
}

describe("Wave generative assistant", () => {
  afterEach(() => {
    cleanup();
    sessionStorage.clear();
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("keeps a friendly note beside the launcher while the chat is closed", async () => {
    vi.mocked(api.waveStatus).mockResolvedValue(providerStatus("not_verified"));
    const firstRender = renderWave(12);

    expect(screen.getByText("Hey, I’m Wave 👋")).toBeInTheDocument();
    expect(screen.queryByText("9+")).not.toBeInTheDocument();
    expect(firstRender.container.querySelector(".wave-alert-badge")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Dismiss Wave greeting" }),
    ).not.toBeInTheDocument();

    firstRender.unmount();
    renderWave();
    expect(screen.getByText("Hey, I’m Wave 👋")).toBeInTheDocument();
  });

  it("keeps only Wave in the header, uses the Wave avatar, and omits the disclosure footer", () => {
    vi.mocked(api.waveStatus).mockResolvedValue(providerStatus("not_verified"));
    renderWave();
    openWave();

    const dialog = screen.getByRole("dialog", {
      name: "Wave network operations assistant",
    });
    expect(screen.getByRole("heading", { name: "Wave" })).toBeInTheDocument();
    expect(dialog.querySelector(".wave-panel-identity")?.textContent).toBe(
      "Wave",
    );
    expect(
      dialog.querySelector(
        ".wave-eyebrow, .wave-connection, .wave-provider-status, .wave-predictor",
      ),
    ).toBeNull();
    expect(dialog.querySelector(".wave-panel-foot")).toBeNull();
    expect(dialog.querySelector(".wave-message-mark")).toBeNull();

    const avatar = dialog.querySelector<HTMLImageElement>(
      ".wave-message-avatar",
    );
    expect(avatar).not.toBeNull();
    expect(avatar).toHaveAttribute("src", "/assets/wave-avatar.png");
  });

  it("lets the launcher drag, persists its position, and suppresses the drag click", () => {
    class PointerEventShim extends MouseEvent {
      pointerId: number;

      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 1;
      }
    }
    vi.stubGlobal("PointerEvent", PointerEventShim);
    vi.mocked(api.waveStatus).mockResolvedValue(providerStatus("not_verified"));
    const firstRender = renderWave();
    const launcher = screen.getByRole("button", {
      name: "Open Wave assistant",
    });
    vi.spyOn(launcher, "getBoundingClientRect").mockReturnValue({
      x: 860,
      y: 640,
      left: 860,
      top: 640,
      right: 964,
      bottom: 744,
      width: 104,
      height: 104,
      toJSON: () => undefined,
    } as DOMRect);

    fireEvent.pointerDown(launcher, {
      pointerId: 1,
      button: 0,
      clientX: 900,
      clientY: 680,
    });
    fireEvent.pointerMove(launcher, {
      pointerId: 1,
      button: 0,
      clientX: 820,
      clientY: 620,
    });
    fireEvent.pointerUp(launcher, {
      pointerId: 1,
      button: 0,
      clientX: 820,
      clientY: 620,
    });
    fireEvent.click(launcher);

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(firstRender.container.querySelector(".wave-assistant")).toHaveStyle({
      "--wave-launcher-right": "140px",
      "--wave-launcher-bottom": "84px",
    });
    expect(
      JSON.parse(localStorage.getItem("sulinoc-wave-launcher-position:v1")!),
    ).toEqual({ right: 140, bottom: 84 });

    firstRender.unmount();
    const restored = renderWave();
    expect(restored.container.querySelector(".wave-assistant")).toHaveStyle({
      "--wave-launcher-right": "140px",
      "--wave-launcher-bottom": "84px",
    });
  });

  it("hides the friendly note while the chat is open and brings it back on close", async () => {
    vi.mocked(api.waveStatus).mockResolvedValue(providerStatus("not_verified"));
    renderWave();
    expect(screen.getByText("Hey, I’m Wave 👋")).toBeInTheDocument();

    openWave();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByText("Hey, I’m Wave 👋")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close Wave panel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByText("Hey, I’m Wave 👋")).toBeInTheDocument();
  });

  it("renders markdown answers without literal ** markers", async () => {
    vi.mocked(api.waveStatus).mockResolvedValue(providerStatus("not_verified"));
    vi.mocked(api.waveChat).mockResolvedValue(
      reply(
        "**All good.**\nCrews are **EN_ROUTE** to two sites.\nNothing else to report.",
      ),
    );
    renderWave();
    openWave();
    askWave("Status?");

    // The JSON path types out at ~320 chars/s; wait for the final render.
    expect(
      await screen.findByText("All good.", { selector: "strong" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("EN_ROUTE", { selector: "strong" }),
    ).toBeInTheDocument();
    const bubble = screen
      .getByText("All good.", { selector: "strong" })
      .closest(".wave-md");
    expect(bubble).not.toBeNull();
    await waitFor(() =>
      expect(bubble?.textContent).toContain("Nothing else to report."),
    );
    // Single line breaks survive (rendered as breaks by pre-wrap in CSS).
    expect(bubble?.textContent).toContain("EN_ROUTE to two sites.");
    expect(screen.queryByText(/\*\*/)).not.toBeInTheDocument();
  });

  it("renders headings, GFM tables, quotes and em-dash dividers", async () => {
    vi.mocked(api.waveStatus).mockResolvedValue(providerStatus("not_verified"));
    vi.mocked(api.waveChat).mockResolvedValue(
      reply(
        "## Quick KPI Snapshot\n\nAvailability is **99.5%**.\n\n—\n\n| Site | Status |\n| --- | --- |\n| S12 | Degraded |\n\n> Crews are on site.",
      ),
    );
    renderWave();
    openWave();
    askWave("Give me the snapshot.");

    // Wait for the last block (the quote) so the reveal has finished.
    expect(
      await screen.findByText("Crews are on site.", {}, TYPED),
    ).toBeInTheDocument();

    const heading = screen.getByRole("heading", {
      level: 2,
      name: "Quick KPI Snapshot",
    });
    expect(heading).toBeInTheDocument();
    const table = screen.getByRole("table");
    expect(table.querySelector("th")).toHaveTextContent("Site");
    expect(table.querySelectorAll("tbody td")).toHaveLength(2);
    expect(
      screen.getByText("99.5%", { selector: "strong" }),
    ).toBeInTheDocument();
    expect(screen.getByText("S12", { selector: "td" })).toBeInTheDocument();
    // The em-dash divider and heading markers never leak as literal text.
    expect(screen.queryByText("—")).not.toBeInTheDocument();
    expect(screen.queryByText(/##/)).not.toBeInTheDocument();
  });

  it("streams replies over SSE instead of waiting for the whole answer", async () => {
    vi.mocked(api.waveStatus).mockResolvedValue(providerStatus("not_verified"));
    vi.mocked(api.waveChatStream).mockImplementationOnce(
      async (_question, _runId, _history, onDelta) => {
        onDelta("Grounded ");
        onDelta("streamed reply.");
        return reply("Grounded streamed reply.");
      },
    );
    renderWave();
    openWave();
    askWave("How is the network?");

    expect(
      await screen.findByText("Grounded streamed reply.", {}, TYPED),
    ).toBeInTheDocument();
    expect(api.waveChatStream).toHaveBeenCalledOnce();
    expect(api.waveChat).not.toHaveBeenCalled();
  });

  it("types a long answer out instead of letting it pop in", async () => {
    vi.mocked(api.waveStatus).mockResolvedValue(providerStatus("connected"));
    const longAnswer = "Radio checks are clean across the ring. "
      .repeat(14)
      .trim();
    vi.mocked(api.waveChat).mockResolvedValue(reply(longAnswer));

    renderWave();
    openWave();
    askWave("How is the network?");

    await waitFor(() => expect(typedReply()).not.toBeNull());
    await waitFor(() =>
      expect(typedReply()!.textContent!.length).toBeGreaterThan(0),
    );
    // The reveal is paced, so long before the end only a prefix is on screen.
    expect(typedReply()!.textContent!.length).toBeLessThan(
      longAnswer.length / 2,
    );
    await waitFor(
      () => expect(typedReply()!.textContent).toContain(longAnswer.slice(-24)),
      TYPED,
    );
  });

  it("reveals the whole answer when the typing bubble is tapped", async () => {
    vi.mocked(api.waveStatus).mockResolvedValue(providerStatus("connected"));
    const longAnswer = "Signal integrity is steady on every ring. "
      .repeat(12)
      .trim();
    vi.mocked(api.waveChat).mockResolvedValue(reply(longAnswer));

    renderWave();
    openWave();
    askWave("How is the network?");

    await waitFor(() =>
      expect(typedReply()!.textContent!.length).toBeGreaterThan(0),
    );
    const typing = document.querySelector<HTMLElement>(
      ".wave-message.is-typing",
    );
    expect(typing).not.toBeNull();
    fireEvent.click(typing!);

    await waitFor(
      () => expect(typedReply()!.textContent).toContain(longAnswer.slice(-24)),
      { timeout: 1500 },
    );
  });

  it("falls back to the JSON reply when the stream route is missing", async () => {
    vi.mocked(api.waveStatus).mockResolvedValue(providerStatus("not_verified"));
    vi.mocked(api.waveChat).mockResolvedValue(reply("Fallback answer."));
    renderWave();
    openWave();
    askWave("Status?");

    expect(
      await screen.findByText("Fallback answer.", {}, TYPED),
    ).toBeInTheDocument();
    expect(api.waveChatStream).toHaveBeenCalledOnce();
    expect(api.waveChat).toHaveBeenCalledOnce();
  });

  it("shows Wave's updated friendly, read-only in-chat greeting", () => {
    vi.mocked(api.waveStatus).mockResolvedValue(providerStatus("not_verified"));
    renderWave();
    openWave();

    expect(
      screen.getByText(
        /your friendly telecom engineer for this SuliNOC simulation/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/one dropped packet at a time/),
    ).toBeInTheDocument();
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
    await waitFor(() =>
      expect(api.waveChat).toHaveBeenCalledWith(
        "How is the network?",
        "wave-test-run",
        [],
      ),
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
    expect(screen.queryByText(/OpenAI connected/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close Wave panel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    openWave();
    expect(screen.getByText("How is the network?")).toBeInTheDocument();
    expect(
      screen.getByText("The snapshot shows the network state at D1 12:00."),
    ).toBeInTheDocument();
  });

  it("trims an oversized earlier answer before resending history", async () => {
    // Regression: a restored chat can hold a full-length answer (Wave's own
    // reply). Sending it verbatim tripped the backend's per-turn limit, and
    // every later question failed with an opaque 422 until the chat was reset.
    const longAnswer = "Z".repeat(2500);
    sessionStorage.setItem(
      "sulinoc-wave-chat:wave-test-run",
      JSON.stringify([
        { id: "prior-question", role: "user", content: "How is site power?" },
        { id: "prior-answer", role: "assistant", content: longAnswer },
      ]),
    );
    vi.mocked(api.waveStatus).mockResolvedValue(providerStatus("not_verified"));
    vi.mocked(api.waveChat).mockResolvedValue(reply("Short answer."));

    renderWave();
    openWave();
    askWave("what is O-RAN - Non-RT RIC?");

    await waitFor(() => expect(api.waveChat).toHaveBeenCalledOnce());
    const history = vi.mocked(api.waveChat).mock.calls[0][2];
    expect(history.map((turn) => turn.role)).toEqual(["user", "assistant"]);
    expect(history[1].content).toHaveLength(2000);
    expect(longAnswer.startsWith(history[1].content)).toBe(true);
  });

  it("answers in local mode when the deployment has no provider key", async () => {
    // The server degrades to its deterministic snapshot reader instead of
    // 503-ing, so the chat keeps working and never looks "offline".
    vi.mocked(api.waveStatus).mockResolvedValue(providerStatus("missing_key"));
    vi.mocked(api.waveChat).mockResolvedValue({
      ...reply(
        "*(Local mode — no provider API key is configured on the server. Answering from this run's snapshot and my built-in notes.)*\n\n**Right now** — 99.50 % availability.",
      ),
      provider: "local",
      model: "wave-local-fallback",
      ai_connected: false,
    });

    renderWave();
    openWave();
    askWave("How is the network?");

    expect(await screen.findByText(/Local mode/)).toBeInTheDocument();
    // The reveal is paced, so wait for the tail of the answer to land.
    await waitFor(
      () =>
        expect(screen.getByRole("dialog").textContent).toContain(
          "99.50 % availability",
        ),
      TYPED,
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("img", { name: "Wave, offline state" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: "Message Wave" }),
    ).toHaveAttribute(
      "placeholder",
      "Ask anything — local mode, live model offline…",
    );
  });

  it("keeps the answer and flags it when the run restarts mid-question", async () => {
    vi.mocked(api.waveStatus).mockResolvedValue(providerStatus("not_verified"));
    vi.mocked(api.waveChat).mockResolvedValue({
      ...reply("Restarted, but still grounded."),
      run_id: "next-run",
      run_restarted: true,
    });

    renderWave();
    openWave();
    askWave("How is the network?");

    expect(
      await screen.findByText("Restarted, but still grounded.", {}, TYPED),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(
        /The simulation restarted while I was answering, so this comes from the new run/,
        {},
        TYPED,
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a rate-limit refusal with the retry affordances", async () => {
    vi.mocked(api.waveStatus).mockResolvedValue(providerStatus("connected"));
    vi.mocked(api.waveChat).mockRejectedValue(
      new Error(
        "Wave is taking a short breath — 12s, then ask again. (That's the per-dashboard limit keeping the shared key healthy.)",
      ),
    );

    renderWave();
    openWave();
    askWave("List incidents");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "taking a short breath",
    );
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(api.waveChat).toHaveBeenCalledOnce();
  });

  it("shows a successful answer from Groq without adding provider status to the header", async () => {
    vi.mocked(api.waveStatus).mockResolvedValue({
      provider: "groq",
      model: "openai/gpt-oss-20b",
      configured: true,
      verified: false,
      status: "not_verified",
    });
    vi.mocked(api.waveChat).mockResolvedValue({
      ...reply("Grounded answer from Groq."),
      provider: "groq",
      model: "openai/gpt-oss-20b",
    });

    renderWave();
    openWave();
    askWave("What is happening?");

    expect(
      await screen.findByText("Grounded answer from Groq.", {}, TYPED),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Groq connected/)).not.toBeInTheDocument();
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
      await screen.findByText("One active simulated incident.", {}, TYPED),
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
