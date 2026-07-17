import { apiError } from "./helpers";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function normalizeOrigin(value: string): string | null {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function getAllowedOrigins(request: Request): Set<string> {
  const configuredOrigins = [
    process.env.NEXTAUTH_URL,
    process.env.ALLOWED_ORIGIN,
    process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : undefined,
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined,
  ];

  if (process.env.NODE_ENV !== "production") {
    configuredOrigins.push("http://localhost:3000", "http://127.0.0.1:3000");
  }

  const origins = new Set(
    configuredOrigins
      .filter((value): value is string => Boolean(value))
      .flatMap((value) => value.split(","))
      .map((value) => normalizeOrigin(value.trim()))
      .filter((value): value is string => Boolean(value)),
  );

  if (origins.size === 0) {
    const requestOrigin = normalizeOrigin(request.url);
    if (requestOrigin) origins.add(requestOrigin);
  }

  return origins;
}

/** Reject cross-site cookie-authenticated mutations before any state change. */
export function requireSameOrigin(request: Request) {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return null;

  if (request.headers.get("sec-fetch-site") === "cross-site") {
    return apiError("Cross-site request rejected", 403);
  }

  const source = request.headers.get("origin") ?? request.headers.get("referer");
  const sourceOrigin = source ? normalizeOrigin(source) : null;

  if (!sourceOrigin || !getAllowedOrigins(request).has(sourceOrigin)) {
    return apiError("Invalid request origin", 403);
  }

  return null;
}
