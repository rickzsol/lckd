import { TrustTier, type Token, type GitHubProfile, type GitHubRepoData } from "@/types";

const SIX_MONTHS_MS = 180 * 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const MIN_LOCK_DAYS_FOR_BUILDER = 30;

interface TierContext {
  repoData?: GitHubRepoData | null;
  hasRecentCommits?: boolean;
  hasPostLaunchCommits?: boolean;
  isLiveUrlVerified?: boolean;
  isLockVerified?: boolean;
}

export function calculateTrustTier(
  token: Token,
  githubProfile: GitHubProfile | null,
  context: TierContext = {},
): TrustTier {
  if (!context.isLockVerified) {
    throw new Error("Trust tier requires a verified on-chain lock");
  }

  let tier = TrustTier.LOCKED;

  // Tier 2: verified GitHub identity
  if (!githubProfile?.github_username) return tier;

  const accountAge = Date.now() - new Date(githubProfile.account_created_at).getTime();
  const isAccountMature = accountAge > SIX_MONTHS_MS;
  const hasPublicRepos = githubProfile.public_repos > 0;

  if (!isAccountMature || !hasPublicRepos) return tier;
  tier = TrustTier.VERIFIED;

  // Tier 3: active builder
  if (!token.github_repo || !context.repoData) return tier;
  const [repoOwner, repoName, extra] = token.github_repo.split("/");
  if (
    !repoOwner ||
    !repoName ||
    extra ||
    repoOwner.toLowerCase() !== githubProfile.github_username.toLowerCase()
  ) {
    return tier;
  }

  const repoUpdatedAt = new Date(context.repoData.updated_at).getTime();
  const isRepoActive = context.hasRecentCommits ?? (Date.now() - repoUpdatedAt < THIRTY_DAYS_MS);
  const hasMinLockDuration = token.lock_duration_days >= MIN_LOCK_DAYS_FOR_BUILDER;

  if (!isRepoActive || !hasMinLockDuration) return tier;
  tier = TrustTier.BUILDER;

  // Tier 4: shipped product
  if (!token.live_url || !context.isLiveUrlVerified) return tier;
  if (!context.hasPostLaunchCommits) return tier;
  tier = TrustTier.SHIPPED;

  return tier;
}
