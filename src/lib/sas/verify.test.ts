import assert from "node:assert/strict";
import test from "node:test";

import {
  getAttestationEncoder,
  getSchemaEncoder,
  SOLANA_ATTESTATION_SERVICE_PROGRAM_ADDRESS,
  deriveAttestationPda,
} from "sas-lib";
import { address, type Address, type ReadonlyUint8Array } from "gill";

import {
  SCHEMA_FIELDS,
  SCHEMA_LAYOUT,
  SCHEMA_VERSION,
  TRUST_TIER,
  serializeTrustData,
} from "./schema";
import { verifyTrustAttestation } from "./verify";

const CREDENTIAL = address("11111111111111111111111111111112") as Address;
const SCHEMA_PDA = address("SysvarC1ock11111111111111111111111111111111") as Address;
const WRONG_CREDENTIAL = address("SysvarRent111111111111111111111111111111111") as Address;
const MINT = "So11111111111111111111111111111111111111112";
const OTHER_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

function encodeFieldNames(fields: readonly string[]): Uint8Array {
  const encoder = new TextEncoder();
  const parts: number[] = [];
  for (const field of fields) {
    const bytes = encoder.encode(field);
    const len = bytes.length;
    parts.push(len & 0xff, (len >> 8) & 0xff, (len >> 16) & 0xff, (len >> 24) & 0xff, ...bytes);
  }
  return Uint8Array.from(parts);
}

function schemaAccountBytes(
  overrides: { credential?: Address; version?: number; layout?: Uint8Array; isPaused?: boolean } = {},
): ReadonlyUint8Array {
  return getSchemaEncoder().encode({
    discriminator: 0,
    credential: overrides.credential ?? CREDENTIAL,
    name: new TextEncoder().encode("lckd-trust-v1"),
    description: new TextEncoder().encode("desc"),
    layout: overrides.layout ?? SCHEMA_LAYOUT,
    fieldNames: encodeFieldNames(SCHEMA_FIELDS),
    isPaused: overrides.isPaused ?? false,
    version: overrides.version ?? SCHEMA_VERSION,
  });
}

function attestationAccountBytes(
  nonce: Address,
  expiry: bigint,
  data: Uint8Array,
  overrides: { credential?: Address; schema?: Address } = {},
): ReadonlyUint8Array {
  return getAttestationEncoder().encode({
    discriminator: 0,
    nonce,
    credential: overrides.credential ?? CREDENTIAL,
    schema: overrides.schema ?? SCHEMA_PDA,
    data,
    signer: CREDENTIAL,
    expiry,
    tokenAccount: CREDENTIAL,
  });
}

interface AccountFixture {
  bytes: Uint8Array | ReadonlyUint8Array;
  owner?: string;
}

/** Mock RPC that serves prebuilt base64 accounts keyed by address. */
function mockRpc(accounts: Map<string, AccountFixture>) {
  return {
    getAccountInfo(addr: Address) {
      return {
        send: async () => {
          const fixture = accounts.get(addr.toString());
          if (!fixture) return { value: null };
          return {
            value: {
              data: [Buffer.from(Uint8Array.from(fixture.bytes)).toString("base64"), "base64"],
              owner: fixture.owner ?? SOLANA_ATTESTATION_SERVICE_PROGRAM_ADDRESS,
              executable: false,
              lamports: BigInt(1_000_000),
              space: BigInt(fixture.bytes.length),
              rentEpoch: BigInt(0),
            },
          };
        },
      };
    },
  } as never;
}

const FUTURE = BigInt(Math.floor(Date.now() / 1000) + 86_400);
const PAST = BigInt(Math.floor(Date.now() / 1000) - 86_400);

function validData(mint: string, cliffTs: bigint = FUTURE) {
  return serializeTrustData({
    mint,
    creator: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
    stream_id: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d",
    tier: TRUST_TIER.BUILDER,
    lock_bps: 6500,
    cliff_ts: cliffTs,
    policy_version: 1,
    github: "octocat",
  });
}

async function attestationPdaFor(mint: string): Promise<Address> {
  const [pda] = await deriveAttestationPda({
    credential: CREDENTIAL,
    schema: SCHEMA_PDA,
    nonce: address(mint),
  });
  return pda;
}

test("verifies a valid pinned attestation", async () => {
  const pda = await attestationPdaFor(MINT);
  const accounts = new Map<string, AccountFixture>([
    [SCHEMA_PDA.toString(), { bytes: schemaAccountBytes() }],
    [pda.toString(), { bytes: attestationAccountBytes(address(MINT), FUTURE, validData(MINT)) }],
  ]);
  const result = await verifyTrustAttestation(mockRpc(accounts), { credentialPda: CREDENTIAL, schemaPda: SCHEMA_PDA }, MINT);
  assert.equal(result.verified, true);
  if (result.verified) assert.equal(result.data.mint, MINT);
});

