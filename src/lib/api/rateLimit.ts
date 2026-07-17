import { createHash } from "node:crypto";
import { type NextRequest, type NextResponse } from "next/server";
import { apiError } from "./helpers";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

interface RateLimitConfig {
  limit: number;
  windowMs: number;
}

interface RateLimitResult {
  isAllowed: boolean;
  retryAfterSeconds: number;
}

const localStore = new Map<string, RateLimitEntry>();
const CLEANUP_INTERVAL_MS = 60_000;
let lastCleanupAt = Date.now();

const PRESETS = {
  upload: { limit: 10, windowMs: 60_000 },
  launch: { limit: 20, windowMs: 60_000 },
  github: { limit: 30, windowMs: 60_000 },
  record: { limit: 15, windowMs: 60_000 },
  match: { limit: 5, windowMs: 60_000 },
  default: { limit: 60, windowMs: 60_000 },
} as const satisfies Record<string, RateLimitConfig>;

export type RateLimitPreset = keyof typeof PRESETS;

function cleanupLocalStore(now: number) {
  if (now - lastCleanupAt < CLEANUP_INTERVAL_MS) return;
  lastCleanupAt = now;
  for (const [key, entry] of localStore) {
    if (now >= entry.resetAt) localStore.delete(key);
  }
}

function getClientIp(request: NextRequest): string | null {
  const forwardedFor = request.headers.get("x-vercel-forwarded-for") ??
    request.headers.get("x-forwarded-for");
  const ip = forwardedFor?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip")?.trim();
  return ip && ip.length <= 64 ? ip : null;
}

function getRateLimitKey(request: NextRequest, preset: RateLimitPreset): string | null {
  const ip = getClientIp(request);
  if (!ip) return null;
  return createHash("sha256").update(`${preset}:${ip}`).digest("hex");
}

function checkLocalRateLimit(key: string, config: RateLimitConfig): RateLimitResult {
  const now = Date.now();
  cleanupLocalStore(now);
  const entry = localStore.get(key);

  if (!entry || now >= entry.resetAt) {
    localStore.set(key, { count: 1, resetAt: now + config.windowMs });
    return { isAllowed: true, retryAfterSeconds: 0 };
  }

  entry.count += 1;
  return {
    isAllowed: entry.count <= config.limit,
    retryAfterSeconds: Math.max(Math.ceil((entry.resetAt - now) / 1_000), 1),
  };
}

function parseDistributedResult(data: unknown): RateLimitResult {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") throw new Error("Missing rate limit result");

  const isAllowed = Reflect.get(row, "is_allowed");
  const retryAfterSeconds = Reflect.get(row, "retry_after_seconds");
  if (typeof isAllowed !== "boolean" || !Number.isInteger(retryAfterSeconds)) {
    throw new Error("Invalid rate limit result");
  }
  return { isAllowed, retryAfterSeconds };
}

async function checkDistributedRateLimit(
  key: string,
  config: RateLimitConfig,
): Promise<RateLimitResult> {
  const { getServerClient } = await import("@/lib/supabase");
  const { data, error } = await getServerClient().rpc("consume_rate_limit", {
    p_key_hash: key,
    p_limit: config.limit,
    p_window_seconds: Math.ceil(config.windowMs / 1_000),
  });
  if (error) throw new Error(error.message);
  return parseDistributedResult(data);
}

function rateLimitError(retryAfterSeconds: number): NextResponse {
  const response = apiError(
    `Rate limit exceeded. Retry after ${retryAfterSeconds}s`,
    429,
  );
  response.headers.set("Retry-After", String(retryAfterSeconds));
  return response;
}

/**
 * Uses the shared Postgres limiter in production. Local development uses an
 * in-memory fallback so it does not require production infrastructure.
 */
export async function checkRateLimit(
  request: NextRequest,
  preset: RateLimitPreset = "default",
): Promise<NextResponse | null> {
  const key = getRateLimitKey(request, preset);
  const isProduction = process.env.NODE_ENV === "production";

  if (!key) {
    return isProduction ? apiError("Request rate limiting is unavailable", 503) : null;
  }

  try {
    const result = isProduction
      ? await checkDistributedRateLimit(key, PRESETS[preset])
      : checkLocalRateLimit(key, PRESETS[preset]);
    return result.isAllowed ? null : rateLimitError(result.retryAfterSeconds);
  } catch (error) {
    console.error(
      "[rate-limit] Shared limiter unavailable:",
      error instanceof Error ? error.message : "Unknown error",
    );
    return isProduction ? apiError("Request rate limiting is unavailable", 503) : null;
  }
}
