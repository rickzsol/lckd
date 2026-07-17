import { NextRequest, NextResponse } from "next/server";

const ACCESS_COOKIE = "lckd_access";

let expectedHashPromise: Promise<string | null> | null = null;

async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function getExpectedHash(): Promise<string | null> {
  if (!expectedHashPromise) {
    // Fail closed in production: the fallback code is public in this repo.
    const accessCode =
      process.env.LCKD_ACCESS_CODE ??
      (process.env.NODE_ENV === "production" ? null : "nulllckd");
    expectedHashPromise = accessCode
      ? sha256Hex(accessCode)
      : Promise.resolve(null);
  }
  return expectedHashPromise;
}

export async function proxy(request: NextRequest) {
  const cookie = request.cookies.get(ACCESS_COOKIE)?.value;
  const expectedHash = await getExpectedHash();
  if (cookie && expectedHash && cookie === expectedHash) {
    return NextResponse.next();
  }

  const url = request.nextUrl.clone();
  url.pathname = "/coming-soon";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  // Gate all pages; leave api routes, next internals, the gate itself, and any file asset open.
  matcher: ["/((?!api|_next|coming-soon|.*\\..*).*)"],
};
