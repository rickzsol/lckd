import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiResponse, OPTIONS } from "@/lib/api/helpers";
import { requireLinkedWallet } from "@/lib/api/auth";
import { requireSameOrigin } from "@/lib/api/origin";
import { checkRateLimit } from "@/lib/api/rateLimit";
import { getCurrentProofMission } from "@/lib/proof-missions/mission";
import { getReviewerIds, proofReviewSchema } from "@/lib/proof-missions/validation";
import { getServerClient, hasServerSupabaseConfig } from "@/lib/supabase";

export { OPTIONS };

const idSchema = z.string().uuid();

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const limited = await checkRateLimit(request, "proof");
  if (limited) return limited;

  const { session, error: authError } = await requireLinkedWallet();
  if (authError) return authError;
  const reviewerIds = getReviewerIds();
  if (reviewerIds.size < 2) return apiError("Proof submission review is not configured", 503);
  if (!reviewerIds.has(session.github_id)) return apiError("Reviewer access required", 403);
  if (!hasServerSupabaseConfig()) return apiError("Proof reviews are temporarily unavailable", 503);

  const id = idSchema.safeParse((await params).id);
  if (!id.success) return apiError("A valid proof submission is required", 400);

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return apiError("Invalid JSON", 400);
  }
  const parsed = proofReviewSchema.safeParse(raw);
  if (!parsed.success) return apiError(parsed.error.issues[0].message, 400);

  try {
    const client = getServerClient();
    const { data: submission, error: lookupError } = await client
      .from("proof_submissions")
      .select("mission_key, contributor_github_id, status")
      .eq("id", id.data)
      .maybeSingle();
    if (lookupError) throw new Error(lookupError.message);
    if (!submission || submission.mission_key !== getCurrentProofMission().key) {
      return apiError("Proof submission not found", 404);
    }
    if (submission.contributor_github_id === session.github_id) {
      return apiError("You cannot review your own proof", 403);
    }
    if (submission.status !== "pending") return apiError("This proof is no longer pending", 409);

    const { error: insertError } = await client.from("proof_reviews").insert({
      submission_id: id.data,
      reviewer_github_id: session.github_id,
      reviewer_github_username: session.github_username,
      reviewer_wallet: session.wallet_address,
      decision: parsed.data.decision,
    });
    if (insertError) {
      if (insertError.code === "23505") return apiError("You already reviewed this proof", 409);
      if (insertError.code === "P0001") return apiError("This proof cannot accept that review", 409);
      throw new Error(insertError.message);
    }

    const { data: updated, error: updatedError } = await client
      .from("proof_submissions").select("status").eq("id", id.data).single();
    if (updatedError) throw new Error(updatedError.message);
    return apiResponse({ success: true, status: updated.status });
  } catch (error) {
    console.error(
      "[proof-missions/review] Failure:",
      error instanceof Error ? error.message : error,
    );
    return apiError("Proof reviews are temporarily unavailable", 503);
  }
}
