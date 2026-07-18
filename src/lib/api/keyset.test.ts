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

// --- (cliff_ts, mint) total-order pagination (finding 12) ------------------
//
// The keyset advances on (cliff_ts, mint). It is a TOTAL order — no row skipped
// or duplicated across pages — only if mint is unique among the paged rows, which
// locks_canonical_mint_unique now enforces at the DB. These tests simulate the
// PostgREST keyset filter over an in-memory dataset (including a duplicate
// cliff_ts across distinct mints, the exact case a single-column cursor would
// mishandle) and assert full, gapless coverage.

interface Row {
  cliff_ts: string;
  mint: string;
}

/** Applies the same strictly-after semantics keysetFilter encodes for PostgREST:
 * cliff_ts > cursor.cliffTs, OR (cliff_ts == cursor.cliffTs AND mint > cursor.mint). */
function afterCursor(row: Row, cursor: UnlockCursor): boolean {
  if (row.cliff_ts > cursor.cliffTs) return true;
  return row.cliff_ts === cursor.cliffTs && row.mint > cursor.mint;
}

function paginate(all: Row[], pageSize: number): Row[] {
  const sorted = [...all].sort((a, b) =>
    a.cliff_ts === b.cliff_ts ? a.mint.localeCompare(b.mint) : a.cliff_ts.localeCompare(b.cliff_ts),
  );
  const collected: Row[] = [];
  let cursor: UnlockCursor | null = null;
  for (let guard = 0; guard < 100; guard++) {
    const page = sorted
      .filter((r) => (cursor ? afterCursor(r, cursor) : true))
      .slice(0, pageSize);
    if (page.length === 0) break;
    collected.push(...page);
    const last = page.at(-1)!;
    cursor = { cliffTs: last.cliff_ts, mint: last.mint };
    if (page.length < pageSize) break;
  }
  return collected;
}

test("keyset over unique mints covers every row with no gaps or dupes", () => {
  const rows: Row[] = [
    { cliff_ts: "2026-01-01T00:00:00.000Z", mint: "Aaa11111111111111111111111111111111111111111" },
    // duplicate cliff_ts across distinct mints — the mint tiebreaker must order them.
    { cliff_ts: "2026-01-02T00:00:00.000Z", mint: "Bbb11111111111111111111111111111111111111111" },
    { cliff_ts: "2026-01-02T00:00:00.000Z", mint: "Ccc11111111111111111111111111111111111111111" },
    { cliff_ts: "2026-01-03T00:00:00.000Z", mint: "Ddd11111111111111111111111111111111111111111" },
    { cliff_ts: "2026-01-03T00:00:00.000Z", mint: "Eee11111111111111111111111111111111111111111" },
  ];
  const paged = paginate(rows, 2);
  assert.equal(paged.length, rows.length); // no row skipped, none duplicated
  const seen = new Set(paged.map((r) => r.mint));
  assert.equal(seen.size, rows.length);
});

test("a duplicate cliff_ts does not stall the cursor when mints are unique", () => {
  // Two rows sharing a cliff_ts landing exactly on a page boundary: the mint
  // tiebreaker lets the next page resume strictly after the first without
  // re-reading or dropping the second.
  const rows: Row[] = [
    { cliff_ts: "2026-01-02T00:00:00.000Z", mint: "Bbb11111111111111111111111111111111111111111" },
    { cliff_ts: "2026-01-02T00:00:00.000Z", mint: "Ccc11111111111111111111111111111111111111111" },
  ];
  const paged = paginate(rows, 1);
  assert.deepEqual(
    paged.map((r) => r.mint),
    ["Bbb11111111111111111111111111111111111111111", "Ccc11111111111111111111111111111111111111111"],
  );
});
