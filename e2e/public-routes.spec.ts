import { expect, test } from "@playwright/test";

const PUBLIC_ROUTES = [
  { path: "/", heading: /Builders who ship/i, title: /Solana token launch workflow/i },
  { path: "/feed", heading: /Launch directory/i, title: /Launch directory/i },
  { path: "/risk", heading: /Risk disclosure/i, title: /Risk disclosure/i },
  {
    path: "/api-docs",
    heading: /Public data, explicit boundaries/i,
    title: /REST API reference/i,
  },
] as const;

for (const route of PUBLIC_ROUTES) {
  test(`${route.path} renders successfully`, async ({ page }, testInfo) => {
    const browserErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      const location = message.location();
      const source = location.url ? ` (${location.url}:${location.lineNumber})` : "";
      browserErrors.push(`console: ${message.text()}${source}`);
    });
    page.on("pageerror", (error) => browserErrors.push(`pageerror: ${error.message}`));

    const response = await page.goto(route.path, { waitUntil: "domcontentloaded" });

    expect(response, `${route.path} did not return a document response`).not.toBeNull();
    expect(response?.status(), `${route.path} returned an error status`).toBeLessThan(400);
    await expect(page.getByRole("heading", { level: 1, name: route.heading })).toBeVisible();
    await expect(page).toHaveTitle(route.title);

    const horizontalOverflow = await page.evaluate(() => {
      const root = document.documentElement;
      const body = document.body;
      return Math.max(root.scrollWidth, body.scrollWidth) - root.clientWidth;
    });
    expect(horizontalOverflow, `${route.path} has horizontal overflow`).toBeLessThanOrEqual(0);

    const routeName = route.path === "/" ? "home" : route.path.slice(1).replaceAll("/", "-");
    await testInfo.attach(`${testInfo.project.name}-${routeName}.png`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });

    expect(browserErrors, `${route.path} emitted browser errors`).toEqual([]);
  });
}
