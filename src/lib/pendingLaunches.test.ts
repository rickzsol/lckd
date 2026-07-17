import assert from "node:assert/strict";
import test from "node:test";
import { getPendingManualLaunch, PENDING_MANUAL_LAUNCHES } from "./pendingLaunches";

test("manual LCKD listing remains separate from verified token records", () => {
  const [launch] = PENDING_MANUAL_LAUNCHES;

  assert.equal(PENDING_MANUAL_LAUNCHES.length, 1);
  assert.equal(launch.status, "pending_manual_launch");
  assert.equal(launch.contractAddress, null);
  assert.equal(launch.ticker, "$Lckd");
  assert.equal(launch.image, "/lckd-token.png");
});

test("resolves a pending launch by its directory id", () => {
  assert.equal(getPendingManualLaunch("lckd-manual-launch")?.ticker, "$Lckd");
  assert.equal(getPendingManualLaunch("missing"), null);
});

test("manual LCKD listing exposes only its approved HTTPS links", () => {
  const [launch] = PENDING_MANUAL_LAUNCHES;
  const expectedHosts = ["lckd.tech", "x.com", "github.com"];

  assert.deepEqual(
    Object.values(launch.links).map((value) => {
      const url = new URL(value);
      assert.equal(url.protocol, "https:");
      return url.hostname;
    }),
    expectedHosts,
  );
});
