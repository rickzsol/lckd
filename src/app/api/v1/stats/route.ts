import { apiResponse } from "@/lib/api/helpers";
import { parsePublicStats, unavailablePublicStats } from "@/lib/api/publicStats";
import { getSupabase, hasSupabaseConfig } from "@/lib/supabase";

export const dynamic = "force-dynamic";

function statsResponse(data: ReturnType<typeof parsePublicStats> | typeof unavailablePublicStats) {
  const response = apiResponse(data);
  response.headers.set("Cache-Control", "public, s-maxage=60, stale-while-revalidate=300");
  return response;
}

export async function GET() {
  if (!hasSupabaseConfig()) return statsResponse(unavailablePublicStats);

  try {
    const { data, error } = await getSupabase().rpc("get_public_launch_stats");

    if (error) {
      console.error("[stats] Supabase error:", error.message);
      return statsResponse(unavailablePublicStats);
    }

    return statsResponse(parsePublicStats(data));
  } catch (error) {
    console.error("[stats] Error:", error);
    return statsResponse(unavailablePublicStats);
  }
}
