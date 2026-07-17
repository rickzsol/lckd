import type { RicomapsResult } from "@/lib/ricomaps.types";

const FIXTURE_HOLDERS = Array.from({ length: 20 }, (_, i) => ({
  address: `Fixture${String(i).padStart(2, "0")}WalletAddr${String(i).padStart(4, "0")}xyz`,
  pct: Math.max(0.5, 12 - i * 0.6),
  isSniper: i < 3,
  isBundled: i >= 3 && i < 6,
  isCabal: i === 1,
}));

/**
 * Dev-only fixtures so the holder intel section renders without a live ricomaps API.
 * Enabled via RICOMAPS_FIXTURES=1. Deterministic on mint address so different
 * fixture mints can be used to preview green/yellow/red states.
 */
export function getRicomapsFixture(mintAddress: string): RicomapsResult {
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 30_000).toISOString();

  if (mintAddress.endsWith("pending")) {
    return { status: "pending", fetchedAt: now, expiresAt: null, data: null };
  }

  if (mintAddress.endsWith("unavailable")) {
    return { status: "unavailable", fetchedAt: now, expiresAt: null, data: null };
  }

  const isRed = mintAddress.endsWith("red");
  const isYellow = mintAddress.endsWith("yellow");

  return {
    status: "fresh",
    fetchedAt: now,
    expiresAt,
    data: {
      riskScore: isRed ? 82 : isYellow ? 54 : 18,
      riskLevel: isRed ? "red" : isYellow ? "yellow" : "green",
      top10Pct: isRed ? 61 : isYellow ? 32 : 14,
      devWalletPct: isRed ? 18 : 4.2,
      snipedAtLaunchPct: isRed ? 22 : isYellow ? 8 : 1.5,
      clusteredSupplyPct: isRed ? 45 : isYellow ? 20 : 3,
      coordinatedEntry: isRed,
      launchCohort: {
        windowSeconds: isRed ? 4 : 12,
        walletCount: isRed ? 14 : 3,
        supplyPct: isRed ? 22 : 1.5,
      },
      topHolders: FIXTURE_HOLDERS,
    },
  };
}
