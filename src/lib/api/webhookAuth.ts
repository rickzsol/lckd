import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time bearer check against the per-environment Helius webhook secret.
 * Helius sends no HMAC; it only echoes the configured static authHeader, so this
 * is the only trust anchor. Compared BEFORE parsing the body. Returns false when
 * the secret is unset (fail closed).
 */
export function isValidWebhookSecret(received: string | null | undefined): boolean {
  const expected = process.env.HELIUS_WEBHOOK_SECRET;
  if (!received || !expected) return false;

  const expectedBuf = Buffer.from(expected, "utf8");
  const receivedBuf = Buffer.from(received, "utf8");
  if (expectedBuf.length !== receivedBuf.length) return false;
  return timingSafeEqual(expectedBuf, receivedBuf);
}

/** Extracts the bearer value from an Authorization header, or the raw header. */
export function extractAuthToken(authorization: string | null): string | null {
  if (!authorization) return null;
  return authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length)
    : authorization;
}

export const WEBHOOK_MAX_BYTES = 512 * 1024;
export const WEBHOOK_MAX_BATCH = 100;

/**
 * Reads a request body stream up to a hard byte cap. Content-Length is a hint,
 * not a bound, so the cap is enforced on actually-streamed bytes. Returns null
 * when the cap is exceeded.
 */
export async function readCappedBody(
  body: ReadableStream<Uint8Array> | null,
  maxBytes = WEBHOOK_MAX_BYTES,
): Promise<Uint8Array | null> {
  if (!body) return new Uint8Array(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}
