/**
 * Opaque keyset cursor over (cliff_ts, mint) for the unlock calendar. Base64 of a
 * pipe-joined tuple; never exposes raw column offsets. Keyset (not offset)
 * pagination keeps results stable as rows shift and is backed by the partial
 * locks_cliff_idx index. `mint` is unique per token and the calendar reads only
 * canonical locks (one per token), so (cliff_ts, mint) is a total order with no
 * need for an internal id tiebreaker, which the public view no longer exposes
 * (finding 12).
 */
export interface UnlockCursor {
  cliffTs: string;
  mint: string;
}

export function encodeCursor(cursor: UnlockCursor): string {
  const raw = `${cursor.cliffTs}|${cursor.mint}`;
  return Buffer.from(raw, "utf8").toString("base64url");
}

// Strict component shapes. The decoded tuple is interpolated into a PostgREST
// `or()` filter, so any value outside these character classes is rejected to
// prevent filter injection (a crafted cursor must not smuggle commas/parens).
const BASE58_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const ISO_TS_PATTERN = /^[0-9T:.+\-Z ]{10,40}$/;

export function decodeCursor(value: string | null): UnlockCursor | null {
  if (!value) return null;
  try {
    const raw = Buffer.from(value, "base64url").toString("utf8");
    const parts = raw.split("|");
    if (parts.length !== 2) return null;
    const [cliffTs, mint] = parts;
    if (!cliffTs || !mint) return null;
    if (!ISO_TS_PATTERN.test(cliffTs) || !Number.isFinite(new Date(cliffTs).getTime())) return null;
    if (!BASE58_PATTERN.test(mint)) return null;
    return { cliffTs, mint };
  } catch {
    return null;
  }
}

/**
 * PostgREST filter for rows strictly after the cursor tuple, ordered
 * (cliff_ts, mint) ascending. Row-value comparison expressed as an `or` of the
 * two lexicographic branches.
 */
export function keysetFilter(cursor: UnlockCursor): string {
  const { cliffTs, mint } = cursor;
  return [
    `cliff_ts.gt.${cliffTs}`,
    `and(cliff_ts.eq.${cliffTs},mint.gt.${mint})`,
  ].join(",");
}
