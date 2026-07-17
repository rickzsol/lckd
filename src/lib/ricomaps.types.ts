import { z } from "zod";

const holderSchema = z.object({
  address: z.string(),
  pct: z.number().min(0).max(100),
  isSniper: z.boolean(),
  isBundled: z.boolean(),
  isCabal: z.boolean(),
});

export const summarySchema = z.object({
  riskScore: z.number().min(0).max(100),
  riskLevel: z.enum(["green", "yellow", "red"]),
  top10Pct: z.number().min(0).max(100),
  devWalletPct: z.number().min(0).max(100),
  snipedAtLaunchPct: z.number().min(0).max(100),
  clusteredSupplyPct: z.number().min(0).max(100),
  coordinatedEntry: z.boolean(),
  launchCohort: z.object({
    windowSeconds: z.number().min(0),
    walletCount: z.number().int().min(0),
    supplyPct: z.number().min(0).max(100),
  }),
  topHolders: z.array(holderSchema).max(20),
});

export type RicomapsHolder = z.infer<typeof holderSchema>;
export type RicomapsSummary = z.infer<typeof summarySchema>;

export type RicomapsStatus = "fresh" | "stale" | "pending" | "unavailable";

export interface RicomapsResult {
  status: RicomapsStatus;
  fetchedAt: string;
  expiresAt: string | null;
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
