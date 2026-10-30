/* The console only paints once the visitor enters, so the click that leaves the
   welcome screen is the first time all of its markup is built. A hook added
   below Console's early returns changed the number of hooks between those two
   renders; React answered "Rendered more hooks than during the previous
   render" and unmounted the tree, which left a blank page where the dashboard
   should be. This mounts the real App against one captured telemetry frame and
   enters it, so that rule stays pinned. */
import { render, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import App from "./App";
import configFixture from "./test-fixtures/console-config.json";
import deltaFixture from "./test-fixtures/console-delta.json";

vi.mock("./services/api", () => {
  const base: Record<string, unknown> = {
    startSession: async () => ({
      run_id: deltaFixture.run_id,
      tick: deltaFixture.tick,
    }),
    config: async () => configFixture,
    delta: async () => deltaFixture,
    telemetryHistory: async () => ({ samples: [] }),
    activity: async () => ({ entries: [] }),
    waveStatus: async () => ({
      provider: "none",
      ready: false,
      label: "Wave",
      reason: "",
    }),
  };
  // Anything else the console asks for answers with an empty object: this test
  // is about mounting, not about what the panels show.
  return {
    api: new Proxy(base, {
      get: (target, key) =>
        key in target ? target[key as string] : async () => ({}),
    }),
  };
});

it("mounts the console when the welcome frame is entered", async () => {
  vi.stubGlobal("__BUILD_STAMP__", { sha: "test", built: "test" });
  // jsdom has no ResizeObserver, and no canvas for the chart code.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  const gradient = { addColorStop() {} };
  const context2d = new Proxy(
    { measureText: () => ({ width: 10 }) } as Record<string, unknown>,
    {
      get: (target, key) => {
        const name = String(key);
        if (name in target) return target[name];
        // Gradients need an object to add stops to; every other call is a no-op.
        return name === "createLinearGradient" ||
          name === "createRadialGradient"
          ? () => gradient
          : () => undefined;
      },
      set: () => true,
    },
  );
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
    () => context2d as unknown as CanvasRenderingContext2D,
  );

  const { container } = render(<App />);
  const frame = container.querySelector("iframe");
  expect(frame).not.toBeNull();

  // Entering is the message the welcome document posts to its parent.
  window.dispatchEvent(
    new MessageEvent("message", {
      data: { type: "sulinoc:enter" },
      origin: window.location.origin,
      source: frame!.contentWindow,
    }),
  );

  await waitFor(() => expect(container.querySelector("iframe")).toBeNull());
  await waitFor(() =>
    expect(container.querySelector(".navigation-rail")).not.toBeNull(),
  );
  expect(container.querySelector(".app-shell")).not.toBeNull();
  expect(container.querySelector(".boot-screen")).toBeNull();
});
