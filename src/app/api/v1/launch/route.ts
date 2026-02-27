import { type NextRequest } from "next/server";
import { z } from "zod";
import { PublicKey } from "@solana/web3.js";
import { apiResponse, apiError, OPTIONS } from "@/lib/api/helpers";
import { requireAuth } from "@/lib/api/auth";
import { checkRateLimit } from "@/lib/api/rateLimit";
import { isValidSolanaAddress } from "@/lib/api/validation";
import { buildCreateTransaction } from "@/lib/solana/launchTransaction";

export { OPTIONS };

const solanaAddress = z.string().refine(isValidSolanaAddress, "Invalid Solana address");

const launchSchema = z.object({
  walletPublicKey: solanaAddress,
  mintPublicKey: solanaAddress,
  metadataUri: z.string().url(),
  name: z.string().min(1).max(64),
  ticker: z.string().min(1).max(10),
  description: z.string().max(1000).default(""),
  buyAmountSol: z.number().positive(),
  skipLock: z.boolean().default(false),
  lockDurationDays: z.number().int().min(0).default(0),
  lockPercentage: z.number().min(0).max(100).default(0),
  githubUsername: z.string().nullable().optional(),
  githubRepo: z.string().nullable().optional(),
  liveUrl: z.string().nullable().optional(),
  twitterUrl: z.string().nullable().optional(),
  telegramUrl: z.string().nullable().optional(),
  websiteUrl: z.string().nullable().optional(),
}).refine(
  (d) => d.skipLock || (d.lockDurationDays >= 1 && d.lockPercentage >= 1),
  { message: "Lock duration and percentage required when skipLock is false" },
);

export async function POST(request: NextRequest) {
  const limited = checkRateLimit(request, "launch");
  if (limited) return limited;

  const { error: authErr } = await requireAuth();
  if (authErr) return authErr;

  try {
    const raw = await request.json();
    const parsed = launchSchema.safeParse(raw);
    if (!parsed.success) {
      return apiError(parsed.error.issues[0].message, 400);
    }

    const body = parsed.data;
    const walletPubkey = new PublicKey(body.walletPublicKey);
    const mintPubkey = new PublicKey(body.mintPublicKey);

    const config = {
      name: body.name.trim(),
      ticker: body.ticker.trim(),
      description: body.description,
      image: null as File | null,
      imageUri: body.metadataUri,
      buyAmountSol: body.buyAmountSol,
      skipLock: body.skipLock,
      lockDurationDays: body.skipLock ? 0 : body.lockDurationDays,
      lockPercentage: body.skipLock ? 0 : body.lockPercentage,
      githubUsername: body.githubUsername ?? null,
      githubRepo: body.githubRepo ?? null,
      liveUrl: body.liveUrl ?? null,
      twitterUrl: body.twitterUrl ?? null,
      telegramUrl: body.telegramUrl ?? null,
      websiteUrl: body.websiteUrl ?? null,
    };

    const { txBytes } = await buildCreateTransaction(
      config,
      walletPubkey,
      mintPubkey,
      body.metadataUri,
    );

    const txBase64 = Buffer.from(txBytes).toString("base64");

    return apiResponse({
      transaction: txBase64,
      mintPublicKey: body.mintPublicKey,
    }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Launch transaction build failed";
    console.error("[launch] Error:", message);
    return apiError("Launch transaction build failed", 500);
  }
}
