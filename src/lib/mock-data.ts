import type { DisplayToken } from "@/types/display";
import { TrustTier } from "@/types/index";

export const FEATURED_TOKEN: DisplayToken = {
  id: "featured",
  name: "Lckd",
  ticker: "$LCKD",
  tier: TrustTier.SHIPPED,
  tierLabel: "SHIPPED",
  image: "/lckd-token.png",
  dev: {
    github: "lckd",
    avatar: "LC",
    accountAge: "25yr",
    repos: 12,
    commits: 847,
  },
  lock: {
    amount: "--",
    duration: "9,125d",
    pct: 0,
    start: "TBA",
    end: "TBA",
  },
  mcap: "--",
  vol: "--",
  price: "--",
  chg: "+0.0%",
  holders: 0,
  mintAddress: "HGtQYABTAAFdD184UW8GJgk3bG99pongSfDnd2Njpump",
};