test("rejects a missing schema", async () => {
  const accounts = new Map<string, AccountFixture>();
  const result = await verifyTrustAttestation(mockRpc(accounts), { credentialPda: CREDENTIAL, schemaPda: SCHEMA_PDA }, MINT);
  assert.deepEqual(result, { verified: false, reason: "schema_not_found" });
});

test("rejects a schema under the wrong credential", async () => {
  const accounts = new Map<string, AccountFixture>([
    [SCHEMA_PDA.toString(), { bytes: schemaAccountBytes({ credential: WRONG_CREDENTIAL }) }],
  ]);
  const result = await verifyTrustAttestation(mockRpc(accounts), { credentialPda: CREDENTIAL, schemaPda: SCHEMA_PDA }, MINT);
  assert.deepEqual(result, { verified: false, reason: "wrong_credential" });
});

test("rejects a wrong schema version", async () => {
  const accounts = new Map<string, AccountFixture>([
    [SCHEMA_PDA.toString(), { bytes: schemaAccountBytes({ version: 2 }) }],
  ]);
  const result = await verifyTrustAttestation(mockRpc(accounts), { credentialPda: CREDENTIAL, schemaPda: SCHEMA_PDA }, MINT);
  assert.deepEqual(result, { verified: false, reason: "wrong_schema_version" });
});

test("rejects a mismatched layout", async () => {
  const accounts = new Map<string, AccountFixture>([
    [SCHEMA_PDA.toString(), { bytes: schemaAccountBytes({ layout: Uint8Array.from([12, 0, 12]) }) }],
  ]);
  const result = await verifyTrustAttestation(mockRpc(accounts), { credentialPda: CREDENTIAL, schemaPda: SCHEMA_PDA }, MINT);
  assert.deepEqual(result, { verified: false, reason: "wrong_layout" });
});

test("rejects a missing attestation", async () => {
  const accounts = new Map<string, AccountFixture>([
    [SCHEMA_PDA.toString(), { bytes: schemaAccountBytes() }],
  ]);
  const result = await verifyTrustAttestation(mockRpc(accounts), { credentialPda: CREDENTIAL, schemaPda: SCHEMA_PDA }, MINT);
  assert.deepEqual(result, { verified: false, reason: "attestation_not_found" });
});

test("rejects an expired attestation", async () => {
  const pda = await attestationPdaFor(MINT);
  const accounts = new Map<string, AccountFixture>([
    [SCHEMA_PDA.toString(), { bytes: schemaAccountBytes() }],
    [pda.toString(), { bytes: attestationAccountBytes(address(MINT), PAST, validData(MINT)) }],
  ]);
  const result = await verifyTrustAttestation(mockRpc(accounts), { credentialPda: CREDENTIAL, schemaPda: SCHEMA_PDA }, MINT);
  assert.deepEqual(result, { verified: false, reason: "expired" });
});

test("rejects when the payload mint does not match the queried mint", async () => {
  // Attestation stored at MINT's PDA but carrying OTHER_MINT in its payload.
  const pda = await attestationPdaFor(MINT);
  const accounts = new Map<string, AccountFixture>([
    [SCHEMA_PDA.toString(), { bytes: schemaAccountBytes() }],
    [pda.toString(), { bytes: attestationAccountBytes(address(MINT), FUTURE, validData(OTHER_MINT)) }],
  ]);
  const result = await verifyTrustAttestation(mockRpc(accounts), { credentialPda: CREDENTIAL, schemaPda: SCHEMA_PDA }, MINT);
  assert.deepEqual(result, { verified: false, reason: "mint_mismatch" });
});

// F7: a paused schema no longer issues attestations, so trust bound to it must
// not verify even if the attestation account is otherwise valid.
test("rejects a paused schema", async () => {
  const pda = await attestationPdaFor(MINT);
  const accounts = new Map<string, AccountFixture>([
    [SCHEMA_PDA.toString(), { bytes: schemaAccountBytes({ isPaused: true }) }],
    [pda.toString(), { bytes: attestationAccountBytes(address(MINT), FUTURE, validData(MINT)) }],
  ]);
  const result = await verifyTrustAttestation(mockRpc(accounts), { credentialPda: CREDENTIAL, schemaPda: SCHEMA_PDA }, MINT);
  assert.deepEqual(result, { verified: false, reason: "schema_paused" });
});

// F7: a past payload cliff hidden behind a future outer expiry would verify a
// lock that has already ended. The payload cliff MUST equal the outer expiry.
test("rejects a payload cliff that does not match the outer expiry", async () => {
  const pda = await attestationPdaFor(MINT);
  // Outer expiry is in the future, but the payload cliff is in the past.
  const accounts = new Map<string, AccountFixture>([
    [SCHEMA_PDA.toString(), { bytes: schemaAccountBytes() }],
    [pda.toString(), { bytes: attestationAccountBytes(address(MINT), FUTURE, validData(MINT, PAST)) }],
  ]);
  const result = await verifyTrustAttestation(mockRpc(accounts), { credentialPda: CREDENTIAL, schemaPda: SCHEMA_PDA }, MINT);
  assert.deepEqual(result, { verified: false, reason: "cliff_mismatch" });
});
