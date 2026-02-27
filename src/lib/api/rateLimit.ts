import { type NextRequest } from "next/server";
import { apiError } from "./helpers";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

const CLEANUP_INTERVAL = 60_000;
let lastCleanup = Date.now();

function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;
  for (const [key, entry] of store) {
    if (now > entry.resetAt) store.delete(key);
  }
}

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown"
  );
}

interface RateLimitConfig {
  /** Max requests per window */
  limit: number;
  /** Window size in milliseconds */
  windowMs: number;
}

const PRESETS = {
  /** File uploads: 10 req / 60s */
  upload: { limit: 10, windowMs: 60_000 } as RateLimitConfig,
  /** Transaction building: 20 req / 60s */
  launch: { limit: 20, windowMs: 60_000 } as RateLimitConfig,
  /** GitHub proxy: 30 req / 60s */
  github: { limit: 30, windowMs: 60_000 } as RateLimitConfig,
  /** Token record: 15 req / 60s */
  record: { limit: 15, windowMs: 60_000 } as RateLimitConfig,
  /** Default: 60 req / 60s */
  default: { limit: 60, windowMs: 60_000 } as RateLimitConfig,
} as const;

export type RateLimitPreset = keyof typeof PRESETS;

/**
 * Check rate limit for a request. Returns null if allowed, or an error response if limited.
 */
export function checkRateLimit(
  request: NextRequest,
  preset: RateLimitPreset = "default",
) {
  cleanup();

  const config = PRESETS[preset];
  const ip = getClientIp(request);
  const key = `${preset}:${ip}`;
  const now = Date.now();

  const entry = store.get(key);

  if (!entry || now > entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + config.windowMs });
    return null;
  }

  entry.count++;

  if (entry.count > config.limit) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    return apiError(`Rate limit exceeded. Retry after ${retryAfter}s`, 429);
  }

  return null;
}
