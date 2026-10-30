import { describe, expect, it } from "vitest";
import type { Config, NodeData, Snapshot } from "../types/api";
import { sameSiteNodes, siteTooltipHtml } from "./NetworkMap";
import { sameTowerRow, sameTowerRows } from "./TowerList";

/** Telemetry replaces every node object every second. These tests pin the
 * slice comparators: a field that is rendered but missing from a comparator
 * would freeze on screen (stale UI), so each rendered field must appear. */
function node(overrides: Partial<NodeData> & { id: string }): NodeData {
  return {
    lat: 35.5,
    lon: 45.4,
    status: 0,
    warn: false,
    vswr: 1.2,
    prb: 40,
    cqi: 12,
    ring: 1,
    ...overrides,
  } as NodeData;
}

const configA = {} as Config;
const configB = {} as Config;
const select = (id: string) => id;
const otherSelect = (id: string) => id;

function rowsProps(nodes: NodeData[], config: Config, onSelect = select) {
  return { data: { nodes } as unknown as Snapshot, config, onSelect };
}

describe("site slice (map canvas layer)", () => {
  it("treats fresh objects with identical fields as unchanged", () => {
    const before = [node({ id: "S1" }), node({ id: "S2" })];
    const after = [node({ id: "S1" }), node({ id: "S2" })];
    expect(before[0]).not.toBe(after[0]);
    expect(sameSiteNodes(before, after)).toBe(true);
  });

  it("re-renders when everything the dot draws changes", () => {
    for (const changed of [
      { lat: 35.6 },
      { lon: 45.5 },
      { status: 3 },
      { warn: true },
    ]) {
      const before = [node({ id: "S1" })];
      const after = [node({ id: "S1", ...changed })];
      expect(sameSiteNodes(before, after), JSON.stringify(changed)).toBe(false);
    }
  });

  it("ignores tooltip-only values: prb and vswr never redraw a marker", () => {
    // Real ticks move prb for ~298/300 sites and vswr for ~137/300 — none of
    // that changes a 12 px dot, so none of it may re-render the 300 markers.
    const before = [node({ id: "S1", prb: 62.31, vswr: 1.871 })];
    for (const changed of [
      { prb: 62.34 }, // sub-precision
      { prb: 66 }, // a whole displayed unit
      { vswr: 1.879 },
      { vswr: 2.4 },
    ]) {
      const after = [node({ id: "S1", ...changed })];
      expect(sameSiteNodes(before, after), JSON.stringify(changed)).toBe(true);
    }
  });

  it("re-renders when the list length or ids change", () => {
    expect(sameSiteNodes([node({ id: "S1" })], [])).toBe(false);
    expect(sameSiteNodes([node({ id: "S1" })], [node({ id: "S2" })])).toBe(
      false,
    );
  });
});

describe("tower table slice", () => {
  it("treats fresh objects with identical rendered fields as unchanged", () => {
    expect(
      sameTowerRows(
        rowsProps([node({ id: "S1", prb: 51.5, cqi: 9 })], configA),
        rowsProps([node({ id: "S1", prb: 51.5, cqi: 9 })], configA),
      ),
    ).toBe(true);
  });

  it("ignores a PRB change that prints the same number", () => {
    expect(
      sameTowerRow(
        node({ id: "S1", prb: 62.31 }),
        node({ id: "S1", prb: 62.34 }),
      ),
    ).toBe(true);
    // ...but a change that moves the printed tenth still re-renders.
    expect(
      sameTowerRow(
        node({ id: "S1", prb: 62.31 }),
        node({ id: "S1", prb: 62.4 }),
      ),
    ).toBe(false);
  });

  it("keeps sorting correct: a status flip always counts as changed", () => {
    // Rows read faulty-first, so the row that changes status must re-render —
    // otherwise it would keep the old position and the old status colour.
    expect(
      sameTowerRows(
        rowsProps([node({ id: "S1", status: 0 })], configA),
        rowsProps([node({ id: "S1", status: 3 })], configA),
      ),
    ).toBe(false);
  });

  it("re-renders when a rendered column changes", () => {
    for (const changed of [
      { status: 4 },
      { prb: 62.2 },
      { cqi: 7 },
      { ring: 3 },
    ]) {
      expect(
        sameTowerRows(
          rowsProps([node({ id: "S1" })], configA),
          rowsProps([node({ id: "S1", ...changed })], configA),
        ),
        JSON.stringify(changed),
      ).toBe(false);
    }
  });

  it("re-renders when the config or the select handler changes", () => {
    const nodes = [node({ id: "S1" })];
    expect(
      sameTowerRows(rowsProps(nodes, configA), rowsProps(nodes, configB)),
    ).toBe(false);
    expect(
      sameTowerRows(
        rowsProps(nodes, configA),
        rowsProps(nodes, configA, otherSelect),
      ),
    ).toBe(false);
  });
});

describe("site tooltip (one shared tooltip for 300 sites)", () => {
  const config = {
    status_names: { 0: "Healthy", 3: "Critical fault" },
    metric_labels: { vswr: "VSWR", prb: "PRB load" },
  } as unknown as Config;

  it("renders exactly the content the per-marker tooltip used to", () => {
    const html = siteTooltipHtml(
      node({ id: "SLY-032", status: 3, vswr: 1.87, prb: 62.35 }),
      config,
    );
    expect(html).toBe(
      "<strong>SLY-032</strong><br>Critical fault<br>VSWR 1.87 · PRB load 62.4%",
    );
  });

  it("escapes site ids instead of injecting markup", () => {
    expect(siteTooltipHtml(node({ id: "<b>x</b>" }), config)).toContain(
      "&lt;b&gt;x&lt;/b&gt;",
    );
  });
});
