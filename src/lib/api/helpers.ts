import { NextResponse } from "next/server";

const ALLOWED_ORIGIN =
  process.env.NODE_ENV === "development"
    ? "http://localhost:3000"
    : (process.env.ALLOWED_ORIGIN ?? "https://lckd.tech");

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export function apiResponse<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: CORS_HEADERS });
}

export function apiError(message: string, status = 400): NextResponse {
  return NextResponse.json({ error: message }, { status, headers: CORS_HEADERS });
}

export function OPTIONS(): NextResponse {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}
