import { NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";
import { linkWallet } from "@/lib/profile";
import { requireAuth, requireLinkedWallet } from "@/lib/api/auth";
import { requireSameOrigin } from "@/lib/api/origin";

const EXPECTED_PREFIX = "Link wallet to lckd.tech";

interface LinkWalletBody {
  walletAddress: string;
  signature: string;
  message: string;
}

export async function GET() {
  const { session, error } = await requireLinkedWallet();
  if (error) return error;
  return NextResponse.json({ walletAddress: session.wallet_address });
}

export async function POST(req: Request) {
  const originError = requireSameOrigin(req);
  if (originError) return originError;

  const { session, error: authError } = await requireAuth();
  if (authError) return authError;

  let body: LinkWalletBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { walletAddress, signature, message } = body;
  if (!walletAddress || !signature || !message) {
    return NextResponse.json(
      { error: "Missing walletAddress, signature, or message" },
      { status: 400 },
    );
  }

  // Validate exact message format:
  // "LCKD Wallet Verification\nUsername: <username>\nTimestamp: <ts>"
  const expectedPattern = new RegExp(
    `^${EXPECTED_PREFIX}\\nUsername: ${escapeRegex(session.github_username)}\\nTimestamp: (\\d+)$`,
  );
  const match = message.match(expectedPattern);
  if (!match) {
    return NextResponse.json(
      { error: "Message format does not match expected template" },
      { status: 403 },
    );
  }

  // Verify timestamp is within 5 minutes
  const ts = Number(match[1]);
  if (Math.abs(Date.now() - ts) > 5 * 60 * 1000) {
    return NextResponse.json(
      { error: "Message expired" },
      { status: 400 },
    );
  }

  // Verify the ed25519 signature
  try {
    const pubkey = new PublicKey(walletAddress);
    if (pubkey.toBase58() !== walletAddress) {
      return NextResponse.json({ error: "Invalid wallet address" }, { status: 400 });
    }
    const msgBytes = new TextEncoder().encode(message);
    const sigBytes = Uint8Array.from(Buffer.from(signature, "base64"));
    if (sigBytes.length !== nacl.sign.signatureLength) {
      return NextResponse.json({ error: "Invalid signature length" }, { status: 400 });
    }

    const isValid = nacl.sign.detached.verify(
      msgBytes,
      sigBytes,
      pubkey.toBytes(),
    );

    if (!isValid) {
      return NextResponse.json(
        { error: "Invalid signature" },
        { status: 403 },
      );
    }
  } catch {
    return NextResponse.json(
      { error: "Signature verification failed" },
      { status: 400 },
    );
  }

  const result = await linkWallet(session.github_id, walletAddress);
  if (!result.success) {
    const status = result.code === "conflict" ? 409 : result.code === "not_found" ? 404 : 503;
    return NextResponse.json(
      { error: result.error ?? "Failed to link wallet" },
      { status },
    );
  }

  return NextResponse.json({ success: true });
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
