import { defineConfig, devices } from "@playwright/test";

const PORT = 3107;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [["github"], ["html", { open: "never", outputFolder: "output/playwright/report" }]]
    : [["list"], ["html", { open: "never", outputFolder: "output/playwright/report" }]],
  outputDir: "output/playwright/test-results",
  use: {
    baseURL: BASE_URL,
    // Production CSP upgrades local RSC prefetches to HTTPS, but this test server is HTTP-only.
    bypassCSP: true,
    screenshot: "only-on-failure",
    trace: "on-first-retry",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 5"] },
    },
  ],
  webServer: {
    command: `npm run start -- --hostname 127.0.0.1 --port ${PORT}`,
    env: {
      NEXTAUTH_URL: BASE_URL,
      NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET ?? "local-e2e-placeholder",
    },
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
