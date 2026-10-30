import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useTelemetry } from "./useTelemetry";
import { api } from "../services/api";
vi.mock("../services/api", () => ({
  api: {
    startSession: vi.fn(),
    config: vi.fn(),
    delta: vi.fn(),
    telemetryHistory: vi.fn(),
  },
}));
beforeEach(() => {
  vi.mocked(api.startSession).mockResolvedValue({
    run_id: "run1",
    tick: 0,
  } as never);
  vi.mocked(api.telemetryHistory).mockResolvedValue({
    run_id: "run1",
    timeframe: "30m",
    tick_minutes: 5,
    samples: [],
  } as never);
});
const sample = (tick: number) =>
  ({
    tick,
    run_id: "run1",
    dashboard: {
      history: [{ tick, sim_time: `D1 00:0${tick}` }],
    },
  }) as never;

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.useRealTimers();
});

/** Advance fake time and let the promise chain behind it settle. */
async function elapse(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

it("loads config once, follows server ticks, and aborts on unmount", async () => {
  vi.mocked(api.config).mockResolvedValue({
    presentation: { poll_ms: 10_000 },
  } as never);
  vi.mocked(api.delta).mockResolvedValue(sample(8));
  const { result, unmount } = renderHook(() => useTelemetry());
  await waitFor(() => expect(result.current.status).toBe("live"));
  expect(result.current.data?.tick).toBe(8);
  act(() => result.current.refresh());
  await waitFor(() => expect(api.delta).toHaveBeenCalledTimes(2));
  expect(api.config).toHaveBeenCalledTimes(1);
  expect(vi.mocked(api.delta).mock.calls[1][0]).toBe(8);
  const signal = vi.mocked(api.delta).mock.calls[1][1];
  unmount();
  expect(signal?.aborted).toBe(true);
});

it("keeps the last frame visible on a connection failure", async () => {
  vi.mocked(api.config).mockResolvedValue({
    presentation: { poll_ms: 10_000 },
  } as never);
  vi.mocked(api.delta)
    .mockResolvedValueOnce(sample(8))
    .mockRejectedValue(new Error("offline"));
  const { result } = renderHook(() => useTelemetry());
  await waitFor(() => expect(result.current.status).toBe("live"));
  act(() => result.current.refresh());
  await waitFor(() => expect(result.current.status).toBe("reconnecting"));
  expect(result.current.data?.tick).toBe(8);
  expect(result.current.error).toBe("offline");
});

it("pauses polling while the tab is hidden and catches up when visible", async () => {
  vi.mocked(api.config).mockResolvedValue({
    presentation: { poll_ms: 10_000 },
  } as never);
  vi.mocked(api.delta).mockResolvedValue(sample(8));
  const setHidden = (value: boolean) => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  };
  try {
    const { result } = renderHook(() => useTelemetry());
    await waitFor(() => expect(result.current.status).toBe("live"));
    expect(api.delta).toHaveBeenCalledTimes(1);

    // Hidden: even a manual refresh must not fetch (the run keeps simulating
    // server-side; one delta on return catches up).
    setHidden(true);
    act(() => result.current.refresh());
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(api.delta).toHaveBeenCalledTimes(1);

    // Visible again: the visibility handler polls immediately with the last
    // cursor — no stale flash, no missed ticks.
    setHidden(false);
    await waitFor(() => expect(api.delta).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.delta).mock.calls[1][0]).toBe(8);
  } finally {
    setHidden(false);
  }
});

it("claims its own run before it polls", async () => {
  // Token-less reads are answered from the server's shared engine, so a
  // dashboard that skipped the handshake would render another visitor's world
  // and its controls would belong to no run at all.
  vi.mocked(api.config).mockResolvedValue({
    presentation: { poll_ms: 10_000 },
  } as never);
  vi.mocked(api.delta).mockResolvedValue(sample(8));
  const order: string[] = [];
  vi.mocked(api.startSession).mockImplementation(async () => {
    order.push("session");
    return { run_id: "run1", tick: 0 } as never;
  });
  vi.mocked(api.config).mockImplementation(async () => {
    order.push("config");
    return { presentation: { poll_ms: 10_000 } } as never;
  });
  vi.mocked(api.delta).mockImplementation(async () => {
    order.push("delta");
    return sample(8) as never;
  });
  const { result } = renderHook(() => useTelemetry());
  await waitFor(() => expect(result.current.status).toBe("live"));
  expect(order.slice(0, 3)).toEqual(["session", "config", "delta"]);
  // One handshake per page load, not one per poll.
  act(() => result.current.refresh());
  await waitFor(() => expect(api.delta).toHaveBeenCalledTimes(2));
  expect(api.startSession).toHaveBeenCalledTimes(1);
});

