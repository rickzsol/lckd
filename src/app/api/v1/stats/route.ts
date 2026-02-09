import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 60;

export async function GET() {
  try {
    const { createServerClient } = await import("@/lib/supabase");
    const supabase = createServerClient();

    const [tokensRes, profilesRes] = await Promise.all([
      supabase.from("tokens").select("lock_amount, trust_tier"),
      supabase.from("github_profiles").select("github_id"),
    ]);

    const tokens = tokensRes.data ?? [];
    const profiles = profilesRes.data ?? [];

    const launched = tokens.length;

    const totalLocked = tokens.reduce((sum, t) => {
      const amt = parseFloat(t.lock_amount || "0");
      return sum + (isNaN(amt) ? 0 : amt);
    }, 0);

    // Devs verified = tier >= 2 (VERIFIED, BUILDER, SHIPPED)
    const devsVerified = tokens.filter((t) => t.trust_tier >= 2).length;

    // Building now = unique GitHub profiles linked
    const buildingNow = profiles.length;

    return NextResponse.json({
      launched,
      totalLocked,
      devsVerified,
      buildingNow,
    });
  } catch {
    return NextResponse.json(
      { launched: 0, totalLocked: 0, devsVerified: 0, buildingNow: 0 },
      { status: 200 },
    );
  }
}
