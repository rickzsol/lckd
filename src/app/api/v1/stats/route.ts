import { apiResponse } from "@/lib/api/helpers";
import { parsePublicStats, unavailablePublicStats } from "@/lib/api/publicStats";
import { getSupabase, hasSupabaseConfig } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const revalidate = 60;

export async function GET() {
  if (!hasSupabaseConfig()) return apiResponse(unavailablePublicStats);

  try {
    const { data, error } = await getSupabase().rpc("get_public_launch_stats");
    if (error) {
      console.error("[stats] Supabase error:", error.message);
      return apiResponse(unavailablePublicStats);
    }
    return apiResponse(parsePublicStats(data));
  } catch (error) {
    console.error("[stats] Error:", error instanceof Error ? error.message : error);
    return apiResponse(unavailablePublicStats);
  }
}
