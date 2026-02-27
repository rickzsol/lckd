import { type NextRequest } from "next/server";
import { z } from "zod";
import { apiResponse, apiError, OPTIONS } from "@/lib/api/helpers";
import { requireAuth } from "@/lib/api/auth";
import { checkRateLimit } from "@/lib/api/rateLimit";
import { getServerClient } from "@/lib/supabase";
import { isValidSolanaAddress } from "@/lib/api/validation";

export { OPTIONS };

const solanaAddress = z.string().refine(isValidSolanaAddress, "Invalid Solana address");

const lockUpdateSchema = z.object({
  mintAddress: solanaAddress,
  lockTxSignature: z.string().min(1),
  name: z.undefined().optional(),
});

const fullRecordSchema = z.object({
  mintAddress: solanaAddress,
  name: z.string().min(1).max(64),
  ticker: z.string().min(1).max(10),
  description: z.string().max(1000).default(""),
  imageUri: z.string().max(500).default(""),
  creatorWallet: solanaAddress,
  launchTxSignature: z.string().default(""),
  lockTxSignature: z.string().default(""),
  lockDurationDays: z.number().int().min(0).default(0),
  lockPercentage: z.number().min(0).max(100).default(0),
  lockAmount: z.string().default("0"),
  buyAmountSol: z.number().min(0).default(0),
  githubUsername: z.string().nullable().default(null),
  githubRepo: z.string().nullable().default(null),
  liveUrl: z.string().nullable().default(null),
  twitterUrl: z.string().url().nullable().default(null),
  telegramUrl: z.string().url().nullable().default(null),
  websiteUrl: z.string().url().nullable().default(null),
});

export async function POST(request: NextRequest) {
  const limited = checkRateLimit(request, "record");
  if (limited) return limited;

  const { session, error: authErr } = await requireAuth();
  if (authErr) return authErr;

  try {
    const raw = await request.json();
    const supabase = getServerClient();

    // Partial update — only lockTxSignature provided
    if (raw.lockTxSignature && !raw.name) {
      const parsed = lockUpdateSchema.safeParse(raw);
      if (!parsed.success) {
        return apiError(parsed.error.issues[0].message, 400);
      }

      const { error } = await supabase
        .from("tokens")
        .update({ lock_tx: parsed.data.lockTxSignature })
        .eq("mint_address", parsed.data.mintAddress);

      if (error) {
        console.error("[token/record] Lock update error:", error.message);
        return apiError("Failed to update lock signature", 500);
      }
      return apiResponse({ success: true, updated: true }, 200);
    }

    // Full record
    const parsed = fullRecordSchema.safeParse(raw);
    if (!parsed.success) {
      return apiError(parsed.error.issues[0].message, 400);
    }

    const body = parsed.data;

    // Verify the session user matches the request
    if (body.githubUsername && body.githubUsername !== session.github_username) {
      return apiError("githubUsername does not match authenticated user", 403);
    }

    const { error } = await supabase.from("tokens").upsert(
      {
        mint_address: body.mintAddress,
        name: body.name.trim(),
        ticker: body.ticker.trim(),
        description: body.description,
        image_uri: body.imageUri,
        creator_wallet: body.creatorWallet,
        launch_tx: body.launchTxSignature,
        lock_tx: body.lockTxSignature,
        lock_duration_days: body.lockDurationDays,
        lock_percentage: body.lockPercentage,
        lock_amount: body.lockAmount,
        buy_amount_sol: body.buyAmountSol,
        github_username: body.githubUsername,
        github_repo: body.githubRepo,
        live_url: body.liveUrl,
        twitter_url: body.twitterUrl,
        telegram_url: body.telegramUrl,
        website_url: body.websiteUrl,
        trust_tier: 1,
      },
      { onConflict: "mint_address" },
    );

    if (error) {
      console.error("[token/record] Supabase error:", error.message);
      return apiError("Failed to record token", 500);
    }

    return apiResponse({ success: true }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Record failed";
    console.error("[token/record] Error:", message);
    return apiError("Record failed", 500);
  }
}
