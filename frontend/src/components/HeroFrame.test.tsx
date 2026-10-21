import { fireEvent, render, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { HeroFrame } from "./HeroFrame";

afterEach(() => vi.unstubAllGlobals());

it("keeps the iframe asset to a hero-only intro with the enter and skip hooks", () => {
  const html = readFileSync(
    join(process.cwd(), "public/assets/hero-source.html"),
    "utf8",
  );

  expect(html).toContain('<main id="hero"');
  expect(html).toContain('id="enter"');
  expect(html).toContain('id="skip"');
  expect(html).toContain('type: "sulinoc:enter"');
  expect(html).toContain("window.location.origin");
  expect(html).toContain("/assets/hero-city-sunset.jpg");
  expect(html).toContain('class="hero-logo"');
  expect(html).toContain('src="/assets/suli-noc-logo-dark.png"');
  expect(html).toContain("filter: brightness(0) invert(1)");
  expect(html).toContain("object-position: 74% center;");
  expect(html).not.toContain('class="hero-tower"');
  expect(html).not.toContain("hero-tower-cutout.webp");
  expect(html).toContain("newsreader-latin-600-normal.woff2");
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
