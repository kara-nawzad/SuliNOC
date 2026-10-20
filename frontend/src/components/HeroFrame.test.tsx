import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";

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
  expect(html).not.toContain('class="hero-tower"');
  expect(html).not.toContain("hero-tower-cutout.webp");
  expect(html).toContain("newsreader-latin-600-normal.woff2");
  expect(html).toContain("manrope-latin-500-normal.woff2");
  expect(html).toContain("ibm-plex-mono-latin-500-normal.woff2");
  expect(html).not.toMatch(/<script\b[^>]*\bsrc=|leaflet-entry\.js|CARTO/i);
});
