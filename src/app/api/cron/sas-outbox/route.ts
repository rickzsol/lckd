import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";

import { hasServerSupabaseConfig } from "@/lib/supabase";
import { isSasEnabled } from "@/lib/sas/config";
import { runOutboxWorker } from "@/lib/sas/worker";
import { expireAttestations } from "@/lib/sas/outbox";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_JOBS_PER_RUN = 5;

function isValidSecret(received: string | null | undefined): boolean {
  const expected = process.env.CRON_SECRET;
  if (!received || !expected) return false;
  const expectedBuf = Buffer.from(expected);
  const receivedBuf = Buffer.from(received);
  if (expectedBuf.length !== receivedBuf.length) return false;
  return timingSafeEqual(expectedBuf, receivedBuf);
}

export async function GET(req: Request) {
  const authorization = req.headers.get("authorization");
  const secret = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : null;
  if (!isValidSecret(secret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isSasEnabled()) {
    return NextResponse.json({ message: "SAS issuance disabled", skipped: true });
  }
  if (!hasServerSupabaseConfig()) {
    return NextResponse.json({ error: "Cron service unavailable" }, { status: 503 });
  }

  // Expire lapsed attestations first so the active slot frees before issuance.
  let expired = 0;
  try {
    expired = await expireAttestations();
  } catch (error) {
    console.error("[sas-outbox] expiry sweep failed:", error);
  }

  try {
    const result = await runOutboxWorker(MAX_JOBS_PER_RUN);
    return NextResponse.json({ ...result, expired });
  } catch (error) {
    console.error("[sas-outbox] worker failed:", error);
    return NextResponse.json({ error: "Outbox worker failed", expired }, { status: 500 });
  }
}
