import { afterEach, describe, expect, it, vi } from "vitest";
import { lineChart } from "./charts.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("chart x-axis window", () => {
  it.each([24 * 60, 7 * 24 * 60])(
    "anchors partial history at the left edge for a %i-minute window",
    (windowMinutes) => {
      let frame: FrameRequestCallback | undefined;
      vi.stubGlobal(
        "requestAnimationFrame",
        (callback: FrameRequestCallback) => {
          frame = callback;
          return 1;
        },
      );

      const host = document.createElement("div");
      document.body.append(host);
      const chart = lineChart(host);
      chart.setWindow(windowMinutes);
      chart.setData([
        [45, 20],
        [50, 22],
        [55, 21],
      ]);
      frame?.(0);

      const path = host.querySelector(".ln")?.getAttribute("d");
      expect(path).toMatch(/^M46\.0 /);

      chart.destroy();
      host.remove();
    },
  );

  it("uses compact, non-overlapping day labels for a 7-day window", () => {
    let frame: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frame = callback;
      return 1;
    });

    const host = document.createElement("div");
    Object.defineProperty(host, "clientWidth", {
      configurable: true,
      value: 720,
    });
    document.body.append(host);
    const chart = lineChart(host);
    chart.setWindow(7 * 24 * 60);
    chart.setData([
      [250, 20],
      [10_330, 22],
    ]);
    frame?.(0);

    const labels = [...host.querySelectorAll("text.ax")].map(
      (label) => label.textContent,
    );
    expect(labels).toEqual([
      "04:10 D1",
      "D2",
      "D3",
      "D4",
      "D5",
      "D6",
      "D7",
      "04:10 D8",
    ]);

    chart.destroy();
    host.remove();
  });

  it("shows only one endpoint label when a long window has one sample", () => {
    let frame: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frame = callback;
      return 1;
    });

    const host = document.createElement("div");
    document.body.append(host);
    const chart = lineChart(host);
    chart.setWindow(24 * 60);
    chart.setData([[60, 20]]);
    frame?.(0);

    expect(
      [...host.querySelectorAll("text.ax")].map((label) => label.textContent),
    ).toEqual(["01:00 D1"]);

    chart.destroy();
    host.remove();
  });
});
