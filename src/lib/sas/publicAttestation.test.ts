import assert from "node:assert/strict";
import test from "node:test";

import {
  attestationExplorerUrl,
  buildTrustAnchorDescriptor,
  getTrustAnchorDescriptor,
  type PublicAttestation,
} from "./publicAttestation";
import { address } from "gill";

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

// Anchor-mismatch defect: getTrustAnchorDescriptor combines the attestation's
// STORED cluster/schema_version with CURRENT-environment PDAs. If the stored
// attestation was issued for a different cluster or schema version than the config
// now pins, blindly returning a descriptor emits a false, unverifiable anchor
// (e.g. a devnet/schema-v1 attestation paired with mainnet/schema-v2 PDAs). The
// pure builder must return null on any such mismatch, never a mixed descriptor.
const CRED_PDA = address("11111111111111111111111111111112");
const SCHEMA_PDA = address("SysvarC1ock11111111111111111111111111111111");

function att(over: Partial<PublicAttestation> = {}): PublicAttestation {
  return {
    cluster: "devnet",
    mint: "So11111111111111111111111111111111111111112",
    tier: 2,
    policyVersion: 1,
    schemaVersion: 1,
    attestationPda: "Pda11111111111111111111111111111111111111111",
    expiryTs: "2030-01-01T00:00:00Z",
    txSignature: "sig",
    ...over,
  };
}

const DEVNET_CONFIG = { cluster: "devnet" as const, credentialPda: CRED_PDA, schemaPda: SCHEMA_PDA };
const MAINNET_CONFIG = { cluster: "mainnet" as const, credentialPda: CRED_PDA, schemaPda: SCHEMA_PDA };

test("buildTrustAnchorDescriptor returns a descriptor when cluster and schema match", () => {
  const d = buildTrustAnchorDescriptor(att(), DEVNET_CONFIG, 1);
  assert.ok(d);
  assert.equal(d.cluster, "devnet");
  assert.equal(d.schemaVersion, 1);
  assert.equal(d.credentialPda, CRED_PDA.toString());
  assert.equal(d.attestationPda, "Pda11111111111111111111111111111111111111111");
});

test("buildTrustAnchorDescriptor returns null on a cluster mismatch", () => {
  // Stored devnet attestation, current config points at mainnet: mixing them would
  // pair devnet's attestation PDA with mainnet's credential/schema PDAs.
  assert.equal(buildTrustAnchorDescriptor(att({ cluster: "devnet" }), MAINNET_CONFIG, 1), null);
});

test("buildTrustAnchorDescriptor returns null on a schema-version mismatch", () => {
  // Stored schema v1, environment now at schema v2: the config schema PDA describes
  // a different schema than the attestation was issued under.
  assert.equal(buildTrustAnchorDescriptor(att({ schemaVersion: 1 }), DEVNET_CONFIG, 2), null);
});

test("buildTrustAnchorDescriptor rejects both mismatches at once", () => {
  assert.equal(
    buildTrustAnchorDescriptor(att({ cluster: "devnet", schemaVersion: 1 }), MAINNET_CONFIG, 3),
    null,
  );
});
