import { type NextRequest } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { apiResponse, apiError, OPTIONS } from "@/lib/api/helpers";
import { isValidSolanaAddress } from "@/lib/api/validation";
import { buildCreateTransaction } from "@/lib/solana/launchTransaction";

export { OPTIONS };

interface LaunchRequestBody {
  walletPublicKey: string;
  metadataUri: string;
  name: string;
  ticker: string;
  description: string;
  buyAmountSol: number;
  skipLock?: boolean;
  lockDurationDays: number;
  lockPercentage: number;
  githubUsername?: string | null;
  githubRepo?: string | null;
  liveUrl?: string | null;
  twitterUrl?: string | null;
  telegramUrl?: string | null;
  websiteUrl?: string | null;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as LaunchRequestBody;

    if (!body.walletPublicKey || !isValidSolanaAddress(body.walletPublicKey)) {
      return apiError("Valid walletPublicKey is required", 400);
    }
    if (!body.metadataUri) return apiError("metadataUri is required", 400);
    if (!body.name || body.name.trim().length === 0) return apiError("name is required", 400);
    if (!body.ticker || body.ticker.trim().length === 0) return apiError("ticker is required", 400);
    if (body.ticker.length > 10) return apiError("ticker must be 10 characters or fewer", 400);
    if (!body.buyAmountSol || body.buyAmountSol <= 0) return apiError("buyAmountSol must be > 0", 400);
    if (!body.skipLock) {
      if (!body.lockDurationDays || body.lockDurationDays < 1) return apiError("lockDurationDays must be >= 1", 400);
      if (!body.lockPercentage || body.lockPercentage < 1 || body.lockPercentage > 100) {
        return apiError("lockPercentage must be between 1 and 100", 400);
      }
    }

    const walletPubkey = new PublicKey(body.walletPublicKey);

    const config = {
      name: body.name.trim(),
      ticker: body.ticker.trim(),
      description: body.description ?? "",
      image: null as File | null,
      imageUri: body.metadataUri,
      buyAmountSol: body.buyAmountSol,
      skipLock: body.skipLock ?? false,
      lockDurationDays: body.skipLock ? 0 : body.lockDurationDays,
      lockPercentage: body.skipLock ? 0 : body.lockPercentage,
      githubUsername: body.githubUsername ?? null,
      githubRepo: body.githubRepo ?? null,
      liveUrl: body.liveUrl ?? null,
      twitterUrl: body.twitterUrl ?? null,
      telegramUrl: body.telegramUrl ?? null,
      websiteUrl: body.websiteUrl ?? null,
    };

    const { txBytes, mintKeypair } = await buildCreateTransaction(
      config,
      walletPubkey,
      body.metadataUri,
    );

    const txBase64 = Buffer.from(txBytes).toString("base64");
    const mintSecretBase64 = Buffer.from(mintKeypair.secretKey).toString("base64");

    return apiResponse({
      transaction: txBase64,
      mintPublicKey: mintKeypair.publicKey.toBase58(),
      mintSecretKey: mintSecretBase64,
    }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Launch transaction build failed";
    return apiError(message, 500);
  }
}
