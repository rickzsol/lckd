import { NextResponse, type NextRequest } from "next/server";
import { isValidSolanaAddress } from "@/lib/api/validation";
import { checkRateLimit } from "@/lib/api/rateLimit";
import { fetchHolderIntel } from "@/lib/ricomaps";

const PUBLIC_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function publicResponse<T>(data: T, status = 200): NextResponse {
  const response = NextResponse.json(data, { status, headers: PUBLIC_CORS_HEADERS });
  if (status === 200) response.headers.set("Cache-Control", "s-maxage=30, stale-while-revalidate=60");
  return response;
}

function publicError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status, headers: PUBLIC_CORS_HEADERS });
}

export function OPTIONS(): NextResponse {
  return new NextResponse(null, { status: 204, headers: PUBLIC_CORS_HEADERS });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ca: string }> },
) {
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
  if (result.status === "unavailable") {
    return publicError("Holder analytics unavailable", 503);
  }

  return publicResponse(result);
}
