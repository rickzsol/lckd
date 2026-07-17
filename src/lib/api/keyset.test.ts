import assert from "node:assert/strict";
import test from "node:test";
import { decodeCursor, encodeCursor, keysetFilter, type UnlockCursor } from "./keyset";

const CURSOR: UnlockCursor = {
  cliffTs: "2026-01-01T00:00:00.000Z",
  mint: "So11111111111111111111111111111111111111112",
  id: "3f9a1c2e-4b5d-41a6-8c7e-9d0f1a2b3c4d",
};

test("decodeCursor rejects a non-uuid id (filter-injection guard)", () => {
  const badId = Buffer.from(
    "2026-01-01T00:00:00.000Z|So11111111111111111111111111111111111111112|lock-42",
    "utf8",
  ).toString("base64url");
  assert.equal(decodeCursor(badId), null);
});

test("decodeCursor rejects a non-base58 mint (filter-injection guard)", () => {
  const badMint = Buffer.from(
    "2026-01-01T00:00:00.000Z|not),status.eq.withdrawn|3f9a1c2e-4b5d-41a6-8c7e-9d0f1a2b3c4d",
    "utf8",
  ).toString("base64url");
  assert.equal(decodeCursor(badMint), null);
});

test("encode then decode round-trips the cursor tuple", () => {
  const encoded = encodeCursor(CURSOR);
  assert.deepEqual(decodeCursor(encoded), CURSOR);
});

test("decodeCursor returns null for null or empty input", () => {
  assert.equal(decodeCursor(null), null);
  assert.equal(decodeCursor(""), null);
});

test("decodeCursor rejects a wrong part count", () => {
  const twoParts = Buffer.from("a|b", "utf8").toString("base64url");
  const fourParts = Buffer.from("a|b|c|d", "utf8").toString("base64url");
  assert.equal(decodeCursor(twoParts), null);
  assert.equal(decodeCursor(fourParts), null);
});

test("decodeCursor rejects an empty component", () => {
  const emptyMint = Buffer.from("2026-01-01T00:00:00.000Z||lock-42", "utf8").toString("base64url");
  assert.equal(decodeCursor(emptyMint), null);
});

test("decodeCursor rejects an invalid cliff date", () => {
  const badDate = Buffer.from("not-a-date|mint|lock-1", "utf8").toString("base64url");
  assert.equal(decodeCursor(badDate), null);
});

test("decodeCursor returns null on garbage input", () => {
  assert.equal(decodeCursor("!!!not-base64!!!"), null);
});

test("keysetFilter emits the three lexicographic branches", () => {
  assert.equal(
    keysetFilter(CURSOR),
    [
      `cliff_ts.gt.${CURSOR.cliffTs}`,
      `and(cliff_ts.eq.${CURSOR.cliffTs},mint.gt.${CURSOR.mint})`,
      `and(cliff_ts.eq.${CURSOR.cliffTs},mint.eq.${CURSOR.mint},id.gt.${CURSOR.id})`,
    ].join(","),
  );
});
