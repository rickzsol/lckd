// Raw base unit helpers for allocation amounts. pump.fun mints use 6
// decimals with a fixed 1B supply; everything crosses the wire as raw
// integer strings and only formats at the display edge.

export const TOKEN_DECIMALS = 6;
const RAW_PER_TOKEN = BigInt(10 ** TOKEN_DECIMALS);
const TOTAL_SUPPLY_RAW = BigInt("1000000000000000");

/** "460000000000000" -> "460.0M"; mirrors the lock amount formatting. */
export function formatRawAmount(raw: string): string {
  if (!/^\d+$/.test(raw)) return "0";
  const tokens = Number(BigInt(raw) / RAW_PER_TOKEN);
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return tokens.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/** Share of the fixed 1B supply, one decimal place. */
export function percentOfSupply(raw: string): string {
  if (!/^\d+$/.test(raw)) return "0.0";
  const basisPoints = (BigInt(raw) * BigInt(1_000)) / TOTAL_SUPPLY_RAW;
  return (Number(basisPoints) / 10).toFixed(1);
}

/**
 * Parse a human token amount ("12500000" or "12.5") into raw base units.
 * Returns null for anything that is not a plain positive decimal with at
 * most six fractional digits.
 */
export function parseTokenAmountToRaw(input: string): string | null {
  const trimmed = input.trim().replace(/,/g, "");
  const match = /^(\d{1,13})(?:\.(\d{1,6}))?$/.exec(trimmed);
  if (!match) return null;
  const whole = BigInt(match[1]);
  const fraction = BigInt((match[2] ?? "").padEnd(TOKEN_DECIMALS, "0") || "0");
  const raw = whole * RAW_PER_TOKEN + fraction;
  if (raw <= BigInt(0) || raw > TOTAL_SUPPLY_RAW) return null;
  return raw.toString();
}
