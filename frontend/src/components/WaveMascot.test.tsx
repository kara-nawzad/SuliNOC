import { readFileSync } from "node:fs";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { WaveExpression } from "../types/wave";
import { WaveMascot } from "./WaveMascot";

afterEach(cleanup);

const styles = readFileSync("src/styles/app.css", "utf8");

describe("Wave mascot states", () => {
  it.each(["idle", "thinking", "responding", "alert", "offline"] as const)(
    "renders the reference character in the %s state",
    (expression: WaveExpression) => {
      const { container } = renderMascot(expression);
      const mascot = container.querySelector("svg");

      expect(mascot).toHaveAttribute("aria-label", `Wave, ${expression} state`);
      expect(container.querySelector(".wave-disc")).toBeInTheDocument();
      expect(container.querySelector(".wave-ring--outer")).toBeInTheDocument();
      expect(container.querySelectorAll(".wave-arc")).toHaveLength(4);
      expect(container.querySelector(".wave-antenna-cap")).toBeInTheDocument();
      expect(container.querySelectorAll(".wave-side-panel")).toHaveLength(2);
      expect(container.querySelector(".wave-face")).toBeInTheDocument();
      expect(container.querySelector(".wave-eyes")).toBeInTheDocument();
      expect(container.querySelector(".wave-smile")).toBeInTheDocument();
      expect(container.querySelector(".wave-tower-rail")).toBeInTheDocument();
      expect(container.querySelector(".wave-status-light")).toBeInTheDocument();
      expect(container.querySelector("linearGradient")).toBeInTheDocument();
    },
  );

  it("keeps the same face and tower geometry while the expression changes", () => {
    const { container, rerender } = renderMascot("idle");
    const facePaths = () =>
      Array.from(
        container.querySelectorAll(".wave-eyes path, .wave-smile"),
      ).map((path) => path.getAttribute("d"));
    const initial = facePaths();

    rerender(<WaveMascot expression="alert" />);
    expect(facePaths()).toEqual(initial);
    expect(container.querySelector(".wave-tower-rail")).toBeInTheDocument();
    expect(container.querySelector(".wave-signal-arcs")).toBeInTheDocument();
  });

  it("keeps the launcher circular, responsive and motion-safe", () => {
    expect(styles).toMatch(/\.wave-launcher\s*\{[^}]*border-radius:\s*50%/s);
    expect(styles).toMatch(
      /@media \(max-width: 600px\)[\s\S]*?\.wave-panel\s*\{[\s\S]*?width:\s*min\(400px,/,
    );
    expect(styles).toContain("@media (max-width: 380px)");
    const reducedMotion = styles.slice(
      styles.lastIndexOf("@media (prefers-reduced-motion: reduce)"),
    );
    expect(reducedMotion).toMatch(/animation:\s*none !important/);
    expect(reducedMotion).toContain("transition-duration: 0.01ms !important");
    expect(styles).toContain(".wave-mascot--thinking .wave-signal-arcs");
    expect(styles).toContain(".wave-mascot--alert .wave-ring--outer");
  });
});

function renderMascot(expression: WaveExpression) {
  return render(<WaveMascot expression={expression} />);
}
