import { expect, test } from "@playwright/test";
import { getCurrentProofMission } from "../src/lib/proof-missions/mission";

const mission = getCurrentProofMission();

test("contributor submits proof and reviewer queue updates", async ({ page }, testInfo) => {
  let hasSubmitted = false;
  let hasReviewed = false;
  const appErrors: string[] = [];

  page.on("console", (message) => {
    if (message.text().includes("geckoterminal.com")) return;
    if (message.type() === "error" && message.location().url.startsWith("http://127.0.0.1")) {
      appErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => appErrors.push(error.message));

  await page.route("**/api/auth/session", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      github_id: "123",
      github_username: "field-researcher",
      expires: "2099-01-01T00:00:00.000Z",
      user: { name: "field-researcher" },
    }),
  }));
  await page.route("**/api/v1/proof-missions/current?*", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      mission,
      isAcceptingSubmissions: true,
      accepted: [{
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        contributor: "chain-cartographer",
        evidenceUrl: "https://github.com/example/research/issues/1",
        evidenceNote: "Each owner label includes an explorer source, finalized slot, and an explicit confidence marker.",
        submittedAt: mission.startsAt,
        reviewedAt: mission.startsAt,
      }],
      reviewQueue: hasReviewed ? [] : [{
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        contributor: "wallet-sleuth",
        evidenceUrl: "https://github.com/example/research/issues/2",
        evidenceNote: "The report maps visible owners and keeps unresolved custody relationships marked as unknown.",
        submittedAt: mission.startsAt,
        reviewedAt: null,
        isOwn: false,
      }],
      leaderboard: [{ rank: 1, contributor: "chain-cartographer", acceptedProofs: 1, points: 100 }],
      counts: { accepted: 1, pending: hasReviewed ? Number(hasSubmitted) : 1 + Number(hasSubmitted) },
      viewer: {
        isSignedIn: true,
        hasLinkedWallet: true,
        canReview: true,
        submissionStatus: hasSubmitted ? "pending" : null,
      },
    }),
  }));
  await page.route("**/api/v1/proof-missions/submissions", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    hasSubmitted = true;
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id: "proof", status: "pending" }) });
  });
  await page.route("**/api/v1/proof-missions/submissions/*/reviews", async (route) => {
    hasReviewed = true;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ success: true, status: "pending" }) });
  });

  const response = await page.goto("/token/lckd", { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBeLessThan(400);
  const card = page.getByRole("heading", { name: "Map the visible owner set" }).locator("xpath=ancestor::section");
  await expect(card.getByRole("link", { name: "@chain-cartographer accepted" })).toBeVisible();
  await expect(card.getByRole("heading", { name: "Weekly leaderboard" })).toBeVisible();

  await card.getByLabel("Public evidence URL").fill("https://github.com/example/research/issues/3");
  await card.getByLabel("Method and limits").fill("Every wallet label includes a source and snapshot time. Unresolved owners remain marked unknown.");
  await card.getByRole("button", { name: "submit proof" }).click();
  await expect(card.getByText(/Two independent approvals are required/)).toBeVisible();

  await card.getByRole("button", { name: "approve" }).click();
  await expect(card.getByText("Queue clear.")).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  expect(appErrors).toEqual([]);
  await testInfo.attach(`${testInfo.project.name}-proof-missions.png`, {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
});
