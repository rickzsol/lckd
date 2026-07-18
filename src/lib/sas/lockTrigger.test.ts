import assert from "node:assert/strict";
import test from "node:test";

import {
  decideCloseOutcome,
  shouldAdvanceServicedRev,
  triggerExpiredLockClose,
} from "./lockTrigger";

function withEnv(vars: Record<string, string | undefined>, fn: () => Promise<void>): Promise<void> {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return fn().finally(() => {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
}

// Item 1: SAS disabled must NOT clear the durable marker. A previously issued
// on-chain attestation may still be live; the deployment cannot revoke it while
// disabled, so the request stays pending until SAS is re-enabled. Both the pure
// decision AND the real entry point (which short-circuits on the flag before any DB
// call) must return "retry", never a terminal clear.
test("SAS-disabled does not clear the marker (pure decision)", () => {
  assert.equal(decideCloseOutcome({ sasEnabled: false }), "retry");
  // Even if a live attestation is known absent, disabled still refuses to clear:
  // the on-chain state cannot be trusted while the deployment cannot read/close it.
  assert.equal(
    decideCloseOutcome({ sasEnabled: false, hasOpenIssuanceJob: false, currentEvidenceHash: "" }),
    "retry",
  );
});

test("SAS-disabled does not clear the marker (triggerExpiredLockClose)", async () => {
  await withEnv({ SAS_ENABLED: "false" }, async () => {
    const outcome = await triggerExpiredLockClose({ tokenId: "t1" });
    assert.equal(outcome, "retry");
  });
});

// Item 2: an in-flight/open reissue must retry, never clear. Between the initial
// read and the close enqueue a reissue can transiently show no live attestation and
// then create a replacement; retrying lets the cron close that replacement once the
// reissue settles. A failed open-job read is also treated as in-flight (retry).
test("in-flight reissue retries and does not clear", () => {
  assert.equal(
    decideCloseOutcome({ sasEnabled: true, hasOpenIssuanceJob: true }),
    "retry",
  );
  // Even with no live attestation currently visible (the reissue's close half ran,
  // the create half has not), an open job forces retry rather than a false no-op.
  assert.equal(
    decideCloseOutcome({ sasEnabled: true, hasOpenIssuanceJob: true, currentEvidenceHash: "" }),
    "retry",
  );
});

test("failed open-job read retries and does not clear", () => {
  assert.equal(
    decideCloseOutcome({ sasEnabled: true, hasOpenIssuanceJob: null }),
    "retry",
  );
});

// Sanity: with nothing in flight, the decision is stable and terminal.
test("no open job, live attestation, close enqueued -> enqueued (terminal)", () => {
  assert.equal(
    decideCloseOutcome({
      sasEnabled: true,
      hasOpenIssuanceJob: false,
      currentEvidenceHash: "abc",
      closeEnqueued: true,
    }),
    "enqueued",
  );
});

test("no open job and provably no live attestation -> nothing_to_revoke", () => {
  assert.equal(
    decideCloseOutcome({ sasEnabled: true, hasOpenIssuanceJob: false, currentEvidenceHash: "" }),
    "nothing_to_revoke",
  );
});

test("live-attestation read failure retries", () => {
  assert.equal(
    decideCloseOutcome({ sasEnabled: true, hasOpenIssuanceJob: false, currentEvidenceHash: null }),
    "retry",
  );
});

test("close declined with row vanished (no open job) -> nothing_to_revoke", () => {
  assert.equal(
    decideCloseOutcome({
      sasEnabled: true,
      hasOpenIssuanceJob: false,
      currentEvidenceHash: "abc",
      closeEnqueued: false,
      closeDeclinedReason: "no_live_attestation",
    }),
    "nothing_to_revoke",
  );
});

test("close declined with config change (disabled/unconfigured) -> retry", () => {
  for (const reason of ["disabled", "unconfigured"] as const) {
    assert.equal(
      decideCloseOutcome({
        sasEnabled: true,
        hasOpenIssuanceJob: false,
        currentEvidenceHash: "abc",
        closeEnqueued: false,
        closeDeclinedReason: reason,
      }),
      "retry",
      `${reason} must retry, not clear`,
    );
  }
});

// Item 3: a newer revocation request arriving while one is in flight must not be
// erased. The cron records the rev it OBSERVED; the guard only advances serviced_rev
// when requested_rev is unchanged since. A bump past the observed rev keeps the token
// pending so the replacement attestation is closed next pass.
test("newer revocation request is not erased by a stale clear", () => {
  // Observed rev 1, serviced 0, and requested_rev is STILL 1: safe to advance.
  assert.equal(shouldAdvanceServicedRev(1, 1, 0), true);
  // A newer downgrade bumped requested_rev to 2 while we were servicing rev 1:
  // the stale clear must NOT advance, so the token stays pending (2 > 0).
  assert.equal(shouldAdvanceServicedRev(1, 2, 0), false);
  // Already serviced at or beyond the observed rev: nothing to advance.
  assert.equal(shouldAdvanceServicedRev(1, 1, 1), false);
  assert.equal(shouldAdvanceServicedRev(1, 1, 2), false);
});

test("monotonic marker keeps a token pending until the LATEST request is serviced", () => {
  // Model the erase-a-newer-request scenario end to end with plain arithmetic that
  // mirrors the SQL guard. Two requests (rev 1 then rev 2); servicing rev 1 must not
  // clear the pending state created by rev 2.
  const requestedAfterSecondDowngrade = 2;
  let serviced = 0;

  // Cron pass A observed rev 1 and finishes servicing it, but rev is now 2.
  if (shouldAdvanceServicedRev(1, requestedAfterSecondDowngrade, serviced)) serviced = 1;
  assert.equal(serviced, 0, "servicing the stale rev must not advance");
  assert.ok(requestedAfterSecondDowngrade > serviced, "token stays pending for rev 2");

  // Cron pass B observes rev 2 and services it: now it clears.
  if (shouldAdvanceServicedRev(2, requestedAfterSecondDowngrade, serviced)) serviced = 2;
  assert.equal(serviced, 2);
  assert.ok(requestedAfterSecondDowngrade === serviced, "no longer pending");
});