it("says it is warming up when the handshake is slow, then stops", async () => {
  vi.mocked(api.startSession).mockImplementation(
    () =>
      new Promise((resolve) =>
        setTimeout(() => resolve({ run_id: "run1", tick: 0 } as never), 450),
      ),
  );
  vi.mocked(api.config).mockResolvedValue({
    presentation: { poll_ms: 10_000 },
  } as never);
  vi.mocked(api.delta).mockResolvedValue(sample(8));
  const { result } = renderHook(() => useTelemetry());
  expect(result.current.warming).toBe(false);          // not instantly alarming
  await waitFor(() => expect(result.current.warming).toBe(true));
  expect(result.current.status).toBe("connecting");
  await waitFor(() => expect(result.current.status).toBe("live"));
  expect(result.current.warming).toBe(false);
});

it("keeps its own rolling dashboard history because the wire sends one row", async () => {
  vi.mocked(api.config).mockResolvedValue({
    presentation: { poll_ms: 10_000 },
  } as never);
  let tick = 8;
  vi.mocked(api.delta).mockImplementation(async () =>
    sample(tick++) as never,
  );
  const { result } = renderHook(() => useTelemetry());
  await waitFor(() => expect(result.current.data?.tick).toBe(8));
  expect(result.current.data?.dashboard.history).toHaveLength(1);
  act(() => result.current.refresh());
  await waitFor(() => expect(result.current.data?.tick).toBe(9));
  // The server sent one sample per frame; the dashboard appended both.
  expect(result.current.data?.dashboard.history.map((r) => r.tick)).toEqual([
    8, 9,
  ]);
  // A repeated tick (paused engine) must not duplicate a row.
  tick = 9;
  act(() => result.current.refresh());
  await waitFor(() => expect(api.delta).toHaveBeenCalledTimes(3));
  expect(result.current.data?.dashboard.history.map((r) => r.tick)).toEqual([
    8, 9,
  ]);
});

it("doubles the wait through an outage up to 30 s, then resumes the poll interval", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  vi.mocked(api.config).mockResolvedValue({
    presentation: { poll_ms: 1000 },
  } as never);
  const attempts: number[] = [];
  let online = false;
  vi.mocked(api.delta).mockImplementation(async () => {
    attempts.push(Date.now());
    if (!online) throw new Error("offline");
    return sample(8) as never;
  });
  const { result } = renderHook(() => useTelemetry());
  await elapse(0);
  expect(attempts).toHaveLength(1);

  // 2 s, 4 s, 8 s, 16 s, then capped at 30 s — no request in between.
  for (const wait of [2000, 4000, 8000, 16_000, 30_000, 30_000]) {
    const before = attempts.length;
    await elapse(wait - 1);
    expect(attempts).toHaveLength(before);
    await elapse(1);
    expect(attempts).toHaveLength(before + 1);
  }
  const t0 = attempts[0];
  expect(attempts.map((t) => t - t0)).toEqual([
    0, 2000, 6000, 14_000, 30_000, 60_000, 90_000,
  ]);
  expect(result.current.status).toBe("reconnecting");
  expect(result.current.retryDelay).toBe(30_000);
  expect(result.current.data).toBeNull();

  // The server comes back: the next poll is on the normal interval again.
  online = true;
  await elapse(30_000);
  expect(result.current.status).toBe("live");
  expect(result.current.retryDelay).toBe(1000);
  expect(result.current.lastUpdateAt).not.toBeNull();
  const delivered = attempts.length;
  await elapse(1000);
  expect(attempts.length).toBe(delivered + 1);
});

it("keeps the last frame and its timestamp when an attempt is lost", async () => {
  vi.mocked(api.config).mockResolvedValue({
    presentation: { poll_ms: 10_000 },
  } as never);
  vi.mocked(api.delta)
    .mockResolvedValueOnce(sample(8))
    .mockRejectedValue(
      Object.assign(new Error("The operation was aborted."), {
        name: "TimeoutError",
      }),
    );
  const { result } = renderHook(() => useTelemetry());
  await waitFor(() => expect(result.current.status).toBe("live"));
  const stamped = result.current.lastUpdateAt;
  expect(stamped).not.toBeNull();
  act(() => result.current.refresh());
  await waitFor(() => expect(result.current.status).toBe("reconnecting"));
  // A silent socket is named as such instead of "The operation was aborted."
  expect(result.current.error).toBe("No response within 4 s");
  expect(result.current.data?.tick).toBe(8);
  expect(result.current.lastUpdateAt).toBe(stamped);
});

