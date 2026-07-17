import assert from "node:assert/strict";
import test from "node:test";
import {
  metadataDraftMatchesConfig,
  parseLaunchMetadataDraft,
  type LaunchMetadataDraft,
} from "./launchMetadataDraft";
import type { LaunchConfig } from "@/types/index";

const draft: LaunchMetadataDraft = {
  metadataUri: "https://example.com/metadata.json",
  imageUri: "https://example.com/token.png",
  name: "Retry Token",
  ticker: "RETRY",
  description: "Exact recovered metadata",
  twitterUrl: null,
  telegramUrl: null,
  websiteUrl: "https://example.com",
};

const config: LaunchConfig = {
  ...draft,
  image: null,
  buyAmountSol: 0.1,
  lockDurationDays: 30,
  lockPercentage: 99,
  githubUsername: "builder",
  githubRepo: null,
  liveUrl: null,
};

test("reuses an exact recovered metadata draft without a local File", () => {
  assert.deepEqual(parseLaunchMetadataDraft(draft), draft);
  assert.equal(metadataDraftMatchesConfig(draft, config), true);
});

test("invalidates recovered metadata when token metadata changes", () => {
  assert.equal(metadataDraftMatchesConfig(draft, { ...config, ticker: "CHANGED" }), false);
  assert.equal(parseLaunchMetadataDraft({ ...draft, imageUri: "javascript:alert(1)" }), null);
});
