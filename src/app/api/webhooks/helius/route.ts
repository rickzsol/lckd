import { timingSafeEqual } from "node:crypto";
import { type NextRequest, NextResponse } from "next/server";
import { ingestEnhancedPayload, IngestError } from "@/lib/allocations/ingest";

// Receiver for the shared Helius enhanced webhook. Helius echoes the
// authHeader configured at webhook creation; a mismatch returns 403,
// the one status Helius never retries. Processing errors return 503 so
// Helius retries; idempotent inserts make replays safe.

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_BODY_BYTES = 5_000_000;

function isAuthorized(received: string | null): boolean {
  const expected = process.env.HELIUS_WEBHOOK_SECRET;
  if (!received || !expected) return false;
  const receivedBuf = Buffer.from(received);
  const expectedBuf = Buffer.from(expected);
  if (receivedBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(receivedBuf, expectedBuf);
}

export async function POST(request: NextRequest) {
  if (!isAuthorized(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    const result = await ingestEnhancedPayload(payload);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof IngestError) {
      console.error("[webhooks/helius] Ingest failed:", error.message);
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[webhooks/helius] Unexpected ingest failure:", error);
    return NextResponse.json({ error: "Ingest failed" }, { status: 503 });
  }
}
