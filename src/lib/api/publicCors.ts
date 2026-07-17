import { type NextRequest, NextResponse } from "next/server";
import { checkRateLimit, type RateLimitPreset } from "./rateLimit";

/**
 * Credentialless responder for read-only public API routes. ACAO `*`,
 * GET/HEAD/OPTIONS only, no cookies. The global same-origin CORS helper
 * (helpers.ts) is untouched: mutation routes keep exact same-origin checks and
 * the webhook route gets no CORS at all.
 *
 * Every response path an external consumer can reach MUST carry these headers,
 * including rate-limit 429/503 and thrown errors, so a failure never reads as a
 * silent cross-origin block. Use the helpers below on every return.
 */
const PUBLIC_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  Vary: "Origin",
} as const;

type HeaderInit = Record<string, string>;

function withCors(extra?: HeaderInit): HeaderInit {
  return { ...PUBLIC_CORS_HEADERS, ...extra };
}

export function publicJson<T>(data: T, status = 200, headers?: HeaderInit): NextResponse {
  return NextResponse.json(data, { status, headers: withCors(headers) });
}

export function publicError(message: string, status = 400, headers?: HeaderInit): NextResponse {
  return NextResponse.json({ error: message }, { status, headers: withCors(headers) });
}

export function publicOptions(): NextResponse {
  return new NextResponse(null, { status: 204, headers: withCors() });
}

/**
 * Rate-limit guard for public routes. Returns a `*`-CORS 429/503 when limited or
 * when the limiter is unavailable; null when the request may proceed. The shared
 * limiter emits static single-origin CORS, so we re-clothe its response and copy
 * across the Retry-After hint.
 */
export async function guardPublic(
  request: NextRequest,
  preset: RateLimitPreset,
): Promise<NextResponse | null> {
  const limited = await checkRateLimit(request, preset);
  if (!limited) return null;

  const retryAfter = limited.headers.get("Retry-After");
  const extra: HeaderInit = retryAfter ? { "Retry-After": retryAfter } : {};
  let message = "Rate limit exceeded";
  try {
    const body = (await limited.clone().json()) as { error?: string };
    if (body.error) message = body.error;
  } catch {
    // Non-JSON limiter body: fall back to the generic message.
  }
  return publicError(message, limited.status, extra);
}

/**
 * Wraps a public GET handler so any thrown error still serializes with `*` CORS
 * as a 503 (verification unavailable), never as an absent-CORS opaque failure.
 */
export async function runPublic(
  handler: () => Promise<NextResponse>,
): Promise<NextResponse> {
  try {
    return await handler();
  } catch (error) {
    console.error("[public-api] Unhandled error:", error instanceof Error ? error.message : error);
    return publicError("Verification service unavailable", 503);
  }
}
