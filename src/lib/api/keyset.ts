/**
 * Opaque keyset cursor over (cliff_ts, mint, id) for the unlock calendar. Base64
 * of a pipe-joined tuple; never exposes raw column offsets. Keyset (not offset)
 * pagination keeps results stable as rows shift and is backed by the partial
 * locks_cliff_idx index.
 */
export interface UnlockCursor {
  cliffTs: string;
  mint: string;
  id: string;
}

export function encodeCursor(cursor: UnlockCursor): string {
  const raw = `${cursor.cliffTs}|${cursor.mint}|${cursor.id}`;
  return Buffer.from(raw, "utf8").toString("base64url");
}

// Strict component shapes. The decoded tuple is interpolated into a PostgREST
// `or()` filter, so any value outside these character classes is rejected to
// prevent filter injection (a crafted cursor must not smuggle commas/parens).
const BASE58_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_TS_PATTERN = /^[0-9T:.+\-Z ]{10,40}$/;

export function decodeCursor(value: string | null): UnlockCursor | null {
  if (!value) return null;
  try {
    const raw = Buffer.from(value, "base64url").toString("utf8");
    const parts = raw.split("|");
    if (parts.length !== 3) return null;
    const [cliffTs, mint, id] = parts;
    if (!cliffTs || !mint || !id) return null;
    if (!ISO_TS_PATTERN.test(cliffTs) || !Number.isFinite(new Date(cliffTs).getTime())) return null;
    if (!BASE58_PATTERN.test(mint)) return null;
    if (!UUID_PATTERN.test(id)) return null;
    return { cliffTs, mint, id };
  } catch {
    return null;
  }
}

/**
 * PostgREST filter for rows strictly after the cursor tuple, ordered
 * (cliff_ts, mint, id) ascending. Row-value comparison expressed as an `or`
 * of the three lexicographic branches.
 */
export function keysetFilter(cursor: UnlockCursor): string {
  const { cliffTs, mint, id } = cursor;
  return [
    `cliff_ts.gt.${cliffTs}`,
    `and(cliff_ts.eq.${cliffTs},mint.gt.${mint})`,
    `and(cliff_ts.eq.${cliffTs},mint.eq.${mint},id.gt.${id})`,
  ].join(",");
}
