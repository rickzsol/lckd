import { type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/api/auth";
import { apiError, apiResponse, OPTIONS } from "@/lib/api/helpers";
import { requireSameOrigin } from "@/lib/api/origin";
import { checkRateLimit } from "@/lib/api/rateLimit";
import {
  RobinhoodRecoveryError,
  RobinhoodRetryableError,
  checkpointRobinhoodIntent,
  getRobinhoodIntent,
  latestRobinhoodIntent,
  markRobinhoodIntentAmbiguous,
  normalizeRobinhoodHash,
  normalizeRobinhoodIntent,
  normalizeRobinhoodSalt,
  normalizeRobinhoodWallet,
  prepareRobinhoodIntent,
  reconcileRobinhoodIntent,
  robinhoodIntentResponse,
} from "@/lib/api/robinhoodLaunchRecovery";

export { OPTIONS };

const postSchema = z.discriminatedUnion("phase", [
  z.object({
    phase: z.literal("prepared"),
    walletAddress: z.string(),
    salt: z.string(),
    config: z.unknown(),
  }).strict(),
  z.object({
    phase: z.literal("submitted"),
    walletAddress: z.string(),
    salt: z.string(),
    transactionHash: z.string(),
  }).strict(),
  z.object({
    phase: z.literal("ambiguous"),
    walletAddress: z.string(),
    salt: z.string(),
  }).strict(),
  z.object({
    phase: z.literal("reconcile"),
    walletAddress: z.string(),
    salt: z.string(),
  }).strict(),
]);

function recoveryError(error: unknown) {
  if (error instanceof RobinhoodRetryableError) {
    return apiResponse({ error: error.message, retryable: true }, error.status);
  }
  if (error instanceof RobinhoodRecoveryError) return apiError(error.message, error.status);
  console.error("[robinhood/recovery] Backend unavailable:", error);
  return apiError("Robinhood launch recovery is unavailable", 503);
}

export async function GET(request: NextRequest) {
  const limited = await checkRateLimit(request, "launch");
  if (limited) return limited;
  const auth = await requireAuth();
  if (auth.error) return auth.error;

  try {
    const walletAddress = normalizeRobinhoodWallet(request.nextUrl.searchParams.get("walletAddress"));
    const existing = await latestRobinhoodIntent(auth.session.identity_id, walletAddress);
    if (!existing) return apiResponse({ intent: null });
    return apiResponse({ intent: robinhoodIntentResponse(existing) });
  } catch (error) {
    return recoveryError(error);
  }
}

export async function POST(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const limited = await checkRateLimit(request, "launch");
  if (limited) return limited;
  const auth = await requireAuth();
  if (auth.error) return auth.error;
  const parsed = postSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError(parsed.error.issues[0].message, 400);

  try {
    if (parsed.data.phase === "prepared") {
      const normalized = normalizeRobinhoodIntent(parsed.data);
      const intent = await prepareRobinhoodIntent(auth.session.identity_id, normalized);
      return apiResponse({ intent: robinhoodIntentResponse(intent) });
    }
    const wallet = normalizeRobinhoodWallet(parsed.data.walletAddress);
    const salt = normalizeRobinhoodSalt(parsed.data.salt);
    if (parsed.data.phase === "ambiguous") {
      const intent = await markRobinhoodIntentAmbiguous(auth.session.identity_id, wallet, salt);
      return apiResponse({ intent: robinhoodIntentResponse(intent) });
    }
    if (parsed.data.phase === "reconcile") {
      const current = await getRobinhoodIntent(auth.session.identity_id, wallet, salt);
      if (!["submitted", "ambiguous"].includes(current.status)) {
        return apiError("Reconciliation checkpoint is out of order", 409);
      }
      const intent = await reconcileRobinhoodIntent(current);
      return apiResponse({ intent: robinhoodIntentResponse(intent) });
    }
    const transactionHash = normalizeRobinhoodHash(parsed.data.transactionHash);
    const intent = await checkpointRobinhoodIntent(
      auth.session.identity_id,
      wallet,
      salt,
      transactionHash,
    );
    return apiResponse({ intent: robinhoodIntentResponse(intent) });
  } catch (error) {
    return recoveryError(error);
  }
}
