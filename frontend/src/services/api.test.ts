import { afterEach, describe, expect, it, vi } from "vitest";
import { api, validateSnapshot } from "./api";
import type { Snapshot } from "../types/api";

afterEach(() => vi.unstubAllGlobals());
function respond(body: unknown, status = 200) {
  const fetcher = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
describe("typed API transport", () => {
  it("uses relative paths and encodes fault parameters", async () => {
    const fetcher = respond({ ok: true });
    await api.inject("SLY test&1", 3, "run-token");
    expect(fetcher.mock.calls[0][0]).toBe(
      "/api/control/inject?node_id=SLY+test%261&kind=3&run_id=run-token",
    );
    expect(fetcher.mock.calls[0][1].method).toBe("POST");
  });
  it("treats engine rejection in a 200 response as a failed command", async () => {
    respond({ ok: false, reason: "no crew available" });
    await expect(api.approve(5, "run-token")).rejects.toThrow(
      "no crew available",
    );
  });
  it("surfaces a failed Day 30 reset returned by manual step", async () => {
    respond({
      advanced: false,
      reset: false,
      error:
        "Demo restart failed. The completed world was preserved and paused.",
    });
    await expect(api.step("run-token")).rejects.toThrow(
      "Demo restart failed. The completed world was preserved and paused.",
    );
  });
  it("preserves useful validation errors", async () => {
    respond({ detail: "already faulty" }, 409);
    await expect(api.inject("site", 3, "run-token")).rejects.toThrow(
      "already faulty",
    );
  });
  it("names the rejected field instead of a bare status for schema errors", async () => {
    // FastAPI's 422 body carries a list of issues; reading only a string
    // detail reduced it to "Request failed (422)" and hid the real cause.
    respond(
      {
        detail: [
          {
            loc: ["body", "history", 1, "content"],
            msg: "String should have at most 4000 characters",
            type: "string_too_long",
          },
        ],
      },
      422,
    );
    await expect(
      api.waveChat("How is the network?", "run-token", []),
    ).rejects.toThrow(
      "The server rejected this request (422) — history.1.content: String should have at most 4000 characters",
    );
  });
  it("requests a same-run telemetry window without absolute URLs", async () => {
    const fetcher = respond({
      run_id: "run / token",
      timeframe: "24h",
      tick_minutes: 5,
      samples: [],
    });
    await api.telemetryHistory("24h", "run / token");
    expect(fetcher.mock.calls[0][0]).toBe(
      "/api/telemetry/history?timeframe=24h&run_id=run+%2F+token",
    );
  });
  it("sends Wave chat only to the same-origin server endpoint", async () => {
    const fetcher = respond({
      answer: "grounded",
      provider: "openai",
      model: "gpt-4.1-mini",
      ai_connected: true,
      run_id: "run-token",
      tick: 42,
      sim_time: "D1 12:00",
    });
    await api.waveChat("How is the network?", "run-token", [
      { role: "user", content: "What changed?" },
    ]);
    expect(fetcher.mock.calls[0][0]).toBe("/api/wave/chat");
    expect(fetcher.mock.calls[0][1].method).toBe("POST");
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
      question: "How is the network?",
      run_id: "run-token",
      history: [{ role: "user", content: "What changed?" }],
    });
    expect(JSON.stringify(fetcher.mock.calls[0][1].body)).not.toContain(
      "OPENAI_API_KEY",
    );
  });
  it("reads provider setup status from the same-origin backend", async () => {
    const fetcher = respond({
      provider: "openai",
      model: "gpt-4.1-mini",
      configured: false,
      verified: false,
      status: "missing_key",
    });
    await api.waveStatus();
    expect(fetcher.mock.calls[0][0]).toBe("/api/wave/status");
  });
  it("sends the server cursor unchanged", async () => {
    const fetcher = respond({
      tick: 42,
      run_id: "run-token",
      // The wire carries one dashboard sample; the client appends its window.
      dashboard: { history: [{ tick: 42 }] },
      control: {},
      nodes: [],
    });
    await api.delta(42);
    expect(fetcher.mock.calls[0][0]).toBe("/api/delta?since=42");
  });
  it("reclaims a dashboard slot instead of dead-ending at capacity", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            detail: "SuliNOC is at capacity (8 active browser sessions).",
            code: "session_capacity",
          }),
          {
            status: 503,
            headers: { "Content-Type": "application/json", "Retry-After": "0" },
          },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetcher);
    await api.pause("run-token");
    expect(fetcher).toHaveBeenCalledTimes(2);
    // A 503 never reached the engine, so the retry is safe for POSTs too.
    expect(fetcher.mock.calls[1][1].headers["X-AutoNOC-Retry"]).toBe("1");
  });
  it("explains a saturated demo when even the retry is refused", async () => {
    const refusal = () =>
      new Response(
        JSON.stringify({
          detail: "SuliNOC is at capacity (8 active browser sessions).",
          code: "session_capacity",
        }),
        {
          status: 503,
          headers: { "Content-Type": "application/json", "Retry-After": "0" },
        },
      );
    const fetcher = vi.fn().mockImplementation(refusal);
    vi.stubGlobal("fetch", fetcher);
    await expect(api.pause("run-token")).rejects.toThrow(
      "SuliNOC is at capacity. Close an idle dashboard tab and try again.",
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("does not silently accept an outdated API", () => {
    expect(() =>
      validateSnapshot({ tick: 1, nodes: [] } as unknown as Snapshot),
    ).toThrow("Dashboard API mismatch");
  });
});
