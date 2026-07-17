import assert from "node:assert/strict";
import test from "node:test";
import {
  canCreateLaunch,
  isLaunchTestUser,
  shouldEnablePublicLaunches,
} from "./launchAvailability";

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

test("launch canary matches only exact immutable GitHub IDs", () => {
  const environment = { LAUNCH_TEST_GITHUB_IDS: "234659949, 42,234659949" };
  assert.equal(isLaunchTestUser("234659949", environment), true);
  assert.equal(isLaunchTestUser("42", environment), true);
  assert.equal(isLaunchTestUser("23465994", environment), false);
  assert.equal(isLaunchTestUser("rickzsol", environment), false);
});

test("launch canary fails closed for missing or malformed configuration", () => {
  assert.equal(isLaunchTestUser("42", {}), false);
  assert.equal(isLaunchTestUser("42", { LAUNCH_TEST_GITHUB_IDS: "" }), false);
  assert.equal(isLaunchTestUser("42", { LAUNCH_TEST_GITHUB_IDS: "42,invalid" }), false);
  assert.equal(isLaunchTestUser("42", { LAUNCH_TEST_GITHUB_IDS: "42," }), false);
});

test("launch creation accepts either an enabled public runtime or a canary user", () => {
  assert.equal(canCreateLaunch("7", {
    NODE_ENV: "production",
    VERCEL_ENV: "preview",
    PUBLIC_LAUNCHES_ENABLED: "true",
  }), true);
  assert.equal(canCreateLaunch("7", {
    NODE_ENV: "production",
    VERCEL_ENV: "production",
    LAUNCH_TEST_GITHUB_IDS: "7",
  }), true);
  assert.equal(canCreateLaunch("8", {
    NODE_ENV: "production",
    VERCEL_ENV: "production",
    LAUNCH_TEST_GITHUB_IDS: "7",
  }), false);
});
