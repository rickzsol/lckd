import { type Token, TrustTier } from "@/types/index";
import type { DisplayRepo, DisplayToken } from "@/types/display";
import type { DexMarketData } from "./dexscreener";
import { hasSupabaseConfig } from "./supabase";
import { isValidSolanaAddress } from "./api/validation";

const TIER_LABELS: Record<TrustTier, string> = {
  [TrustTier.LOCKED]: "LOCKED",
  [TrustTier.VERIFIED]: "VERIFIED",
  [TrustTier.BUILDER]: "BUILDER",
  [TrustTier.SHIPPED]: "SHIPPED",
};

const TOKEN_COLUMNS = "id, mint_address, name, ticker, image_uri, trust_tier, creator_wallet, github_username, lock_amount, lock_duration_days, lock_percentage, buy_amount_sol, created_at, live_url, github_repo, lock_tx, launch_tx, launch_verified_at, lock_verified_at, lock_unlock_at, description, twitter_url, telegram_url, website_url";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function formatTokenAmount(raw: string): string {
  const num = parseFloat(raw);
  if (!num || isNaN(num)) return "0";
  const tokens = num / 1_000_000;
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return tokens.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function formatRelativeAge(iso: string): string {
  const elapsedMs = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return "0m";
  const elapsedMinutes = Math.floor(elapsedMs / 60_000);
  if (elapsedMinutes < 60) return `${elapsedMinutes}m`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h`;
  return `${Math.floor(elapsedHours / 24)}d`;
}

async function loadRepoCard(t: Token): Promise<DisplayRepo | undefined> {
  const [owner, name, extra] = (t.github_repo ?? "").split("/");
  // Launch validation binds the repo owner to the submitting GitHub account,
  // so a mismatch means stale data and the card should stay hidden.
  if (!owner || !name || extra !== undefined || owner !== t.github_username) {
    return undefined;
  }
  try {
    const { getGitHubRepoDetails, getCommitCountSinceLaunch } = await import("./github/api");
    const pat = process.env.GITHUB_PAT;
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1_000).toISOString();
    const [details, commits30d] = await Promise.all([
      getGitHubRepoDetails(owner, name, pat),
      getCommitCountSinceLaunch(owner, name, since, pat),
    ]);
    return {
      name,
      lang: details.language ?? "n/a",
      stars: details.stars,
      forks: details.forks,
      lastPush: formatRelativeAge(details.updated_at),
      commits30d,
    };
  } catch (error) {
    console.error("[loadRepoCard] Error:", error instanceof Error ? error.message : error);
    return undefined;
  }
}

export function tokenToDisplay(
  t: Token,
  market?: DexMarketData | null,
  repo?: DisplayRepo,
): DisplayToken {
  const lockStartDate = new Date(t.lock_verified_at ?? t.created_at);
  const lockEndDate = new Date(t.lock_unlock_at ?? "");
  const isUnlocked = Number.isFinite(lockEndDate.getTime()) && Date.now() >= lockEndDate.getTime();
  const lockPct = isUnlocked ? 100 : 0;
  const displayTier = isUnlocked ? TrustTier.LOCKED : t.trust_tier;

  const fmtDate = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

  return {
    id: t.mint_address,
    name: t.name,
    ticker: `$${t.ticker}`,
    tier: displayTier,
    tierLabel: isUnlocked ? "UNLOCKED" : TIER_LABELS[displayTier],
    image: t.image_uri,
    dev: {
      github: t.github_username,
      avatar: t.github_username
        ? t.github_username.slice(0, 2).toUpperCase()
        : "??",
      accountAge: null,
    },
    lock: {
      amount: formatTokenAmount(t.lock_amount),
      duration: t.lock_duration_days > 0 ? `${t.lock_duration_days}d` : "--",
      pct: lockPct,
      start: fmtDate(lockStartDate),
      end: Number.isFinite(lockEndDate.getTime()) ? fmtDate(lockEndDate) : "--",
    },
    mcap: market?.mcap ?? "--",
    vol: market?.volume ?? "--",
    price: market?.price ?? "--",
    chg: market?.change24h ?? "+0.0%",
    holders: market?.holders ?? 0,
    liquidity: market?.liquidity ?? undefined,
    live: t.live_url ?? undefined,
    mintAddress: t.mint_address,
    repo,
  };
}

export async function getTokens(): Promise<DisplayToken[]> {
  if (!hasSupabaseConfig()) {
    return [];
  }

  try {
    const { getSupabase } = await import("./supabase");
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from("tokens")
      .select(TOKEN_COLUMNS)
      .not("launch_verified_at", "is", null)
      .not("lock_verified_at", "is", null)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error || !data || data.length === 0) {
      return [];
    }

    const tokens = data as Token[];
    const mintAddresses = tokens.map((t) => t.mint_address);

    const marketMap = await import("./dexscreener").then((module) =>
      module.fetchMarketDataBatch(mintAddresses),
    );

    return tokens.map((token) =>
      tokenToDisplay(
        token,
        marketMap.get(token.mint_address) ?? null,
      ),
    );
  } catch (err) {
    console.error("[getTokens] Error:", err instanceof Error ? err.message : err);
    return [];
  }
}

export async function getTokenByIdOrMint(
  id: string,
): Promise<DisplayToken | null> {
  if (!UUID_PATTERN.test(id) && !isValidSolanaAddress(id)) return null;

  // Check Supabase first
  if (hasSupabaseConfig()) {
    try {
      const { getSupabase } = await import("./supabase");
      const supabase = getSupabase();

      const { data, error } = await supabase
        .from("tokens")
        .select(TOKEN_COLUMNS)
        .eq(UUID_PATTERN.test(id) ? "id" : "mint_address", id)
        .not("launch_verified_at", "is", null)
        .not("lock_verified_at", "is", null)
        .limit(1)
        .single();

      if (!error && data) {
        const token = data as Token;
        const [market, repo] = await Promise.all([
          import("./dexscreener").then((module) =>
            module.fetchMarketData(token.mint_address),
          ),
          loadRepoCard(token),
        ]);
        return tokenToDisplay(token, market, repo);
      }
    } catch (error) {
      console.error("[getTokenByIdOrMint] Error:", error);
    }
  }
  return null;
}
