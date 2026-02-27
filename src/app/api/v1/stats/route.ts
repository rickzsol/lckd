import { apiResponse, apiError } from "@/lib/api/helpers";
import { hasSupabaseConfig } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const revalidate = 60;

export async function GET() {
  if (!hasSupabaseConfig()) {
    return apiError("Stats unavailable", 503);
  }

  try {
    const { getSupabase } = await import("@/lib/supabase");
    const supabase = getSupabase();

    const [tokensRes, profilesRes] = await Promise.all([
      supabase.from("tokens").select("lock_amount, trust_tier"),
      supabase.from("github_profiles").select("github_id"),
    ]);

    if (tokensRes.error) {
      console.error("[stats] tokens query error:", tokensRes.error.message);
      return apiError("Failed to fetch stats", 500);
    }
    if (profilesRes.error) {
      console.error("[stats] profiles query error:", profilesRes.error.message);
      return apiError("Failed to fetch stats", 500);
    }

    const tokens = tokensRes.data ?? [];
    const profiles = profilesRes.data ?? [];

    const launched = tokens.length;

    const totalLocked = tokens.reduce((sum, t) => {
      const amt = parseFloat(t.lock_amount || "0");
      return sum + (isNaN(amt) ? 0 : amt);
    }, 0);

    const devsVerified = tokens.filter((t) => t.trust_tier >= 2).length;
    const buildingNow = profiles.length;

    return apiResponse({ launched, totalLocked, devsVerified, buildingNow });
  } catch (err) {
    console.error("[stats] Error:", err instanceof Error ? err.message : err);
    return apiError("Failed to fetch stats", 500);
  }
}
