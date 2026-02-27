import { type Token, TrustTier } from "@/types/index";
import type { DisplayToken } from "@/types/display";
import type { DexMarketData } from "./dexscreener";

function hasSupabaseConfig(): boolean {
  return !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

const TIER_LABELS: Record<TrustTier, string> = {
  [TrustTier.LOCKED]: "LOCKED",
  [TrustTier.VERIFIED]: "VERIFIED",
  [TrustTier.BUILDER]: "BUILDER",
  [TrustTier.SHIPPED]: "SHIPPED",
};

function formatTokenAmount(raw: string): string {
  const num = parseFloat(raw);
  if (!num || isNaN(num)) return "0";
  // pump.fun tokens have 6 decimals
  const tokens = num / 1_000_000;
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return tokens.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/**
 * Resolve an image URI that might be a metadata JSON URL.
 * Pump.fun IPFS returns a JSON with an `image` field — if the URI
 * points at JSON, extract the real image URL from it.
 */
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
    // Network error or timeout — fall back to original
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
    id: t.mint_address as unknown as number,
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
  // TODO: re-enable Supabase fetch after launch
  const { FEATURED_TOKEN } = await import("./mock-data");
  return [FEATURED_TOKEN];
}

export async function getTokenByIdOrMint(
  id: string,
): Promise<DisplayToken | null> {
  if (!hasSupabaseConfig()) return null;

  try {
    const { createServerClient } = await import("./supabase");
    const supabase = createServerClient();

    let { data, error } = await supabase
      .from("tokens")
      .select("*")
      .eq("mint_address", id)
      .single();

    if (error || !data) {
      ({ data, error } = await supabase
        .from("tokens")
        .select("*")
        .eq("id", id)
        .single());
    }

    if (error || !data) return null;

    const token = data as Token;
    const [market, resolvedImage] = await Promise.all([
      import("./dexscreener").then((m) => m.fetchMarketData(token.mint_address)),
      token.image_uri ? resolveImageUri(token.image_uri) : Promise.resolve(""),
    ]);

    return tokenToDisplay(
      { ...token, image_uri: resolvedImage || token.image_uri },
      market,
    );
  } catch {
    return null;
  }
}

