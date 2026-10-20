import { expect, test } from "@playwright/test";

const transparentTile = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4//8/AwAI/AL+p5qgoAAAAABJRU5ErkJggg==",
  "base64",
);

test("Esri tile failures show a visible schematic status and retry can recover", async ({
  page,
}) => {
  let failTiles = true;
  let tileRequests = 0;
  await page.route(
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/**",
    async (route) => {
      tileRequests += 1;
      if (failTiles) {
        await route.abort();
      } else {
        await route.fulfill({
          status: 200,
          contentType: "image/png",
          body: transparentTile,
        });
      }
    },
  );

  await page.goto("/");
  const welcomeFrame = page.locator('iframe[title="SuliNOC welcome"]');
  const welcome = page.frameLocator('iframe[title="SuliNOC welcome"]');
  await expect(
    welcome.getByRole("heading", {
      name: "A clearer view of a connected city.",
    }),
  ).toBeVisible();

  for (const selector of [".hero-background", ".hero-tower"]) {
    await expect
      .poll(() =>
        welcome
          .locator(selector)
          .evaluate((element) => {
            const image = element as HTMLImageElement;
            return image.complete && image.naturalWidth > 0;
          }),
      )
      .toBe(true);
  }

  const loadedFonts = await welcome.locator("body").evaluate(async () => {
    const faces = await Promise.all(
      [
        "400 12px Manrope",
        "500 12px Manrope",
        "600 12px Newsreader",
        '500 12px "IBM Plex Mono"',
      ].map((font) => document.fonts.load(font)),
    );
    return faces.map((loaded) => loaded.length > 0);
  });
  expect(loadedFonts).toEqual([true, true, true, true]);

  await welcome.getByRole("button", { name: "Enter workspace" }).click();
  await expect(welcomeFrame).toHaveCSS("visibility", "hidden");
  await expect(welcomeFrame).toHaveCSS("pointer-events", "none");

  const mapStatus = page.locator(".map-mode");
  await expect(mapStatus).toBeVisible();
  await expect(mapStatus).toHaveCSS("display", "flex");
  await expect(
    page.getByText("Streets unavailable · schematic", { exact: true }),
  ).toBeVisible({ timeout: 20_000 });
  await expect(
    page.getByRole("button", { name: "Retry streets" }),
  ).toBeVisible();

  const failedRequestCount = tileRequests;
  failTiles = false;
  await page.getByRole("button", { name: "Retry streets" }).click();
  await expect.poll(() => tileRequests).toBeGreaterThan(failedRequestCount);
  await expect(
    page.getByText("Street map · Esri", { exact: true }),
  ).toBeVisible({ timeout: 20_000 });
});
