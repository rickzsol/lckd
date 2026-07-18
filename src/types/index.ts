export enum TrustTier {
  LOCKED = 1,
  VERIFIED = 2,
  BUILDER = 3,
  SHIPPED = 4,
}

export interface Token {
  id: string;
  mint_address: string;
  name: string;
  ticker: string;
  description: string;
  image_uri: string;
  creator_wallet: string;
  lock_tx: string;
  lock_duration_days: number;
  lock_percentage: number;
  lock_amount: string;
  buy_amount_sol: number;
  github_username: string | null;
  github_repo: string | null;
  live_url: string | null;
  trust_tier: TrustTier;
  launch_tx: string;
  launch_verified_at: string | null;
  lock_verified_at: string | null;
  lock_unlock_at: string | null;
  created_at: string;
  twitter_url: string | null;
  telegram_url: string | null;
  website_url: string | null;
}

export interface GitHubProfile {
  id: string;
  wallet_address: string | null;
  github_id: string;
  github_username: string;
  github_avatar: string;
  account_created_at: string;
  public_repos: number;
  total_commits: number;
  last_refreshed: string;
}

export interface GitHubRepoData {
  description: string | null;
  stars: number;
  forks: number;
  language: string | null;
  created_at: string;
  updated_at: string;
  default_branch: string;
}

export interface GitHubCommit {
  sha: string;
  message: string;
  author: string;
  date: string;
}

export interface ContributionDay {
  date: string;
  count: number;
}

export interface LaunchConfig {
  name: string;
  ticker: string;
  description: string;
  image: File | null;
  imageUri: string | null;
  buyAmountSol: number;
  lockDurationDays: number;
  lockPercentage: number;
  githubUsername: string | null;
  githubRepo: string | null;
  liveUrl: string | null;
  twitterUrl: string | null;
  telegramUrl: string | null;
  websiteUrl: string | null;
}

export const ALLOCATION_CATEGORIES = [
  "treasury",
  "marketing",
  "airdrops",
  "community",
  "contributors",
  "liquidity",
  "other",
] as const;

export type AllocationCategory = (typeof ALLOCATION_CATEGORIES)[number];

export type AllocationRecordStatus = "active" | "retired";

export type AllocationClassification =
  | "distributed"
  | "sold"
  | "internal"
  | "burned"
  | "received"
  | "unknown";

export interface AllocationBucket {
  id: string;
  token_id: string;
  category: AllocationCategory;
  label: string;
  declared_amount: string;
  status: AllocationRecordStatus;
  superseded_by: string | null;
  declared_at: string;
  retired_at: string | null;
}

export interface AllocationWallet {
  id: string;
  bucket_id: string;
  token_id: string;
  wallet_address: string;
  balance_at_declaration: string;
  is_creator_wallet: boolean;
  status: AllocationRecordStatus;
  created_at: string;
}

export interface AllocationTransfer {
  id: string;
  token_id: string;
  wallet_address: string;
  direction: "in" | "out";
  amount: string;
  counterparty_wallet: string | null;
  classification: AllocationClassification;
  source: string | null;
  signature: string;
  slot: number | null;
  block_time: string | null;
  recorded_via: "webhook" | "backfill";
  created_at: string;
}

export interface AllocationSnapshot {
  id: string;
  token_id: string;
  wallet_address: string;
  balance: string;
  drift: string | null;
  captured_at: string;
}
