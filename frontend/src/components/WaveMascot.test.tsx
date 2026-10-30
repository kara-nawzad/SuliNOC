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

  it("keeps the SVG transparent and lets the antenna, waves and tower extend past the frame", () => {
    const { container } = renderMascot("idle");
    const mascot = container.querySelector("svg");
    const frame = container.querySelector(".wave-ring--outer");
    const outerSignals = container.querySelectorAll(".wave-arc--outer");
    const antenna = container.querySelector(".wave-antenna-cap");
    const towerFoot = container.querySelector(".wave-tower-foot");

    expect(mascot).toHaveAttribute("viewBox", "0 0 280 280");
    expect(container.querySelector("image")).toBeNull();
    expect(frame).toHaveAttribute("cx", "140");
    expect(frame).toHaveAttribute("cy", "140");
    expect(frame).toHaveAttribute("r", "106");
    expect(outerSignals).toHaveLength(2);
    expect(outerSignals[0].getAttribute("d")).toContain("C13");
    expect(outerSignals[1].getAttribute("d")).toContain("C267");
    expect(antenna).toHaveAttribute("y", "10");
    expect(towerFoot?.getAttribute("d")).toContain("254");
  });

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

  it("moves Home, Settings and About to the header at every mobile width", () => {
    const mobileActions = styles.slice(
      styles.lastIndexOf("/* Mobile utility actions live in the header"),
      styles.indexOf(" * Wave assistant"),
    );
    expect(mobileActions).toContain("@media (max-width: 767px)");
    expect(mobileActions).toMatch(
      /\.app-shell \.phone-tools \{\s*display: flex;/,
    );
    expect(mobileActions).toMatch(
      /\.app-shell \.navigation-rail \.nav-bottom \{\s*display: none !important;/,
    );
  });

  it("keeps mobile alarm and Commander panels fixed with internal scrolling", () => {
    const finalMobileRules = styles.slice(
      styles.lastIndexOf("/* Final mobile sizing:"),
    );
    expect(finalMobileRules).toContain(
      "grid-template-rows: 400px auto !important;",
    );
    expect(finalMobileRules).toContain("height: 400px !important;");
    expect(finalMobileRules).toContain("height: 300px !important;");
    expect(finalMobileRules).toMatch(
      /\.app-shell \.alerts-rail \.incident-list \{[\s\S]*?overflow-y: auto !important;/,
    );
    expect(finalMobileRules).toMatch(
      /\.app-shell \.policy-panel \.policy-list \{[\s\S]*?overflow-y: auto !important;/,
    );
  });

  it("keeps the launcher transparent, circular, responsive and motion-safe", () => {
    expect(styles).toMatch(/\.wave-launcher\s*\{[^}]*border-radius:\s*50%/s);
    expect(styles).toMatch(
      /\.wave-assistant\s*\{[^}]*--wave-launcher-size:\s*88px/s,
    );
    expect(styles).toMatch(
      /\.wave-launcher\s*\{[^}]*background:\s*transparent/s,
    );
    expect(styles).toMatch(/button:not\(\.wave-launcher\)/);
    expect(styles).toMatch(/\.wave-launcher\s*\{[^}]*touch-action:\s*none/s);
    expect(styles).toMatch(
      /@media \(max-width: 767px\)[\s\S]*?--wave-launcher-size:\s*72px/,
    );
    // On phones the greeting sits beside the launcher, not stacked above it.
    expect(styles).toMatch(
      /@media \(max-width: 767px\)[\s\S]*?\.wave-greeting\s*\{[\s\S]*?right:\s*calc\(var\(--wave-launcher-right\)\s*\+\s*var\(--wave-launcher-size\)/,
    );
    expect(styles).toMatch(
      /@media \(max-width: 767px\)[\s\S]*?\.wave-greeting\s*\{[\s\S]*?max-width:\s*min\(232px,/,
    );
    expect(styles).toMatch(
      /@media \(max-width: 767px\)[\s\S]*?\.wave-panel\s*\{[\s\S]*?width:\s*min\(400px,/,
    );
    expect(styles).toContain("@media (max-width: 380px)");
    expect(styles).not.toContain(".wave-alert-badge");
    expect(styles).toContain("wave-idle-float 6.8s");
    expect(styles).toContain("wave-blink 6.2s");
    expect(styles).toContain("wave-smile-breathe");
    expect(styles).toContain("wave-antenna-breathe");
    expect(styles).toContain("wave-signal-idle");
    expect(styles).toContain("wave-greeting-enter");
    expect(styles).toMatch(
      /@media \(max-width: 767px\)[\s\S]*?\.wave-greeting\s*\{/,
    );
    expect(styles).toContain(".wave-mascot--thinking .wave-signal-arcs");
    expect(styles).toContain(".wave-mascot--alert .wave-ring--outer");
    expect(styles).toContain(".wave-launcher.is-open .wave-launcher-mascot *");
    const reducedMotion = styles.slice(
      styles.lastIndexOf("@media (prefers-reduced-motion: reduce)"),
    );
    expect(reducedMotion).toMatch(/animation:\s*none !important/);
    expect(reducedMotion).toContain(".wave-greeting");
    expect(reducedMotion).toContain("transition-duration: 0.01ms !important");
  });
});

function renderMascot(expression: WaveExpression) {
  return render(<WaveMascot expression={expression} />);
}
