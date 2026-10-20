import { expect, it } from "vitest";
import report from "../../../reports/counterfactual_summary.json";
import {
  counterfactualDeltas,
  counterfactualStudy,
} from "./counterfactualStudy";

it("projects every arm and headline directly from the committed M7 report", () => {
  expect(counterfactualStudy.seeds).toBe(report.meta.n_seeds);
  expect(counterfactualStudy.simulatedDaysPerSeed).toBe(report.meta.days);
  expect(counterfactualStudy.clairvoyantDowntimeHeadroomCapturedPct).toBe(
    report.headline.pct_of_clairvoyant_downtime_reduction,
  );

  for (const name of ["A", "B", "C", "D"] as const) {
    const source = report.arms[name];
    const displayed = counterfactualStudy.arms[name];
    expect(displayed.availabilityPct).toBe(source.availability.mean);
    expect(displayed.availabilityCi95).toBe(source.availability.ci95);
    expect(displayed.downtimeTowerMinutes).toBe(source.downtime_tower_min.mean);
    expect(displayed.preemptedEpisodes).toBe(source.pre_empted.mean);
    expect(displayed.falseDispatches).toBe(source.false_dispatches.mean);
    expect(displayed.crewHours).toBe(source.crew_hours.mean);
    expect(displayed.crewHoursCi95).toBe(source.crew_hours.ci95);
    expect(displayed.costTowerMinutes).toBe(source.cost_tower_min.mean);
    expect(displayed.costCi95).toBe(source.cost_tower_min.ci95);
  }

  expect(counterfactualDeltas.preemptedEpisodes).toBe(
    report.arms.C.pre_empted.mean - report.arms.A.pre_empted.mean,
  );
  expect(counterfactualDeltas.falseDispatches).toBe(
    report.arms.C.false_dispatches.mean - report.arms.A.false_dispatches.mean,
  );
  expect(counterfactualDeltas.crewHours).toBe(
    report.arms.C.crew_hours.mean - report.arms.A.crew_hours.mean,
  );
  expect(counterfactualDeltas.costTowerMinutes).toBe(
    report.arms.A.cost_tower_min.mean - report.arms.C.cost_tower_min.mean,
  );
  expect(counterfactualDeltas.advisoryDowntimeTowerMinutes).toBe(
    report.arms.A.downtime_tower_min.mean -
      report.arms.B.downtime_tower_min.mean,
  );
});
