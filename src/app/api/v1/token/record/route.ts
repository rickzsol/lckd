import { type NextRequest } from "next/server";
import { apiResponse, apiError, OPTIONS } from "@/lib/api/helpers";
import { createServerClient } from "@/lib/supabase";
import { isValidSolanaAddress } from "@/lib/api/validation";

export { OPTIONS };

interface RecordBody {
  mintAddress: string;
  name: string;
  ticker: string;
  description: string;
  imageUri: string;
  creatorWallet: string;
  launchTxSignature: string;
  lockTxSignature: string;
  lockDurationDays: number;
  lockPercentage: number;
  lockAmount: string;
  buyAmountSol: number;
  githubUsername: string | null;
  githubRepo: string | null;
  liveUrl: string | null;
  twitterUrl: string | null;
  telegramUrl: string | null;
  websiteUrl: string | null;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as RecordBody;

    if (!body.mintAddress || !isValidSolanaAddress(body.mintAddress)) {
      return apiError("Valid mintAddress is required", 400);
    }
    if (!body.creatorWallet || !isValidSolanaAddress(body.creatorWallet)) {
      return apiError("Valid creatorWallet is required", 400);
    }
    if (!body.name?.trim()) return apiError("name is required", 400);
    if (!body.ticker?.trim()) return apiError("ticker is required", 400);

    const supabase = createServerClient();

    const { error } = await supabase.from("tokens").upsert(
      {
        mint_address: body.mintAddress,
        name: body.name.trim(),
        ticker: body.ticker.trim(),
        description: body.description ?? "",
        image_uri: body.imageUri ?? "",
        creator_wallet: body.creatorWallet,
        launch_tx: body.launchTxSignature ?? "",
        lock_tx: body.lockTxSignature ?? "",
        lock_duration_days: body.lockDurationDays ?? 0,
        lock_percentage: body.lockPercentage ?? 0,
        lock_amount: body.lockAmount ?? "0",
        buy_amount_sol: body.buyAmountSol ?? 0,
        github_username: body.githubUsername ?? null,
        github_repo: body.githubRepo ?? null,
        live_url: body.liveUrl ?? null,
        twitter_url: body.twitterUrl ?? null,
        telegram_url: body.telegramUrl ?? null,
        website_url: body.websiteUrl ?? null,
        trust_tier: 1,
      },
      { onConflict: "mint_address" },
    );

    if (error) {
      console.error("[token/record] Supabase error:", error.message);
      return apiError(`Failed to record: ${error.message}`, 500);
    }

    return apiResponse({ success: true }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Record failed";
    console.error("[token/record] Error:", message);
    return apiError(message, 500);
  }
}
