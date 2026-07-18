import assert from "node:assert/strict";
import test from "node:test";
import {
  isOfficialTokenMint,
  OFFICIAL_TOKEN_IMAGE,
  OFFICIAL_MINT_ADDRESS,
  OFFICIAL_TOKEN_METADATA,
  OFFICIAL_TOKEN_PATH,
} from "./officialTokenRoute";

const MINT = "7UTubJ3W6JWwLUj82B9LgHFDmc8wFWtSNLis6u8epump";
const WATCHER_MINT = "11111111111111111111111111111111";

test("matches the pinned mint or current official watcher mint", () => {
  assert.equal(isOfficialTokenMint(OFFICIAL_MINT_ADDRESS, null), true);
  assert.equal(isOfficialTokenMint(MINT, { mintAddress: MINT }), true);
  assert.equal(isOfficialTokenMint(WATCHER_MINT, { mintAddress: WATCHER_MINT }), true);
  assert.equal(isOfficialTokenMint(WATCHER_MINT, null), false);
});

test("uses the stable official route as canonical metadata", () => {
  const images = OFFICIAL_TOKEN_METADATA.openGraph?.images;
  assert.equal(OFFICIAL_TOKEN_PATH, "/token/lckd");
  assert.equal(OFFICIAL_TOKEN_METADATA.alternates?.canonical, OFFICIAL_TOKEN_PATH);
  assert.equal(OFFICIAL_TOKEN_METADATA.openGraph?.url, OFFICIAL_TOKEN_PATH);
  assert.ok(JSON.stringify(images).includes(OFFICIAL_TOKEN_IMAGE));
});
