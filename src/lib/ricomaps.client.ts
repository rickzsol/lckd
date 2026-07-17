export interface RicomapsHolder {
  address: string;
  pct: number;
  isSniper: boolean;
  isBundled: boolean;
  isCabal: boolean;
}

export interface RicomapsSummary {
  riskScore: number;
  riskLevel: "green" | "yellow" | "red";
  top10Pct: number;
  devWalletPct: number;
  snipedAtLaunchPct: number;
  clusteredSupplyPct: number;
  coordinatedEntry: boolean;
  launchCohort: {
    windowSeconds: number;
    walletCount: number;
    supplyPct: number;
  };
  topHolders: RicomapsHolder[];
}

export type RicomapsStatus = "fresh" | "stale" | "pending" | "unavailable";

export interface RicomapsResult {
  status: RicomapsStatus;
  scannedAt: string | null;
  expiresAt: string | null;
  retryAfterSeconds: number | null;
  data: RicomapsSummary | null;
}

export function riskLevelColor(level: RicomapsSummary["riskLevel"]): {
  text: string;
  bg: string;
  border: string;
} {
  switch (level) {
    case "green":
      return { text: "text-accent-400", bg: "bg-accent-dim", border: "border-accent/25" };
    case "yellow":
      return { text: "text-warn", bg: "bg-[rgba(224,167,62,0.07)]", border: "border-warn/25" };
    case "red":
      return { text: "text-danger", bg: "bg-[rgba(229,72,77,0.07)]", border: "border-danger/25" };
  }
}

export function truncateAddress(address: string): string {
  if (address.length <= 10) return address;
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}
