import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/app/api/auth/[...nextauth]/route";
import { PublicKey } from "@solana/web3.js";
import nacl from "tweetnacl";
import { linkWallet } from "@/lib/profile";

interface LinkWalletBody {
  walletAddress: string;
  signature: string;
  message: string;
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.github_id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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

  // Validate the message format contains the correct username
  if (!message.includes(`Username: ${session.github_username}`)) {
    return NextResponse.json(
      { error: "Message does not match session user" },
      { status: 403 },
    );
  }

  // Verify timestamp is within 5 minutes
  const tsMatch = message.match(/Timestamp: (\d+)/);
  if (!tsMatch) {
    return NextResponse.json(
      { error: "Missing timestamp in message" },
      { status: 400 },
    );
  }
  const ts = Number(tsMatch[1]);
  if (Math.abs(Date.now() - ts) > 5 * 60 * 1000) {
    return NextResponse.json(
      { error: "Message expired" },
      { status: 400 },
    );
  }

  // Verify the ed25519 signature
  try {
    const pubkey = new PublicKey(walletAddress);
    const msgBytes = new TextEncoder().encode(message);
    const sigBytes = Uint8Array.from(Buffer.from(signature, "base64"));

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
    return NextResponse.json(
      { error: result.error ?? "Failed to link wallet" },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true });
}
