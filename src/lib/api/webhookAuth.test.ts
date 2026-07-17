import assert from "node:assert/strict";
import test from "node:test";
import {
  WEBHOOK_MAX_BATCH,
  WEBHOOK_MAX_BYTES,
  extractAuthToken,
  isValidWebhookSecret,
  readCappedBody,
} from "./webhookAuth";

function withSecret<T>(secret: string | undefined, run: () => T): T {
  const previous = process.env.HELIUS_WEBHOOK_SECRET;
  if (secret === undefined) {
    Reflect.deleteProperty(process.env, "HELIUS_WEBHOOK_SECRET");
  } else {
    process.env.HELIUS_WEBHOOK_SECRET = secret;
  }
  try {
    return run();
  } finally {
    if (previous === undefined) {
      Reflect.deleteProperty(process.env, "HELIUS_WEBHOOK_SECRET");
    } else {
      process.env.HELIUS_WEBHOOK_SECRET = previous;
    }
  }
}

function streamFrom(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

test("constant-time secret check accepts the exact secret", () => {
  withSecret("s3cr3t-value", () => {
    assert.equal(isValidWebhookSecret("s3cr3t-value"), true);
  });
});

test("constant-time secret check rejects a wrong same-length secret", () => {
  withSecret("s3cr3t-value", () => {
    assert.equal(isValidWebhookSecret("s3cr3t-wrong"), false);
  });
});

test("secret check fails closed when the env var is unset", () => {
  withSecret(undefined, () => {
    assert.equal(isValidWebhookSecret("anything"), false);
  });
});

test("secret check rejects a wrong-length value", () => {
  withSecret("s3cr3t-value", () => {
    assert.equal(isValidWebhookSecret("short"), false);
  });
});

test("secret check rejects null or empty received values", () => {
  withSecret("s3cr3t-value", () => {
    assert.equal(isValidWebhookSecret(null), false);
    assert.equal(isValidWebhookSecret(undefined), false);
    assert.equal(isValidWebhookSecret(""), false);
  });
});

test("extractAuthToken strips a Bearer prefix or returns the raw header", () => {
  assert.equal(extractAuthToken("Bearer token-123"), "token-123");
  assert.equal(extractAuthToken("raw-token"), "raw-token");
  assert.equal(extractAuthToken(null), null);
});

test("readCappedBody returns the merged bytes under the cap", async () => {
  const body = streamFrom([new Uint8Array([1, 2, 3]), new Uint8Array([4, 5])]);
  const result = await readCappedBody(body, 16);
  assert.deepEqual(result, new Uint8Array([1, 2, 3, 4, 5]));
});

test("readCappedBody returns null once the cap is exceeded", async () => {
  const body = streamFrom([new Uint8Array([1, 2, 3]), new Uint8Array([4, 5, 6])]);
  const result = await readCappedBody(body, 4);
  assert.equal(result, null);
});

test("readCappedBody returns an empty array for a null body", async () => {
  const result = await readCappedBody(null);
  assert.deepEqual(result, new Uint8Array(0));
});

test("byte and batch caps are exposed as constants", () => {
  assert.equal(WEBHOOK_MAX_BYTES, 512 * 1024);
  assert.equal(WEBHOOK_MAX_BATCH, 100);
});
