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
});
