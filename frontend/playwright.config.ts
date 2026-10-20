import { defineConfig } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: process.env.AUTONOC_TEST_URL ?? "http://127.0.0.1:8000",
    viewport: { width: 1512, height: 982 },
    launchOptions: process.env.CHROMIUM_PATH
      ? {
          executablePath: process.env.CHROMIUM_PATH,
          args: [
            "--no-sandbox",
            "--disable-dev-shm-usage",
            "--no-zygote",
            "--use-gl=angle",
            "--use-angle=swiftshader",
            "--enable-unsafe-swiftshader",
          ],
        }
      : {},
    trace: "retain-on-failure",
  },
  webServer: process.env.AUTONOC_TEST_URL
    ? undefined
    : {
        command:
          "python -m uvicorn autonoc.api.main:app --host 127.0.0.1 --port 8000",
        cwd: repositoryRoot,
        url: "http://127.0.0.1:8000/api/health",
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
      },
});
