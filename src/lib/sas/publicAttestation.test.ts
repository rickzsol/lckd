import assert from "node:assert/strict";
import test from "node:test";

import { attestationExplorerUrl, getTrustAnchorDescriptor } from "./publicAttestation";

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

const VALID_MINT = "So11111111111111111111111111111111111111112";

test("attestationExplorerUrl appends the devnet cluster suffix only on devnet", () => {
  assert.equal(
    attestationExplorerUrl("Pda11111111111111111111111111111111111111111", "devnet"),
    "https://explorer.solana.com/address/Pda11111111111111111111111111111111111111111?cluster=devnet",
  );
  assert.equal(
    attestationExplorerUrl("Pda11111111111111111111111111111111111111111", "mainnet"),
    "https://explorer.solana.com/address/Pda11111111111111111111111111111111111111111",
  );
});

// Finding 1 anchor seam: getTrustAnchorDescriptor is the documented interface this
// branch provides to the trust API. Without a live attestation (here: no supabase
// config, so the public read short-circuits) it returns null rather than a partial
// descriptor, so a caller renders "no anchor".
test("getTrustAnchorDescriptor returns null when there is no public attestation", async () => {
  await withEnv(
    { NEXT_PUBLIC_SUPABASE_URL: undefined, NEXT_PUBLIC_SUPABASE_ANON_KEY: undefined },
    async () => {
      assert.equal(await getTrustAnchorDescriptor(VALID_MINT), null);
    },
  );
});

test("getTrustAnchorDescriptor returns null for a malformed mint", async () => {
  assert.equal(await getTrustAnchorDescriptor("not-a-mint"), null);
});
