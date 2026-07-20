import { getServerSession } from "next-auth";
import type { NextRequest } from "next/server";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { apiError, apiResponse, OPTIONS } from "@/lib/api/helpers";
import { checkRateLimit } from "@/lib/api/rateLimit";
import { getCurrentProofMission } from "@/lib/proof-missions/mission";
import { loadProofMissionBoard, loadProofViewer } from "@/lib/proof-missions/data.server";
import { hasServerSupabaseConfig } from "@/lib/supabase";

export { OPTIONS };
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const limited = await checkRateLimit(request);
  if (limited) return limited;

  const mission = getCurrentProofMission();
  if (request.nextUrl.searchParams.get("mint") !== mission.mintAddress) {
    return apiError("No active proof mission for this token", 404);
  }
  if (!hasServerSupabaseConfig()) {
    return apiError("Proof missions are temporarily unavailable", 503);
  }

  try {
    const session = await getServerSession(authOptions);
    const viewer = session?.github_id ? await loadProofViewer(session.github_id) : null;
    return apiResponse(await loadProofMissionBoard(viewer));
  } catch (error) {
    console.error(
      "[proof-missions/current] Load failed:",
      error instanceof Error ? error.message : error,
    );
    return apiError("Proof missions are temporarily unavailable", 503);
  }
}
