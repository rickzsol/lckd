import assert from "node:assert/strict";
import test from "node:test";
import {
  allocationCounterpartyLabel,
  allocationMovementLabel,
} from "./presentation";

test("provisional sale classifications never render as settled sold activity", () => {
  assert.equal(allocationMovementLabel("sold", false), "sale signal");
  assert.equal(allocationMovementLabel("sold", true), "sold");
});

test("untracked counterparties are not presented as known recipients", () => {
  assert.equal(
    allocationCounterpartyLabel("ExternalWallet111", false),
    "an external wallet",
  );
  assert.equal(
    allocationCounterpartyLabel("TrackedWallet111", true),
    "TrackedWallet111",
  );
  assert.equal(allocationCounterpartyLabel(null, null), null);
});
