import assert from "node:assert/strict";
import test from "node:test";
import {
  formatRawAmount,
  parseTokenAmountToRaw,
  percentOfSupply,
} from "./format";

test("formats raw amounts with M and K suffixes", () => {
  assert.equal(formatRawAmount("460000000000000"), "460.0M");
  assert.equal(formatRawAmount("12500000000"), "12.5K");
  assert.equal(formatRawAmount("42000000"), "42");
  assert.equal(formatRawAmount("garbage"), "0");
});

test("computes percent of the fixed supply", () => {
  assert.equal(percentOfSupply("500000000000000"), "50.0");
  assert.equal(percentOfSupply("152000000000000"), "15.2");
  assert.equal(percentOfSupply("0"), "0.0");
});

test("parses human token amounts into raw base units", () => {
  assert.equal(parseTokenAmountToRaw("150000000"), "150000000000000");
  assert.equal(parseTokenAmountToRaw("12.5"), "12500000");
  assert.equal(parseTokenAmountToRaw("1,000,000"), "1000000000000");
  assert.equal(parseTokenAmountToRaw("0.000001"), "1");
});

test("rejects malformed, zero, and oversupply amounts", () => {
  assert.equal(parseTokenAmountToRaw("0"), null);
  assert.equal(parseTokenAmountToRaw("-5"), null);
  assert.equal(parseTokenAmountToRaw("1.1234567"), null);
  assert.equal(parseTokenAmountToRaw("1000000001"), null);
  assert.equal(parseTokenAmountToRaw("12abc"), null);
  assert.equal(parseTokenAmountToRaw(""), null);
});
