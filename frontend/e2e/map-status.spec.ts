import { expect, test } from "@playwright/test";

const transparentTile = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4//8/AwAI/AL+p5qgoAAAAABJRU5ErkJggg==",
  "base64",
);

test("Esri tile failures show a visible schematic status and retry can recover", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
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

  const heroResponsePromise = page.waitForResponse((response) =>
    response.url().includes("/assets/hero-source.html?"),
  );
  const configResponsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/api/config" && response.ok();
  });
  const initialDeltaPromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === "/api/delta" && response.ok();
  });
  await page.goto("/");
  const heroResponse = await heroResponsePromise;
  await Promise.all([configResponsePromise, initialDeltaPromise]);
  expect(heroResponse.headers()["cache-control"]).toBe("no-store");

  const welcomeFrame = page.locator('iframe[title="SuliNOC welcome"]');
  const welcome = page.frameLocator('iframe[title="SuliNOC welcome"]');
  await expect(welcomeFrame).toHaveAttribute(
    "src",
    /^\/assets\/hero-source\.html\?v=.+$/,
  );
  await expect(
    welcome.getByRole("heading", {
      name: "A clearer view of a connected city.",
    }),
  ).toBeVisible();
  await expect(page.locator(".app-shell, .boot-screen")).toHaveCount(0);
  await expect(page.locator("html")).toHaveCSS(
    "background-color",
    "rgb(8, 20, 38)",
  );
  await expect(welcomeFrame).toHaveCSS("visibility", "visible");
  const logo = welcome.locator(".hero-logo");
  await expect(logo).toHaveAttribute("src", "/assets/suli-noc-logo-dark.png");
  await expect
    .poll(() =>
      logo.evaluate((element) => {
        const image = element as HTMLImageElement;
        return image.complete && image.naturalWidth > 0;
      }),
    )
    .toBe(true);
  const mobileHeroPosition = await welcome
    .locator(".hero-background")
    .evaluate((element) => getComputedStyle(element).objectPosition);
  expect(mobileHeroPosition).toMatch(/^74%/);

  await expect
    .poll(() =>
      welcome.locator(".hero-background").evaluate((element) => {
        const image = element as HTMLImageElement;
        return image.complete && image.naturalWidth > 0;
      }),
    )
    .toBe(true);
  await expect(welcome.locator(".hero-tower")).toHaveCount(0);

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

  await page.setViewportSize({ width: 1280, height: 720 });
  await welcome.getByRole("button", { name: "Enter workspace" }).click();
  await expect(welcomeFrame).toHaveCSS("visibility", "hidden");
  await expect(welcomeFrame).toHaveCSS("pointer-events", "none");
  await expect(
    page.getByRole("navigation", { name: "Main navigation" }),
  ).toBeVisible();
  await expect(page.locator(".app-shell")).toHaveCSS(
    "background-color",
    "rgb(214, 231, 251)",
  );
  const kpiLabels = await page
    .locator(".kpi-grid .kpi-title > span")
    .allTextContents();
  expect(kpiLabels.map((label) => label.trim())).toEqual([
    "Network availability",
    "Sites operational",
    "Site power alarms",
    "QCI 9 throughput",
    "E-RAB drop rate",
    "Active incidents",
  ]);

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

  await page.setViewportSize({ width: 700, height: 900 });
  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  await expect(navigation).toHaveCSS("flex-direction", "row");
  await expect(navigation.locator(".nav-items")).toHaveCSS(
    "flex-direction",
    "row",
  );
  await expect(navigation.locator(".nav-bottom")).toHaveCSS(
    "flex-direction",
    "row",
  );
  const navItemTops = await navigation
    .locator(".nav-items .nav-item")
    .evaluateAll((items) =>
      items.map((item) => Math.round(item.getBoundingClientRect().top)),
    );
  const utilityItemTops = await navigation
    .locator(".nav-bottom .nav-item")
    .evaluateAll((items) =>
      items.map((item) => Math.round(item.getBoundingClientRect().top)),
    );
  expect(new Set(navItemTops).size).toBe(1);
  expect(new Set(utilityItemTops).size).toBe(1);

  await page.setViewportSize({ width: 390, height: 844 });
  const incidentPanel = page.locator(".alerts-rail .alarms-panel");
  await expect(incidentPanel).toHaveCSS("height", "400px");
  const incidentList = incidentPanel.locator(".incident-list");
  await expect(incidentList).toHaveCSS("overflow-y", "auto");
  await incidentPanel
    .getByLabel("Filter alarm severity")
    .selectOption({ index: 1 });
  await expect(incidentPanel).toHaveCSS("height", "400px");
});
