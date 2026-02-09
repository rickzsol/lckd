import type { TrustTier } from "./index";

export interface DisplayDev {
  github: string | null;
  avatar: string;
  accountAge: string | null;
  repos?: number;
  commits?: number;
  lastCommit?: string;
  lastCommitMsg?: string;
}

export interface DisplayRepo {
  name: string;
  lang: string;
  stars: number;
  forks: number;
  lastPush: string;
  commits30d: number;
}

export interface DisplayLock {
  amount: string;
  duration: string;
  pct: number;
  start: string;
  end: string;
}

export interface DisplayCommit {
  dev: string;
  ticker: string;
  msg: string;
  time: string;
}

export interface DisplayToken {
  id: number;
  name: string;
  ticker: string;
  tier: TrustTier;
  tierLabel: string;
  image: string;
  dev: DisplayDev;
  repo?: DisplayRepo;
  lock: DisplayLock;
  mcap: string;
  vol: string;
  price: string;
  chg: string;
  holders: number;
  live?: string;
  liquidity?: string;
  /** Solana mint address — used for routing. Undefined for mock data. */
  mintAddress?: string;
}
