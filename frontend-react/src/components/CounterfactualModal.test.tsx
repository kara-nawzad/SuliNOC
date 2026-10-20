import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import report from "../../../reports/counterfactual_summary.json";
import { CounterfactualModal } from "./CounterfactualModal";
import type { Snapshot } from "../types/api";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("shows the canonical paired study with non-currency units and closes accessibly", () => {
  Object.defineProperty(window.HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = true;
    },
  });
  Object.defineProperty(window.HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.open = false;
    },
  });
  const onClose = vi.fn();
  const data = {
    ai: {
      ai_enabled: false,
      pre_empted: 0,
      false_dispatches: 0,
    },
  } as unknown as Snapshot;

  render(<CounterfactualModal data={data} onClose={onClose} />);

  expect(
    screen.getByRole("heading", {
      name: "A1 Autonomous Intent — Economic & Operational Impact",
    }),
  ).toBeInTheDocument();

  const armA = report.arms.A;
  const armC = report.arms.C;
  const costSaved = armA.cost_tower_min.mean - armC.cost_tower_min.mean;
  const costReductionPct = (costSaved / armA.cost_tower_min.mean) * 100;
  const crewHoursUsed = armC.crew_hours.mean - armA.crew_hours.mean;

  expect(
    screen.getByText(
      `${Math.round(costSaved).toLocaleString("en-US")} units lower · ${costReductionPct.toFixed(1)}%`,
    ),
  ).toBeInTheDocument();
  expect(
    screen.getByText(
      `+${armC.false_dispatches.mean.toFixed(1)} false dispatches`,
    ),
  ).toBeInTheDocument();
  expect(
    screen.getByText(`+${crewHoursUsed.toFixed(1)} h used · not saved`),
  ).toBeInTheDocument();
  expect(
    screen.getByText((_, element) =>
      element?.classList.contains("impact-callout")
        ? (element.textContent?.includes(
            `${report.headline.pct_of_clairvoyant_downtime_reduction.toFixed(1)}%`,
          ) ?? false)
        : false,
    ),
  ).toBeInTheDocument();
  expect(screen.getByText(/it is not USD/)).toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Close impact report" }));
  expect(onClose).toHaveBeenCalledOnce();
});
