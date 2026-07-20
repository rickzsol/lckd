export function formatTokenQuote(raw: string | null, decimals: number | null): string {
  if (!raw || decimals === null || !/^\d+$/.test(raw)) return "Unknown";
  const rawAmount = BigInt(raw);
  if (rawAmount === BigInt(0)) return "0";
  const amount = Number(raw) / (10 ** decimals);
  if (!Number.isFinite(amount)) return "Unknown";
  if (amount < 0.01) return "<0.01";
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(amount);
}
