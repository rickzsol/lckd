import assert from "node:assert/strict";
import test from "node:test";
import { backoffSeconds, shouldDeadLetter } from "./inboxConsumer";

test("backoff doubles from 30s per attempt", () => {
  assert.equal(backoffSeconds(1), 30);
  assert.equal(backoffSeconds(2), 60);
  assert.equal(backoffSeconds(3), 120);
  assert.equal(backoffSeconds(4), 240);
});

test("backoff clamps a zero or negative attempt count to the base", () => {
  assert.equal(backoffSeconds(0), 30);
  assert.equal(backoffSeconds(-5), 30);
});

test("backoff is capped at one hour", () => {
  assert.equal(backoffSeconds(20), 3_600);
  assert.equal(backoffSeconds(1_000), 3_600);
});

test("shouldDeadLetter triggers at or above five attempts", () => {
  assert.equal(shouldDeadLetter(4), false);
  assert.equal(shouldDeadLetter(5), true);
  assert.equal(shouldDeadLetter(6), true);
});
