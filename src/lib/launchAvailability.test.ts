import assert from "node:assert/strict";
import test from "node:test";
import { shouldEnablePublicLaunches } from "./launchAvailability";

test("enables launches only for an explicitly enabled local or preview runtime", () => {
  assert.equal(shouldEnablePublicLaunches({
    NODE_ENV: "development",
    PUBLIC_LAUNCHES_ENABLED: "true",
  }), true);
  assert.equal(shouldEnablePublicLaunches({
    NODE_ENV: "production",
    VERCEL_ENV: "preview",
    PUBLIC_LAUNCHES_ENABLED: "true",
  }), true);
});

test("production and unflagged runtimes always fail closed", () => {
  assert.equal(shouldEnablePublicLaunches({
    NODE_ENV: "production",
    VERCEL_ENV: "production",
    PUBLIC_LAUNCHES_ENABLED: "true",
  }), false);
  assert.equal(shouldEnablePublicLaunches({ NODE_ENV: "development" }), false);
  assert.equal(shouldEnablePublicLaunches({
    NODE_ENV: "production",
    PUBLIC_LAUNCHES_ENABLED: "true",
  }), false);
});
