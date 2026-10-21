import report from "../../../reports/counterfactual_summary.json";

type ArmName = keyof typeof report.arms;

const labels: Record<ArmName, string> = {
  A: "No AI · reactive dispatch",
  B: "Advisory · human approval",
  C: "Autonomous · SuliNOC Commander",
  D: "Clairvoyant · predictive upper bound",
};

function readArm(name: ArmName) {
  const arm = report.arms[name];
  return {
    label: labels[name],
    availabilityPct: arm.availability.mean,
    availabilityCi95: arm.availability.ci95,
    downtimeTowerMinutes: arm.downtime_tower_min.mean,
    preemptedEpisodes: arm.pre_empted.mean,
    falseDispatches: arm.false_dispatches.mean,
    crewHours: arm.crew_hours.mean,
    crewHoursCi95: arm.crew_hours.ci95,
    costTowerMinutes: arm.cost_tower_min.mean,
    costCi95: arm.cost_tower_min.ci95,
  };
}

/** Display projection of the committed M7 report; metrics stay in the JSON source. */
export const counterfactualStudy = {
  seeds: report.meta.n_seeds,
  simulatedDaysPerSeed: report.meta.days,
  clairvoyantDowntimeHeadroomCapturedPct:
    report.headline.pct_of_clairvoyant_downtime_reduction,
  arms: {
    A: readArm("A"),
    B: readArm("B"),
    C: readArm("C"),
    D: readArm("D"),
  },
} as const;

const { A, B, C } = counterfactualStudy.arms;

export const counterfactualDeltas = {
  availabilityPercentagePoints: C.availabilityPct - A.availabilityPct,
  downtimeTowerMinutes: A.downtimeTowerMinutes - C.downtimeTowerMinutes,
  preemptedEpisodes: C.preemptedEpisodes - A.preemptedEpisodes,
  falseDispatches: C.falseDispatches - A.falseDispatches,
  crewHours: C.crewHours - A.crewHours,
  costTowerMinutes: A.costTowerMinutes - C.costTowerMinutes,
  costReductionPct:
    ((A.costTowerMinutes - C.costTowerMinutes) / A.costTowerMinutes) * 100,
  advisoryDowntimeTowerMinutes: A.downtimeTowerMinutes - B.downtimeTowerMinutes,
  advisoryCostTowerMinutes: B.costTowerMinutes - A.costTowerMinutes,
} as const;
