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
  created_at: string;
  twitter_url: string | null;
  telegram_url: string | null;
  website_url: string | null;
}

export interface GitHubProfile {
  id: string;
  wallet_address: string;
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
  skipLock: boolean;
  lockDurationDays: number;
  lockPercentage: number;
  githubUsername: string | null;
  githubRepo: string | null;
  liveUrl: string | null;
  twitterUrl: string | null;
  telegramUrl: string | null;
  websiteUrl: string | null;
}
