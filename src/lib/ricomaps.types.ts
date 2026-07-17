import "server-only";
import { z } from "zod";

export type {
  RicomapsHolder,
  RicomapsSummary,
  RicomapsStatus,
  RicomapsResult,
} from "@/lib/ricomaps.client";
export { riskLevelColor, truncateAddress } from "@/lib/ricomaps.client";

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
