import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { getCurrentProofMission } from "../src/lib/proof-missions/mission";

const LCKD_MINT = "7UTubJ3W6JWwLUj82B9LgHFDmc8wFWtSNLis6u8epump";

test("generic token detail keeps the research workspace after the market chart", () => {
  const source = readFileSync(
    new URL("../src/app/token/[id]/TokenDetailClient.tsx", import.meta.url),
    "utf8",
  );
  expect(source.indexOf("<MarketChart")).toBeGreaterThan(-1);
  expect(source.indexOf("<TokenResearchWorkspace")).toBeGreaterThan(source.indexOf("<MarketChart"));
});

test("token trade readiness evidence and routes render", async ({ page }, testInfo) => {
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

  const mission = getCurrentProofMission();
  await page.route("**/api/v1/proof-missions/current?*", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      mission,
      isAcceptingSubmissions: false,
      accepted: [],
      reviewQueue: [],
      leaderboard: [],
      counts: { accepted: 0, pending: 0 },
      viewer: { isSignedIn: false, hasLinkedWallet: false, canReview: false, submissionStatus: null },
    }),
  }));

  await page.route(/\/api\/v1\/token\/[^/]+\/trade-readiness\?view=evidence$/, (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      mintAddress: LCKD_MINT,
      market: {
        asOf: "2026-07-20T15:00:00.000Z",
        dex: "pumpswap",
        liquidityUsd: 14471.53,
        pairAddress: "test-pair",
        pairCreatedAt: "2026-07-18T00:00:00.000Z",
        status: "caution",
      },
      onchain: {
        asOf: "2026-07-20T15:00:00.000Z",
        authorities: { freezeAuthority: null, mintAuthority: null, status: "verified" },
        concentration: { accountsRequested: 20, ownersAnalyzed: 15, status: "caution", topTenOwnerPercent: 46.4854 },
        decimals: 6,
        extensions: { names: ["metadataPointer", "tokenMetadata"], flagged: [], status: "verified" },
        program: "Token-2022",
        slot: 433700000,
      },
    }),
  }));
  await page.route(/\/api\/v1\/token\/[^/]+\/trade-readiness\?view=quotes$/, (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      asOf: "2026-07-20T15:00:00.000Z",
      mintAddress: LCKD_MINT,
      buys: [0.1, 0.5, 1].map((amountSol) => ({
        amountSol,
        estimatedTokenRaw: String(Math.round(amountSol * 2_000_000_000)),
        impactPercent: amountSol,
        router: "iris",
        status: "available",
      })),
      reverse: { estimatedSol: 0.0972, isAvailable: true, retainedPercent: 97.2, router: "iris" },
    }),
  }));

  const response = await page.goto("/token/lckd", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBeLessThan(400);

  const card = page.getByRole("heading", { name: "Trade readiness" }).locator("xpath=ancestor::section");
  const workspace = page.getByTestId("token-research-workspace");
  await expect(workspace.getByRole("heading", { name: "Read the market. Verify the evidence." })).toBeVisible();
  const isBelowChart = await page.getByRole("region", { name: "Interactive market-cap chart" }).evaluate((chart) => {
    const researchWorkspace = document.querySelector('[data-testid="token-research-workspace"]');
    return Boolean(researchWorkspace && (
      chart.compareDocumentPosition(researchWorkspace) & Node.DOCUMENT_POSITION_FOLLOWING
    ));
  });
  expect(isBelowChart).toBe(true);
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
