import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { WaveExpression } from "../types/wave";
import { WaveMascot } from "./WaveMascot";

afterEach(cleanup);

describe("Wave mascot expressions", () => {
  it.each([
    "idle",
    "thinking",
    "alert",
    "focused",
    "excited",
    "offline",
  ] as const)(
    "renders the %s tower expression accessibly",
    (expression: WaveExpression) => {
      const { container } = render(<WaveMascot expression={expression} />);
      const mascot = screen.getByRole("img", {
        name: `Wave, ${expression} expression`,
      });

      expect(mascot).toBeInTheDocument();
      expect(container.querySelector(`.wave-mascot--${expression}`)).toBe(
        mascot,
      );
      expect(container.querySelector("linearGradient")).toBeInTheDocument();
      expect(container.querySelectorAll("path").length).toBeGreaterThan(6);
    },
  );
});
