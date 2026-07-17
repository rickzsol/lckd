import { NextResponse, type NextRequest } from "next/server";
import { isValidSolanaAddress } from "@/lib/api/validation";
import { checkRateLimit } from "@/lib/api/rateLimit";
import { fetchHolderIntel } from "@/lib/ricomaps";
import type { RicomapsResult } from "@/lib/ricomaps.client";

const PUBLIC_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function publicResult(result: RicomapsResult): NextResponse {
  const response = NextResponse.json(result, { status: 200, headers: PUBLIC_CORS_HEADERS });
  if (result.status === "pending") {
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Retry-After", String(result.retryAfterSeconds ?? 5));
  } else if (result.status === "fresh" || result.status === "stale") {
    response.headers.set("Cache-Control", "s-maxage=30, stale-while-revalidate=60");
  } else {
    response.headers.set("Cache-Control", "no-store");
  }
  return response;
}

function publicError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status, headers: PUBLIC_CORS_HEADERS });
}

export function OPTIONS(): NextResponse {
  return new NextResponse(null, { status: 204, headers: PUBLIC_CORS_HEADERS });
}

export function HEAD(): NextResponse {
  return new NextResponse(null, { status: 204, headers: PUBLIC_CORS_HEADERS });
}

async function handleGet(
  request: NextRequest,
  { params }: { params: Promise<{ ca: string }> },
): Promise<NextResponse> {
  const { ca } = await params;
  if (!isValidSolanaAddress(ca)) return publicError("A valid token address is required", 400);

  const limited = await checkRateLimit(request, "holder_analytics");
  if (limited) {
    const body = await limited.json().catch(() => ({ error: "Rate limit exceeded" }));
    const response = publicError(body.error ?? "Rate limit exceeded", limited.status);
    const retryAfter = limited.headers.get("Retry-After");
    if (retryAfter) response.headers.set("Retry-After", retryAfter);
    return response;
  }

  const result = await fetchHolderIntel(ca);
  return publicResult(result);
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ ca: string }> },
): Promise<NextResponse> {
  try {
    return await handleGet(request, context);
  } catch (error) {
    console.error("[holder-intel] unhandled route error:", error instanceof Error ? error.message : "Unknown error");
    return publicError("Holder analytics unavailable", 503);
  }
}