it("seeds the dashboard window once from the server, without duplicate ticks", async () => {
  vi.mocked(api.config).mockResolvedValue({
    presentation: { poll_ms: 10_000 },
  } as never);
  const window = Array.from({ length: 30 }, (_, i) => ({
    tick: 71 + i,
    sim_time: `D1 0${Math.floor(i / 12)}:${String((i * 5) % 60).padStart(2, "0")}`,
  }));
  vi.mocked(api.delta).mockResolvedValue({
    tick: 100,
    run_id: "run1",
    dashboard: { history: [{ tick: 100, sim_time: "D1 08:20" }] },
  } as never);
  vi.mocked(api.telemetryHistory).mockResolvedValue({
    run_id: "run1",
    timeframe: "30m",
    tick_minutes: 5,
    samples: window,
  } as never);
  const { result } = renderHook(() => useTelemetry());
  await waitFor(() =>
    expect(result.current.data?.dashboard.history).toHaveLength(30),
  );
  expect(api.telemetryHistory).toHaveBeenCalledWith("30m", "run1");
  const ticks = result.current.data!.dashboard.history.map((row) => row.tick);
  expect(ticks).toEqual(Array.from({ length: 30 }, (_, i) => 71 + i));
  expect(new Set(ticks).size).toBe(30);   // the seam tick is not duplicated
  // The console was usable before the seed landed.
  expect(result.current.status).toBe("live");
  // One seed per run, not one per poll.
  act(() => result.current.refresh());
  await waitFor(() => expect(api.delta).toHaveBeenCalledTimes(2));
  expect(api.telemetryHistory).toHaveBeenCalledTimes(1);
});

it("fills the window from live ticks when the seed fails, and does not retry", async () => {
  vi.mocked(api.config).mockResolvedValue({
    presentation: { poll_ms: 10_000 },
  } as never);
  let tick = 8;
  vi.mocked(api.delta).mockImplementation(async () => sample(tick++) as never);
  vi.mocked(api.telemetryHistory).mockRejectedValue(new Error("history down"));
  const { result } = renderHook(() => useTelemetry());
  await waitFor(() => expect(result.current.status).toBe("live"));
  await waitFor(() =>
    expect(result.current.data?.dashboard.history).toHaveLength(1),
  );
  act(() => result.current.refresh());
  await waitFor(() =>
    expect(result.current.data?.dashboard.history).toHaveLength(2),
  );
  act(() => result.current.refresh());
  await waitFor(() =>
    expect(result.current.data?.dashboard.history).toHaveLength(3),
  );
  expect(api.telemetryHistory).toHaveBeenCalledTimes(1);
  expect(result.current.status).toBe("live");
  expect(result.current.error).toBeNull();
});

it("seeds again when the server hands the tab a new run", async () => {
  vi.mocked(api.config).mockResolvedValue({
    presentation: { poll_ms: 10_000 },
  } as never);
  const seed = (tick: number, run: string) => ({
    run_id: run,
    timeframe: "30m",
    tick_minutes: 5,
    samples: [
      { tick: tick - 1, sim_time: "D1 00:00" },
      { tick, sim_time: "D1 00:05" },
    ],
  });
  vi.mocked(api.telemetryHistory)
    .mockResolvedValueOnce(seed(8, "run1") as never)
    .mockResolvedValueOnce(seed(3, "run2") as never);
  vi.mocked(api.delta)
    .mockResolvedValueOnce(sample(8))
    .mockResolvedValue({
      tick: 3,
      run_id: "run2",
      dashboard: { history: [{ tick: 3, sim_time: "D1 00:3" }] },
    } as never);
  const { result } = renderHook(() => useTelemetry());
  await waitFor(() =>
    expect(result.current.data?.dashboard.history.map((r) => r.tick)).toEqual([
      7, 8,
    ]),
  );
  act(() => result.current.refresh());
  await waitFor(() => expect(result.current.data?.run_id).toBe("run2"));
  await waitFor(() =>
    expect(result.current.data?.dashboard.history.map((r) => r.tick)).toEqual([
      2, 3,
    ]),
  );
  expect(api.telemetryHistory).toHaveBeenNthCalledWith(1, "30m", "run1");
  expect(api.telemetryHistory).toHaveBeenNthCalledWith(2, "30m", "run2");
});
