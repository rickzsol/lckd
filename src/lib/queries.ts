import { type Token, TrustTier } from "@/types/index";
import type { DisplayToken, DisplayCommit } from "@/types/display";
import { TOKENS as MOCK_TOKENS, COMMITS as MOCK_COMMITS } from "./mock-data";

function hasSupabaseConfig(): boolean {
  return !!(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

async function getSupabaseClient() {
  const { getSupabase } = await import("./supabase");
  return getSupabase();
}

const TIER_LABELS: Record<TrustTier, string> = {
  [TrustTier.LOCKED]: "LOCKED",
  [TrustTier.VERIFIED]: "VERIFIED",
  [TrustTier.BUILDER]: "BUILDER",
  [TrustTier.SHIPPED]: "SHIPPED",
};

export function tokenToDisplay(t: Token): DisplayToken {
  const lockDaysElapsed = Math.min(
    t.lock_duration_days,
    Math.floor(
      (Date.now() - new Date(t.created_at).getTime()) / (1000 * 60 * 60 * 24),
    ),
  );
  const lockPct = Math.round((lockDaysElapsed / t.lock_duration_days) * 100);

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
      amount: t.lock_amount,
      duration: `${t.lock_duration_days}d`,
      pct: lockPct,
      start: fmtDate(launchDate),
      end: fmtDate(lockEndDate),
    },
    mcap: "--",
    vol: "--",
    price: "--",
    chg: "+0.0%",
    holders: 0,
    live: t.live_url ?? undefined,
    mintAddress: t.mint_address,
  };
}

export async function getTokens(): Promise<DisplayToken[]> {
  if (!hasSupabaseConfig()) return MOCK_TOKENS;

  try {
    const supabase = await getSupabaseClient();
    const { data, error } = await supabase
      .from("tokens")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);

    if (error || !data || data.length === 0) return MOCK_TOKENS;

    return (data as Token[]).map(tokenToDisplay);
  } catch {
    return MOCK_TOKENS;
  }
}

function findMockToken(id: string): DisplayToken | null {
  return (
    MOCK_TOKENS.find(
      (t) => t.mintAddress === id || String(t.id) === id,
    ) ?? null
  );
}

export async function getTokenByIdOrMint(
  id: string,
): Promise<DisplayToken | null> {
  if (!hasSupabaseConfig()) return findMockToken(id);

  try {
    const supabase = await getSupabaseClient();

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

    if (error || !data) return findMockToken(id);

    return tokenToDisplay(data as Token);
  } catch {
    return findMockToken(id);
  }
}

export function getCommits(): DisplayCommit[] {
  return MOCK_COMMITS;
}
