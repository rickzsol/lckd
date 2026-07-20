import { expect, test } from "@playwright/test";

const LCKD_MINT = "7UTubJ3W6JWwLUj82B9LgHFDmc8wFWtSNLis6u8epump";

test("real token trade readiness evidence and routes render", async ({ page }, testInfo) => {
  test.setTimeout(45_000);
  const appErrors: string[] = [];
  page.on("console", (message) => {
    if (message.text().includes("geckoterminal.com")) return;
    if (message.type() !== "error" || !message.location().url.startsWith("http://127.0.0.1")) return;
    appErrors.push(message.text());
  });
  page.on("pageerror", (error) => {
    if (!error.message.includes("geckoterminal.com")) appErrors.push(error.message);
  });

  const response = await page.goto(`/token/${LCKD_MINT}`, { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBeLessThan(400);

  const card = page.getByRole("heading", { name: "Trade readiness" }).locator("xpath=ancestor::section");
  await expect(card.getByText("Token-2022 controls parsed from finalized state.")).toBeVisible();
  await expect(card.getByText(/At least .*% of supply/)).toBeVisible();
  await expect(card.getByText(/pumpswap pair indexed/i)).toBeVisible();

  await card.getByRole("button", { name: "Check 3 routes" }).click();
  await expect(card.getByText(/SOL estimated back/)).toBeVisible({ timeout: 20_000 });
  await expect(card.getByText("0.1 SOL", { exact: true })).toBeVisible();
  await expect(card.getByText("0.5 SOL", { exact: true })).toBeVisible();
  await expect(card.getByText("1 SOL", { exact: true })).toBeVisible();
  for (const amount of [0.1, 0.5, 1]) {
    const preview = card.getByTestId(`buy-preview-${amount}`);
    await expect(preview).not.toContainText("Unknown");
    await expect(preview).toContainText(/\d+\.\d{2}% impact · \S+/);
  }

  const horizontalOverflow = await page.evaluate(() =>
    Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - document.documentElement.clientWidth,
  );
  expect(horizontalOverflow).toBeLessThanOrEqual(0);
  await testInfo.attach(`${testInfo.project.name}-trade-readiness.png`, {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
  expect(appErrors).toEqual([]);
});
