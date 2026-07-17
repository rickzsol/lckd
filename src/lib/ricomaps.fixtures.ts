import "server-only";

import type { RicomapsResult } from "@/lib/ricomaps.client";

export const FIXTURE_MINTS = {
  green: "4bwAovV9uPMXBZ24kFPbHwZqx3gWY7XCWuxdjf26NzpF",
  yellow: "D4hYcSpJnqTHAHhxPjE7sTdFyLkfWhq89DSaEuhjK5as",
  red: "8eVNUKwjHDh38UjAR1tVci3FTGzXwCPuzetkLahWXr3F",
  pending: "89mtYT26a4mr4gSB6ymwkXJi8c1RZAW7v3EVhv8FWunZ",
  unavailable: "558x6RPS5b7zqe7VRKZDh9skUeTNF79oaA5Zm2vHxbpJ",
} as const;

const FIXTURE_HOLDERS = Array.from({ length: 20 }, (_, i) => ({
  address: `Fixture${String(i).padStart(2, "0")}WalletAddr${String(i).padStart(4, "0")}xyz`,
  pct: Math.max(0.5, 12 - i * 0.6),
  isSniper: i < 3,
  isBundled: i >= 3 && i < 6,
  isCabal: i === 1,
}));

/**
 * Dev-only fixtures so the holder intel section renders without a live ricomaps API.
 * Enabled via RICOMAPS_FIXTURES=1 outside production. Keyed on exact mint constants
 * (see FIXTURE_MINTS) rather than address suffixes so every fixture path is reachable
 * through real base58 validation.
 */
export function getRicomapsFixture(mintAddress: string): RicomapsResult | null {
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 30_000).toISOString();

  if (mintAddress === FIXTURE_MINTS.pending) {
    return { status: "pending", scannedAt: null, expiresAt: null, retryAfterSeconds: 5, data: null };
  }

  if (mintAddress === FIXTURE_MINTS.unavailable) {
    return { status: "unavailable", scannedAt: null, expiresAt: null, retryAfterSeconds: null, data: null };
  }

  const isRed = mintAddress === FIXTURE_MINTS.red;
  const isYellow = mintAddress === FIXTURE_MINTS.yellow;
  const isGreen = mintAddress === FIXTURE_MINTS.green;
  if (!isRed && !isYellow && !isGreen) return null;

  return {
    status: "fresh",
    scannedAt: now,
    expiresAt,
    retryAfterSeconds: null,
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
