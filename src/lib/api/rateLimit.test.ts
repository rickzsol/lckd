import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { checkGlobalRateLimit, checkRateLimit } from "./rateLimit";

test("local limiter rejects requests above the preset and sets Retry-After", async () => {
  const request = new NextRequest("http://localhost/api/v1/metadata/upload", {
    headers: { "x-forwarded-for": "192.0.2.10" },
  });

  for (let requestNumber = 0; requestNumber < 10; requestNumber += 1) {
    assert.equal(await checkRateLimit(request, "upload"), null);
  }

  const limited = await checkRateLimit(request, "upload");
  assert.equal(limited?.status, 429);
  assert.equal(limited?.headers.get("Retry-After"), "60");
});

test("production fails closed when the trusted client IP is unavailable", async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  Reflect.set(process.env, "NODE_ENV", "production");
  try {
    const request = new NextRequest("https://lckd.tech/api/v1/launch");
    const response = await checkRateLimit(request, "launch");
    assert.equal(response?.status, 503);
  } finally {
    if (previousNodeEnv === undefined) {
      Reflect.deleteProperty(process.env, "NODE_ENV");
    } else {
      Reflect.set(process.env, "NODE_ENV", previousNodeEnv);
    }
  }
});

test("global quote budget limits aggregate upstream work", async () => {
  for (let requestNumber = 0; requestNumber < 6; requestNumber += 1) {
    assert.equal(await checkGlobalRateLimit("tradeQuoteGlobal"), null);
  }
  assert.equal((await checkGlobalRateLimit("tradeQuoteGlobal"))?.status, 429);
});
