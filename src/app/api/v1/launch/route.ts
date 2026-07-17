import { type NextRequest } from "next/server";
import { z } from "zod";
import { PublicKey } from "@solana/web3.js";
import { apiResponse, apiError, OPTIONS } from "@/lib/api/helpers";
import { requireLinkedWallet } from "@/lib/api/auth";
import { requireSameOrigin } from "@/lib/api/origin";
import { checkRateLimit } from "@/lib/api/rateLimit";
import { isValidSolanaAddress } from "@/lib/api/validation";
import { buildCreateTransaction } from "@/lib/solana/launchTransaction";

export { OPTIONS };

const solanaAddress = z.string().refine(isValidSolanaAddress, "Invalid Solana address");
const nullableHttpsUrl = z.string().url().refine(
  (value) => new URL(value).protocol === "https:",
  "URL must use HTTPS",
).nullable().optional();

const launchSchema = z.object({
  walletPublicKey: solanaAddress,
  mintPublicKey: solanaAddress,
  metadataUri: z.string().url().max(200).refine(
    (value) => new URL(value).protocol === "https:",
    "Metadata URI must use HTTPS",
  ),
  name: z.string().trim().min(1).max(32),
  ticker: z.string().trim().min(1).max(13),
  description: z.string().max(1000).default(""),
  buyAmountSol: z.number().finite().min(0.01).max(100),
  lockDurationDays: z.number().int().min(7).max(365),
  lockPercentage: z.number().int().min(50).max(100),
  githubUsername: z.string().nullable().optional(),
  githubRepo: z.string().nullable().optional(),
  liveUrl: nullableHttpsUrl,
  twitterUrl: nullableHttpsUrl,
  telegramUrl: nullableHttpsUrl,
  websiteUrl: nullableHttpsUrl,
});

export async function POST(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const limited = checkRateLimit(request, "launch");
  if (limited) return limited;

  const { session, error: authErr } = await requireLinkedWallet();
  if (authErr) return authErr;

  try {
    const raw = await request.json();
    const parsed = launchSchema.safeParse(raw);
    if (!parsed.success) {
      return apiError(parsed.error.issues[0].message, 400);
    }

    const body = parsed.data;
    if (body.walletPublicKey !== session.wallet_address) {
      return apiError("walletPublicKey does not match the linked wallet", 403);
    }
    const walletPubkey = new PublicKey(body.walletPublicKey);
    const mintPubkey = new PublicKey(body.mintPublicKey);

    const config = {
      name: body.name.trim(),
      ticker: body.ticker.trim(),
      description: body.description,
      image: null as File | null,
      imageUri: body.metadataUri,
      buyAmountSol: body.buyAmountSol,
      lockDurationDays: body.lockDurationDays,
      lockPercentage: body.lockPercentage,
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
