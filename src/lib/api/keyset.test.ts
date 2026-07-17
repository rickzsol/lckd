import assert from "node:assert/strict";
import test from "node:test";
import { decodeCursor, encodeCursor, keysetFilter, type UnlockCursor } from "./keyset";

const CURSOR: UnlockCursor = {
  cliffTs: "2026-01-01T00:00:00.000Z",
  mint: "So11111111111111111111111111111111111111112",
};

test("decodeCursor rejects a non-base58 mint (filter-injection guard)", () => {
  const badMint = Buffer.from(
    "2026-01-01T00:00:00.000Z|not),status.eq.withdrawn",
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
  const onePart = Buffer.from("a", "utf8").toString("base64url");
  const threeParts = Buffer.from("a|b|c", "utf8").toString("base64url");
  assert.equal(decodeCursor(onePart), null);
  assert.equal(decodeCursor(threeParts), null);
});

test("decodeCursor rejects an empty component", () => {
  const emptyMint = Buffer.from("2026-01-01T00:00:00.000Z|", "utf8").toString("base64url");
  assert.equal(decodeCursor(emptyMint), null);
});

test("decodeCursor rejects an invalid cliff date", () => {
  const badDate = Buffer.from(
    "not-a-date|So11111111111111111111111111111111111111112",
    "utf8",
  ).toString("base64url");
  assert.equal(decodeCursor(badDate), null);
});

test("decodeCursor returns null on garbage input", () => {
  assert.equal(decodeCursor("!!!not-base64!!!"), null);
});

test("keysetFilter emits the two lexicographic branches", () => {
  assert.equal(
    keysetFilter(CURSOR),
    [
      `cliff_ts.gt.${CURSOR.cliffTs}`,
      `and(cliff_ts.eq.${CURSOR.cliffTs},mint.gt.${CURSOR.mint})`,
    ].join(","),
  );
});
