import type { NextRequest } from "next/server";
import { apiError, apiResponse, OPTIONS } from "@/lib/api/helpers";
import { requireLinkedWallet } from "@/lib/api/auth";
import { requireSameOrigin } from "@/lib/api/origin";
import { checkRateLimit } from "@/lib/api/rateLimit";
import { getCurrentProofMission } from "@/lib/proof-missions/mission";
import { getReviewerIds, proofSubmissionSchema } from "@/lib/proof-missions/validation";
import { getServerClient, hasServerSupabaseConfig } from "@/lib/supabase";

export { OPTIONS };

export async function POST(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const limited = await checkRateLimit(request, "proof");
  if (limited) return limited;

  const { session, error: authError } = await requireLinkedWallet();
  if (authError) return authError;
  if (session.identity_provider !== "github" || !session.github_id || !session.github_username) {
    return apiError("GitHub sign-in is required for proof missions", 403);
  }
  const reviewerIds = getReviewerIds();
  if (reviewerIds.size < 2) return apiError("Proof submission review is not configured", 503);
  if (reviewerIds.has(session.github_id)) {
    return apiError("Mission reviewers cannot submit proof", 403);
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return apiError("Invalid JSON", 400);
  }
  const parsed = proofSubmissionSchema.safeParse(raw);
  if (!parsed.success) return apiError(parsed.error.issues[0].message, 400);

  const mission = getCurrentProofMission();
  if (parsed.data.missionKey !== mission.key) {
    return apiError("This proof mission is no longer active", 409);
  }
  if (!hasServerSupabaseConfig()) {
    return apiError("Proof submissions are temporarily unavailable", 503);
  }

  try {
    const { data, error } = await getServerClient().from("proof_submissions").insert({
      mission_key: mission.key,
      mint_address: mission.mintAddress,
      contributor_github_id: session.github_id,
      contributor_github_username: session.github_username,
      contributor_wallet: session.wallet_address,
      evidence_url: parsed.data.evidenceUrl,
      evidence_note: parsed.data.evidenceNote,
    }).select("id, status").single();

    if (error) {
      if (error.code === "23505") return apiError("You already have an active proof for this mission", 409);
      console.error("[proof-missions/submit] Insert failed:", error.message);
      return apiError("Proof submissions are temporarily unavailable", 503);
    }
    return apiResponse({ id: data.id, status: data.status }, 201);
  } catch (error) {
    console.error(
      "[proof-missions/submit] Unexpected failure:",
      error instanceof Error ? error.message : error,
    );
    return apiError("Proof submissions are temporarily unavailable", 503);
  }
}
