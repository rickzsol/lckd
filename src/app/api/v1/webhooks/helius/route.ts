import { NextResponse, type NextRequest } from "next/server";
import {
  extractAuthToken,
  isValidWebhookSecret,
  readCappedBody,
  WEBHOOK_MAX_BATCH,
} from "@/lib/api/webhookAuth";
import { insertInboxEvents, normalizeHeliusBatch } from "@/lib/trust/webhookInbox";
import { getServerClient, hasServerSupabaseConfig } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// This route gets NO CORS: it is a server-to-server webhook, never browser-called.
function json(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, { status });
}

/**
 * Helius enhanced webhook receiver. Order is load-bearing:
 *  1. constant-time bearer check BEFORE reading the body (403 on mismatch)
 *  2. content-type + streamed byte cap (Content-Length is only a hint)
 *  3. bounded-batch parse + normalize
 *  4. durable idempotent insert into webhook_inbox, then ack < 1s
 * 5xx only when the durable insert itself fails. Processing is async (cron).
 */
export async function POST(request: NextRequest) {
  const token = extractAuthToken(request.headers.get("authorization"));
  if (!isValidWebhookSecret(token)) {
    return json({ error: "Forbidden" }, 403);
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return json({ error: "Unsupported content type" }, 415);
  }

  const bytes = await readCappedBody(request.body);
  if (bytes === null) {
    return json({ error: "Payload too large" }, 413);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const batch = Array.isArray(parsed) ? parsed : null;
  if (!batch) {
    return json({ error: "Expected an event array" }, 400);
  }
  if (batch.length > WEBHOOK_MAX_BATCH) {
    return json({ error: "Batch too large" }, 413);
  }

  const events = normalizeHeliusBatch(batch);

  if (!hasServerSupabaseConfig()) {
    // Fail closed: without durable storage we cannot guarantee at-least-once.
    return json({ error: "Inbox unavailable" }, 503);
  }

  try {
    const inserted = await insertInboxEvents(getServerClient(), events);
    return json({ received: batch.length, inserted }, 200);
  } catch (error) {
    console.error("[webhook/helius] durable insert failed:", error instanceof Error ? error.message : error);
    return json({ error: "Failed to persist events" }, 503);
  }
}
