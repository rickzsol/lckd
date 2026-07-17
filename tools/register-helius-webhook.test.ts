import assert from "node:assert/strict";
import test from "node:test";
import { enforceAddressCeiling, MAX_ADDRESSES } from "./register-helius-webhook";

test("an address set within the ceiling passes through unchanged", () => {
  const addrs = ["a", "b", "c"];
  assert.deepEqual(enforceAddressCeiling(addrs), addrs);
});

test("a set exactly at the ceiling is accepted", () => {
  const addrs = Array.from({ length: MAX_ADDRESSES }, (_, i) => `addr-${i}`);
  assert.equal(enforceAddressCeiling(addrs).length, MAX_ADDRESSES);
});

test("an over-ceiling set throws instead of silently truncating (finding 14)", () => {
  const addrs = Array.from({ length: MAX_ADDRESSES + 1 }, (_, i) => `addr-${i}`);
  assert.throws(() => enforceAddressCeiling(addrs), /exceeds the Helius per-webhook ceiling/);
});
