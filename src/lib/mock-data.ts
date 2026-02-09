import type { DisplayToken, DisplayCommit } from "@/types/display";
import { TrustTier } from "@/types/index";

export const TOKENS: DisplayToken[] = [
  {
    id: 0, name: "lockpad", ticker: "$TEST", tier: TrustTier.BUILDER, tierLabel: "BUILDER", image: "/logo.png",
    dev: { github: "lockpad", avatar: "TD", accountAge: "2yr", repos: 12, commits: 847, lastCommit: "1h ago", lastCommitMsg: "feat: add no-lock option to launch wizard" },
    repo: { name: "lockpad", lang: "TypeScript", stars: 3, forks: 0, lastPush: "1h", commits30d: 34 },
    lock: { amount: "10 SOL", duration: "180d", pct: 8, start: "Feb 06", end: "Aug 05" },
    mcap: "$12K", vol: "$1.8K", price: "$0.000012", chg: "+0.0%", holders: 1,
    mintAddress: "lockpad-test",
  },
];

export const COMMITS: DisplayCommit[] = [
  { dev: "lockpad", ticker: "$TEST", msg: "feat: add no-lock option to launch", time: "1h" },
];
