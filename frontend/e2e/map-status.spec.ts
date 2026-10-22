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
  const heroHeading = welcome.getByRole("heading", {
    name: "See your network before it breaks.",
  });
  await expect(heroHeading).toBeVisible();
  await expect(welcome.locator(".top-meta, .hero-shade")).toHaveCount(0);
  const copyTextShadows = await welcome
    .locator(".hero-copy")
    .evaluate((element) => {
      const heading = element.querySelector("h1");
      const lede = element.querySelector(".lede");
      return [
        getComputedStyle(heading!).textShadow,
        getComputedStyle(lede!).textShadow,
      ];
    });
  expect(copyTextShadows.every((shadow) => shadow !== "none")).toBe(true);
  await expect(welcome.locator(".hero-feature")).toHaveCount(3);
  await expect(welcome.locator(".hero-features")).toHaveCSS(
    "border-top-width",
    "0px",
  );
  await expect(welcome.locator(".hero-highlight")).toHaveCSS(
    "color",
    "rgb(82, 211, 231)",
  );
  const heroFontSizes = await welcome
    .locator("h1, .lede")
    .evaluateAll((elements) =>
      elements.map((element) =>
        Number.parseFloat(getComputedStyle(element).fontSize),
      ),
    );
  expect(heroFontSizes[0]).toBeGreaterThan(heroFontSizes[1] * 2);
  const enterButton = welcome.getByRole("button", { name: "Enter workspace" });
  await expect(enterButton).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await enterButton.hover();
  await expect(enterButton).toHaveCSS("background-color", "rgb(255, 255, 255)");
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
      ["400 12px Manrope", "500 12px Manrope", '500 12px "IBM Plex Mono"'].map(
        (font) => document.fonts.load(font),
      ),
    );
    return faces.map((loaded) => loaded.length > 0);
  });
  expect(loadedFonts).toEqual([true, true, true]);

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
    "Active incidents",
    "Site power alarms",
    "QCI 9 throughput",
    "E-RAB drop rate",
  ]);

  await expect(page.locator(".kpi-grid [data-panel-info]")).toHaveCount(6);
  await expect(
    page.locator(".panel-heading-actions [data-panel-info]"),
  ).toHaveCount(8);
  await expect(
    page.locator(".ring-list-heading [data-panel-info]"),
  ).toHaveCount(1);
  const infoControlMetrics = await page
    .locator("[data-panel-info]")
    .evaluateAll((buttons) =>
      buttons.map((button) => {
        const style = getComputedStyle(button);
        const icon = button.querySelector("svg");
        return {
          width: style.width,
          height: style.height,
          iconWidth: icon ? getComputedStyle(icon).width : "missing",
        };
      }),
    );
  expect(
    infoControlMetrics.every(
      ({ width, height, iconWidth }) =>
        ["26px", "30px", "44px"].includes(width) &&
        height === width &&
        iconWidth === "14px",
    ),
  ).toBe(true);
  await page
    .locator('.kpi-card [data-panel-info="Network availability"]')
    .click();
  const panelInfoDialog = page.getByRole("dialog", {
    name: "Network availability",
  });
  await expect(panelInfoDialog).toBeVisible();
  await expect(panelInfoDialog).toHaveAttribute("open", "");
  await expect(panelInfoDialog).toContainText(
    "share of sites that are in service",
  );
  const backdropStyle = await panelInfoDialog.evaluate((dialog) => ({
    color: getComputedStyle(dialog, "::backdrop").backgroundColor,
    filter: getComputedStyle(dialog, "::backdrop").backdropFilter,
  }));
  expect(backdropStyle).toEqual({
    color: "rgba(16, 38, 92, 0.38)",
    filter: "blur(4px)",
  });
  const closeInfoButton = panelInfoDialog.getByRole("button", {
    name: "Close dialog",
  });
  const closeButtonMetrics = await closeInfoButton.evaluate((button) => {
    const style = getComputedStyle(button);
    const icon = button.querySelector("svg");
    return {
      width: style.width,
      height: style.height,
      iconWidth: icon ? getComputedStyle(icon).width : "missing",
    };
  });
  expect(["24px", "44px"]).toContain(closeButtonMetrics.width);
  expect(closeButtonMetrics.height).toBe(closeButtonMetrics.width);
  expect(closeButtonMetrics.iconWidth).toBe("14px");
  await closeInfoButton.click();
  await expect(panelInfoDialog).toBeHidden();

  const powerCard = page
    .locator(".kpi-card")
    .filter({ hasText: "Site power alarms" });
  await expect(powerCard.locator(".kpi-note")).toContainText(
    /Run total: \d+ ATS · \d+ thefts/,
  );
  await powerCard.locator("[data-panel-info]").click();
  const powerInfoDialog = page.getByRole("dialog", {
    name: "Site power alarms",
  });
  await expect(powerInfoDialog).toContainText(
    "cumulative count for the current simulation run",
  );
  await expect(powerInfoDialog).toContainText(
    "not the number of sites currently failing",
  );
  await expect(powerInfoDialog).toContainText(
    "it does not guarantee that every site currently has power",
  );
  await powerInfoDialog.getByRole("button", { name: "Close dialog" }).click();
  await expect(powerInfoDialog).toBeHidden();

  const towerTable = page.locator(".tower-table");
  const towerHeader = towerTable.locator(".tower-head");
  await towerTable.evaluate((table) => {
    table.scrollTop = 120;
  });
  await expect(towerHeader).toHaveCSS("position", "sticky");
  await expect(towerHeader).toHaveCSS("z-index", "2");
  await expect(towerHeader).toHaveCSS("opacity", "1");
  await expect(towerHeader).toHaveCSS("background-color", "rgb(234, 243, 254)");

  const mapStyleGroup = page.getByRole("group", { name: "Map style" });
  const selectedMapStyle = mapStyleGroup.getByRole("button", { name: "Map" });
  await expect(selectedMapStyle).toBeVisible();
  await expect(selectedMapStyle).toHaveCSS(
    "background-color",
    "rgb(255, 255, 255)",
  );
  for (const label of ["Map layers", "Reset map view"]) {
    const control = page.getByRole("button", { name: label });
    await expect(control).toBeVisible();
    await expect(control).toHaveCSS("background-color", "rgb(255, 255, 255)");
  }
  const layersButton = page.getByRole("button", { name: "Map layers" });
  await layersButton.click();
  await expect(
    page.locator(".layer-menu input[type=checkbox]").first(),
  ).toHaveCSS("accent-color", "rgb(20, 121, 196)");
  await layersButton.click();

  const mapStatus = page.locator(".map-mode");
  await expect(mapStatus).toBeVisible();
  await expect(mapStatus).toHaveCSS("display", "flex");
  await expect(page.getByRole("button", { name: "Expand map" })).toHaveCount(0);
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
  await expect(page.locator(".map-stage")).toHaveAttribute(
    "data-street-status",
    "ready",
    { timeout: 20_000 },
  );
  await expect(page.locator(".map-mode")).toHaveCount(0);

  await page.setViewportSize({ width: 700, height: 900 });
  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  const phoneTools = page.locator(".phone-tools");
  await expect(phoneTools).toBeVisible();
  await expect(phoneTools.getByRole("button")).toHaveCount(3);
  await expect(navigation.locator(".nav-bottom")).toBeHidden();
  await expect(navigation).toHaveCSS("flex-direction", "row");
  await expect(navigation.locator(".nav-items")).toHaveCSS(
    "flex-direction",
    "row",
  );
  const navItemTops = await navigation
    .locator(".nav-items .nav-item")
    .evaluateAll((items) =>
      items.map((item) => Math.round(item.getBoundingClientRect().top)),
    );
  expect(new Set(navItemTops).size).toBe(1);

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".phone-tools")).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "Main navigation" })
      .locator(".nav-bottom"),
  ).toBeHidden();
  const incidentPanel = page.locator(".alerts-rail .alarms-panel");
  await expect(incidentPanel).toHaveCSS("height", "400px");
  const incidentList = incidentPanel.locator(".incident-list");
  await expect(incidentList).toHaveCSS("overflow-y", "auto");
  await incidentPanel
    .getByLabel("Filter alarm severity")
    .selectOption({ index: 1 });
  await expect(incidentPanel).toHaveCSS("height", "400px");

  await incidentPanel
    .getByRole("button", { name: "Open event history" })
    .click();
  const historyTabs = page.getByRole("tablist", { name: "History type" });
  await expect(historyTabs).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(historyTabs).toHaveCSS("border-top-width", "0px");
});
