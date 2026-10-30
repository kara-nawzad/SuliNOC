import { afterEach, describe, expect, it, vi } from "vitest";
import { downsample, lineChart } from "./charts.js";

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

  it("spreads five in-window time labels across a 30-minute window", () => {
    let frame: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frame = callback;
      return 1;
    });

    const host = document.createElement("div");
    Object.defineProperty(host, "clientWidth", {
      configurable: true,
      value: 430,
    });
    document.body.append(host);
    const chart = lineChart(host);
    chart.setWindow(30);
    chart.setData([
      [600, 37.2],
      [605, 37.1],
      [610, 37.3],
      [615, 37.2],
      [620, 37.4],
      [625, 37.3],
      [630, 37.65],
    ]);
    frame?.(0);

    const labels = [...host.querySelectorAll("text.ax")];
    expect(labels.map((label) => label.textContent)).toEqual([
      "10:00",
      "10:07",
      "10:15",
      "10:22",
      "10:30",
    ]);
    // Every label sits inside the plot area, first flush left, last flush right.
    for (const label of labels) {
      const x = Number(label.getAttribute("x"));
      expect(x).toBeGreaterThanOrEqual(46);
      expect(x).toBeLessThanOrEqual(430 - 12);
    }
    expect(labels[0].getAttribute("text-anchor")).toBe("start");
    expect(labels.at(-1)?.getAttribute("text-anchor")).toBe("end");

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

describe("chart downsampling", () => {
  it("leaves a short series untouched", () => {
    const points = Array.from(
      { length: 40 },
      (_, i) => [i, i] as [number, number],
    );
    expect(downsample(points)).toBe(points);
  });

  it("thins a 2 000-sample window to ~300 points and keeps every peak", () => {
    const points = Array.from({ length: 2017 }, (_, i) => [
      i,
      40 + (i % 300 === 0 ? 12 : 0) - (i % 401 === 0 ? 9 : 0),
    ]) as [number, number][];
    const thinned = downsample(points, 300);
    expect(thinned.length).toBeLessThanOrEqual(300);
    // Flat stretches collapse to one point per bucket; the busy ones keep two.
    expect(thinned.length).toBeGreaterThan(140);
    const xs = thinned.map((point) => point[0]);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(new Set(xs).size).toBe(xs.length);
    const values = (list: [number, number][]) => list.map((point) => point[1]);
    expect(Math.max(...values(thinned))).toBe(Math.max(...values(points)));
    expect(Math.min(...values(thinned))).toBe(Math.min(...values(points)));
  });
});

describe("chart frames", () => {
  it("does not schedule a frame for an unchanged window or domain", () => {
    let frame: FrameRequestCallback | undefined;
    const raf = vi.fn((callback: FrameRequestCallback) => {
      frame = callback;
      return 1;
    });
    vi.stubGlobal("requestAnimationFrame", raf);

    const host = document.createElement("div");
    document.body.append(host);
    const chart = lineChart(host);
    const calls = () => raf.mock.calls.length;

    chart.setWindow(30);
    frame?.(0);
    expect(calls()).toBe(1);
    // Same window, same domain: nothing new to draw.
    chart.setWindow(30);
    expect(calls()).toBe(1);
    chart.setDomain(0, 3);
    frame?.(0);
    expect(calls()).toBe(2);
    chart.setDomain(0, 3);
    chart.setWindow(30);
    expect(calls()).toBe(2);
    chart.setWindow(1440);
    expect(calls()).toBe(3);

    chart.destroy();
    host.remove();
  });

  it("drops samples that scroll out of a fixed window when appending", () => {
    let frame: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frame = callback;
      return 1;
    });

    const host = document.createElement("div");
    document.body.append(host);
    const chart = lineChart(host);
    chart.setWindow(30);
    chart.setData([
      [0, 1],
      [10, 2],
      [20, 3],
    ]);
    frame?.(0);
    const points = () =>
      (host.querySelector(".ln")?.getAttribute("d")?.match(/[ML]/g) ?? [])
        .length;
    expect(points()).toBe(3);

    chart.append([45, 4]);
    frame?.(0);
    // Only the sample 30 ticks back survives from the appended one (45 - 30).
    expect(points()).toBe(2);

    chart.destroy();
    host.remove();
  });
});
