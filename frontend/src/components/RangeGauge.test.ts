import { describe, expect, it } from "vitest";
import { gaugeState } from "./RangeGauge";

// Thresholds copied from the backend's GAUGE_SPECS (autonoc/engine/config.py).
const rsrp = { lo: -130, hi: -50, good: -80, warn: -100, bad: -115, lower_bad: true };
const vswr = { lo: 1, hi: 3, good: 1.3, warn: 1.5, bad: 2, lower_bad: false };

describe("gaugeState", () => {
  it("fails low readings for lower-is-bad metrics", () => {
    expect(gaugeState(-70, rsrp)).toBe("ok");
    expect(gaugeState(-90, rsrp)).toBe("warn");
    expect(gaugeState(-120, rsrp)).toBe("bad");
  });
  it("fails high readings for higher-is-bad metrics", () => {
    expect(gaugeState(1.1, vswr)).toBe("ok");
    expect(gaugeState(1.4, vswr)).toBe("warn");
    expect(gaugeState(2.4, vswr)).toBe("bad");
  });
});
