import { createHash, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";

const ACCESS_COOKIE = "lckd_access";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function POST(request: NextRequest) {
  let code: unknown;
  try {
    ({ code } = await request.json());
  } catch {
    return NextResponse.json({ error: "invalid request" }, { status: 400 });
  }

  if (typeof code !== "string" || code.length === 0 || code.length > 128) {
    return NextResponse.json({ error: "invalid code" }, { status: 401 });
  }

  // Fail closed in production: the fallback code is public in this repo.
  const accessCode =
    process.env.LCKD_ACCESS_CODE ??
    (process.env.NODE_ENV === "production" ? null : "nulllckd");
  if (!accessCode) {
    return NextResponse.json({ error: "invalid code" }, { status: 401 });
  }

  const expected = sha256Hex(accessCode);
  const provided = sha256Hex(code);
  const isValid = timingSafeEqual(Buffer.from(expected), Buffer.from(provided));

  if (!isValid) {
    return NextResponse.json({ error: "invalid code" }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(ACCESS_COOKIE, expected, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  });
  return response;
}
