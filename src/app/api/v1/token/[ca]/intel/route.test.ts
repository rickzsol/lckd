import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { GET, OPTIONS, HEAD } from "./route";

const VALID_MINT = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";

function makeRequest(ca: string, ip = "203.0.113.5"): { request: NextRequest; params: Promise<{ ca: string }> } {
  return {
    request: new NextRequest(`http://localhost/api/v1/token/${ca}/intel`, {
      headers: { "x-forwarded-for": ip },
    }),
    params: Promise.resolve({ ca }),
  };
}

test("GET returns 400 with CORS headers for an invalid mint", async () => {
  const { request, params } = makeRequest("not-a-real-mint");
  const response = await GET(request, { params });
  assert.equal(response.status, 400);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
  const body = await response.json();
  assert.match(body.error, /valid token address/i);
});

test("GET returns 429 with Retry-After once the holder_analytics preset is exhausted", async () => {
  const ip = "203.0.113.77";
  let lastResponse;
  for (let i = 0; i < 31; i += 1) {
    const { request, params } = makeRequest(VALID_MINT, ip);
    lastResponse = await GET(request, { params });
  }
  assert.equal(lastResponse?.status, 429);
  assert.equal(lastResponse?.headers.get("Access-Control-Allow-Origin"), "*");
  assert.ok(lastResponse?.headers.get("Retry-After"));
});

test("GET returns an unavailable envelope with CORS headers when the upstream fetch fails", async () => {
  const previousUrl = process.env.RICOMAPS_API_URL;
  const previousKey = process.env.RICOMAPS_API_KEY;
  const previousFixtures = process.env.RICOMAPS_FIXTURES;
  Reflect.set(process.env, "RICOMAPS_API_URL", "http://127.0.0.1:1/unreachable");
  Reflect.set(process.env, "RICOMAPS_API_KEY", "test-key");
  Reflect.deleteProperty(process.env, "RICOMAPS_FIXTURES");
  try {
    const { request, params } = makeRequest(VALID_MINT, "203.0.113.88");
    const response = await GET(request, { params });
    assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
    const body = await response.json();
    assert.equal(body.status, "unavailable");
  } finally {
    if (previousUrl !== undefined) Reflect.set(process.env, "RICOMAPS_API_URL", previousUrl);
    else Reflect.deleteProperty(process.env, "RICOMAPS_API_URL");
    if (previousKey !== undefined) Reflect.set(process.env, "RICOMAPS_API_KEY", previousKey);
    else Reflect.deleteProperty(process.env, "RICOMAPS_API_KEY");
    if (previousFixtures !== undefined) Reflect.set(process.env, "RICOMAPS_FIXTURES", previousFixtures);
  }
});

test("GET returns a CORS-bearing 503 when an unexpected exception escapes the handler", async () => {
  const request = new NextRequest(`http://localhost/api/v1/token/${VALID_MINT}/intel`, {
    headers: { "x-forwarded-for": "203.0.113.99" },
  });
  const params: Promise<{ ca: string }> = Promise.reject(new Error("boom"));
  const response = await GET(request, { params });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
  const body = await response.json();
  assert.match(body.error, /unavailable/i);
});

test("OPTIONS returns 204 with CORS headers", () => {
  const response = OPTIONS();
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
  assert.equal(response.headers.get("Access-Control-Allow-Methods"), "GET, HEAD, OPTIONS");
});

test("HEAD returns 204 with CORS headers", () => {
  const response = HEAD();
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("Access-Control-Allow-Origin"), "*");
});
