export type EvidenceStatus = "verified" | "caution" | "unknown";

export interface AuthorityEvidence {
  freezeAuthority: string | null;
  mintAuthority: string | null;
  status: EvidenceStatus;
}

export interface ExtensionEvidence {
  names: string[];
  flagged: string[];
  status: EvidenceStatus;
}

export interface ConcentrationEvidence {
  accountsRequested: number | null;
  ownersAnalyzed: number | null;
  status: EvidenceStatus;
  topTenOwnerPercent: number | null;
}

export interface OnchainEvidence {
  asOf: string | null;
  authorities: AuthorityEvidence;
  concentration: ConcentrationEvidence;
  decimals: number | null;
  extensions: ExtensionEvidence;
  program: "SPL Token" | "Token-2022" | "Unknown";
  slot: number | null;
}

export interface MarketEvidence {
  asOf: string | null;
  dex: string | null;
  liquidityUsd: number | null;
  pairAddress: string | null;
  pairCreatedAt: string | null;
  status: EvidenceStatus;
}

export interface TradeReadinessEvidence {
  market: MarketEvidence;
  mintAddress: string;
  onchain: OnchainEvidence;
}

export interface BuyPreview {
  amountSol: number;
  estimatedTokenRaw: string | null;
  impactPercent: number | null;
  router: string | null;
  status: "available" | "unknown";
}

export interface ReverseRoutePreview {
  estimatedSol: number | null;
  isAvailable: boolean;
  retainedPercent: number | null;
  router: string | null;
}

export interface TradeReadinessQuotes {
  asOf: string;
  buys: BuyPreview[];
  mintAddress: string;
  reverse: ReverseRoutePreview | null;
}
