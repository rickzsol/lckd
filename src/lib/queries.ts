import { type Token, TrustTier } from "@/types/index";
import type { DisplayToken } from "@/types/display";
import type { DexMarketData } from "./dexscreener";
import { hasSupabaseConfig } from "./supabase";

const TIER_LABELS: Record<TrustTier, string> = {
  [TrustTier.LOCKED]: "LOCKED",
  [TrustTier.VERIFIED]: "VERIFIED",
  [TrustTier.BUILDER]: "BUILDER",
  [TrustTier.SHIPPED]: "SHIPPED",
};

const TOKEN_COLUMNS = "mint_address, name, ticker, image_uri, trust_tier, creator_wallet, github_username, lock_amount, lock_duration_days, lock_percentage, buy_amount_sol, created_at, live_url, github_repo, lock_tx, launch_tx, description, twitter_url, telegram_url, website_url";

function formatTokenAmount(raw: string): string {
  const num = parseFloat(raw);
  if (!num || isNaN(num)) return "0";
  const tokens = num / 1_000_000;
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return tokens.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

async function resolveImageUri(uri: string): Promise<string> {
  if (!uri || !uri.startsWith("http")) return uri;

  try {
    const res = await fetch(uri, {
      signal: AbortSignal.timeout(4000),
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return uri;

    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.includes("json")) return uri;

    const meta = await res.json();
    if (typeof meta.image === "string" && meta.image.startsWith("http")) {
      return meta.image;
    }
  } catch {
    // Network error or timeout
  }
  return uri;
}

export function tokenToDisplay(t: Token, market?: DexMarketData | null): DisplayToken {
  const lockDaysElapsed = Math.min(
    t.lock_duration_days,
    Math.floor(
      (Date.now() - new Date(t.created_at).getTime()) / (1000 * 60 * 60 * 24),
    ),
  );
  const lockPct = t.lock_duration_days > 0
    ? Math.round((lockDaysElapsed / t.lock_duration_days) * 100)
    : 0;

  const launchDate = new Date(t.created_at);
  const lockEndDate = new Date(t.created_at);
  lockEndDate.setDate(lockEndDate.getDate() + t.lock_duration_days);

  const fmtDate = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", day: "numeric" });

  return {
    id: t.mint_address,
    name: t.name,
    ticker: `$${t.ticker}`,
    tier: t.trust_tier,
    tierLabel: TIER_LABELS[t.trust_tier],
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
      start: fmtDate(launchDate),
      end: fmtDate(lockEndDate),
    },
    mcap: market?.mcap ?? "--",
    vol: market?.volume ?? "--",
    price: market?.price ?? "--",
    chg: market?.change24h ?? "+0.0%",
    holders: market?.holders ?? 0,
    liquidity: market?.liquidity ?? undefined,
    live: t.live_url ?? undefined,
    mintAddress: t.mint_address,
  };
}

export async function getTokens(): Promise<DisplayToken[]> {
  const { FEATURED_TOKEN } = await import("./mock-data");

  if (!hasSupabaseConfig()) {
    return [FEATURED_TOKEN];
  }

  try {
    const { getSupabase } = await import("./supabase");
    const supabase = getSupabase();

    const { data, error } = await supabase
      .from("tokens")
      .select(TOKEN_COLUMNS)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error || !data || data.length === 0) {
      return [FEATURED_TOKEN];
    }

    const tokens = data as Token[];
    const mintAddresses = tokens.map((t) => t.mint_address);

    // Batch fetch market data + resolve images in parallel
    const [marketMap, resolvedImages] = await Promise.all([
      import("./dexscreener").then((m) => m.fetchMarketDataBatch(mintAddresses)),
      Promise.all(
        tokens.map((t) =>
          t.image_uri ? resolveImageUri(t.image_uri) : Promise.resolve(""),
        ),
      ),
    ]);

    const displayTokens = tokens.map((t, i) =>
      tokenToDisplay(
        { ...t, image_uri: resolvedImages[i] || t.image_uri },
        marketMap.get(t.mint_address) ?? null,
      ),
    );

    const hasFeatured = displayTokens.some(
      (dt) => dt.mintAddress === FEATURED_TOKEN.mintAddress,
    );
    if (!hasFeatured) {
      displayTokens.unshift(FEATURED_TOKEN);
    }

    return displayTokens;
  } catch (err) {
    console.error("[getTokens] Error:", err instanceof Error ? err.message : err);
    return [FEATURED_TOKEN];
  }
}

export async function getTokenByIdOrMint(
  id: string,
): Promise<DisplayToken | null> {
  // Check Supabase first
  if (hasSupabaseConfig()) {
    try {
      const { getSupabase } = await import("./supabase");
      const supabase = getSupabase();

      const { data, error } = await supabase
        .from("tokens")
        .select(TOKEN_COLUMNS)
        .or(`mint_address.eq.${id},id.eq.${id}`)
        .limit(1)
        .single();

      if (!error && data) {
        const token = data as Token;
        const [market, resolvedImage] = await Promise.all([
          import("./dexscreener").then((m) => m.fetchMarketData(token.mint_address)),
          token.image_uri ? resolveImageUri(token.image_uri) : Promise.resolve(""),
        ]);

        return tokenToDisplay(
          { ...token, image_uri: resolvedImage || token.image_uri },
          market,
        );
      }
    } catch {
      // Fall through to featured token check
    }
  }

  // Fallback: check featured token
  const { FEATURED_TOKEN } = await import("./mock-data");
  if (FEATURED_TOKEN.id === id || FEATURED_TOKEN.mintAddress === id) {
    // Enrich with live market data if mint address exists
    if (FEATURED_TOKEN.mintAddress) {
      try {
        const { fetchMarketData } = await import("./dexscreener");
        const market = await fetchMarketData(FEATURED_TOKEN.mintAddress);
        if (market) {
          return { ...FEATURED_TOKEN, ...market, mcap: market.mcap, vol: market.volume, price: market.price, chg: market.change24h, liquidity: market.liquidity };
        }
      } catch {
        // Return without market data
      }
    }
    return FEATURED_TOKEN;
  }

  return null;
}
