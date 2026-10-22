import { fireEvent, render, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { HeroFrame } from "./HeroFrame";

afterEach(() => vi.unstubAllGlobals());

it("keeps the hero copy, capability row, and Enter action in the intro", () => {
  const html = readFileSync(
    join(process.cwd(), "public/assets/hero-source.html"),
    "utf8",
  );

  expect(html).toContain('<main id="hero"');
  expect(html).toContain("See your network");
  expect(html).toContain('class="hero-highlight">before it breaks.</span>');
  expect(html).toContain(
    "AI-powered telecom operations for a more connected Sulaymaniyah.",
  );
  expect(html).toContain("Real-time monitoring");
  expect(html).toContain("AI-powered insights");
  expect(html).toContain("Fewer outages, more uptime");
  expect(html).toContain('aria-label="SuliNOC capabilities"');
  expect(html.indexOf('class="hero-features"')).toBeLessThan(
    html.indexOf('class="hero-actions"'),
  );
  expect(html).not.toContain("A clearer view of a connected city.");
  expect(html).toContain('id="enter"');
  expect(html).not.toContain('id="skip"');
  expect(html).not.toContain("Skip intro");
  expect(html).toContain('type: "sulinoc:enter"');
  expect(html).toContain("window.location.origin");
  expect(html).toContain("/assets/hero-city-sunset.png");
  expect(html).toContain('class="hero-logo"');
  expect(html).toContain('src="/assets/suli-noc-logo-dark.png"');
  expect(html).toContain("filter: brightness(0) invert(1)");
  expect(html).toContain("object-position: 74% center;");
  expect(html).toContain("font-size: clamp(48px, 5vw, 76px);");
  expect(html).toContain("color: #52d3e7;");
  expect(html).toContain("max-width: 470px;");
  expect(html).not.toContain('class="hero-shade"');
  expect(html).toContain(".hero-copy::before");
  expect(html).toContain("background: rgb(8 20 38 / 68%);");
  expect(html).toContain("backdrop-filter: blur(8px);");
  expect(html).not.toContain(".hero-topbar::before");
  expect(html).not.toContain("SIMULATED NETWORK · 300 MODELED SITES");
  expect(html).not.toContain("border-top: 1px solid rgb(168 238 226 / 38%);");
  expect(html).not.toContain('class="hero-tower"');
  expect(html).not.toContain("hero-tower-cutout.webp");
  expect(html).not.toContain("newsreader-latin-600-normal.woff2");
  expect(html).toContain("manrope-latin-500-normal.woff2");
  expect(html).toContain("ibm-plex-mono-latin-500-normal.woff2");
  expect(html).not.toMatch(/<script\b[^>]*\bsrc=|leaflet-entry\.js|CARTO/i);
});

it("keeps the welcome frame hidden until its document is ready", async () => {
  vi.stubGlobal("__BUILD_STAMP__", { sha: "test", built: "test" });
  const { container } = render(<HeroFrame open onEnter={vi.fn()} />);
  const frame = container.querySelector("iframe");

  expect(frame).not.toBeNull();
  expect(frame).toHaveStyle({ visibility: "hidden", pointerEvents: "none" });

  fireEvent.load(frame!);
  await waitFor(() =>
    expect(frame).toHaveStyle({ visibility: "visible", pointerEvents: "auto" }),
  );
});
