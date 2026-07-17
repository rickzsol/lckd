import {
  serializeAttestationData,
  deserializeAttestationData,
} from "sas-lib";

/**
 * lckd-trust-v1 schema definition for the Solana Attestation Service.
 *
 * The serialized payload is the only trust anchor a third party can verify, so
 * every field that binds identity (mint, creator, stream) lives on-chain here,
 * not just in our database. All values are already public on the site.
 *
 * Layout byte codes come from the SAS type system (attest.solana.com/docs/schemas):
 *   0 = u8, 1 = u16, 3 = u64, 12 = String.
 */

export const SCHEMA_NAME = "lckd-trust-v1";
export const SCHEMA_VERSION = 1;
export const SCHEMA_DESCRIPTION =
  "LCKD trust tier bound to a finalized Streamflow lock and GitHub evidence";

/** Ordered field names. Position must match SCHEMA_LAYOUT exactly. */
export const SCHEMA_FIELDS = [
  "mint",
  "creator",
  "stream_id",
  "tier",
  "lock_bps",
  "cliff_ts",
  "policy_version",
  "github",
] as const;

/** SAS layout type codes, positionally aligned with SCHEMA_FIELDS. */
export const SCHEMA_LAYOUT = Uint8Array.from([12, 12, 12, 0, 1, 3, 0, 12]);

/** Current trust policy version serialized into every attestation payload. */
export const POLICY_VERSION = 1;

export const TRUST_TIER = {
  LOCKED: 1,
  VERIFIED: 2,
  BUILDER: 3,
  SHIPPED: 4,
} as const;

export type TrustTierValue = (typeof TRUST_TIER)[keyof typeof TRUST_TIER];

/** Basis-point denominator: locked supply as a share of finalized total supply. */
export const BPS_DENOMINATOR = 10_000;

export interface TrustAttestationData {
  mint: string;
  creator: string;
  stream_id: string;
  tier: number;
  lock_bps: number;
  cliff_ts: bigint;
  policy_version: number;
  github: string;
}

/**
 * Minimal on-chain Schema shape needed by the SAS (de)serializers. The SAS
 * helpers only read `layout` and `fieldNames`, so we synthesize them from our
 * constants rather than fetching the account. This keeps serialization
 * byte-for-byte identical to what the program expects while staying RPC-free
 * for pure serialization and tests.
 */
interface SasSerializerSchema {
  layout: number[];
  fieldNames: number[];
}

function encodeFieldNames(fields: readonly string[]): number[] {
  const encoder = new TextEncoder();
  const bytes: number[] = [];
  for (const field of fields) {
    const encoded = encoder.encode(field);
    const length = encoded.length;
    bytes.push(length & 0xff, (length >> 8) & 0xff, (length >> 16) & 0xff, (length >> 24) & 0xff);
    bytes.push(...encoded);
  }
  return bytes;
}

const SERIALIZER_SCHEMA: SasSerializerSchema = {
  layout: Array.from(SCHEMA_LAYOUT),
  fieldNames: encodeFieldNames(SCHEMA_FIELDS),
};

function assertValidData(data: TrustAttestationData): void {
  if (
    !data.mint ||
    !data.creator ||
    !data.stream_id ||
    !Number.isInteger(data.tier) ||
    data.tier < TRUST_TIER.LOCKED ||
    data.tier > TRUST_TIER.SHIPPED ||
    !Number.isInteger(data.lock_bps) ||
    data.lock_bps < 0 ||
    data.lock_bps > BPS_DENOMINATOR ||
    data.cliff_ts <= BigInt(0) ||
    !Number.isInteger(data.policy_version) ||
    data.policy_version < 1 ||
    data.policy_version > 255 ||
    typeof data.github !== "string"
  ) {
    throw new Error("Invalid trust attestation data");
  }
}

/** Serialize trust data into the exact byte layout the SAS program stores. */
export function serializeTrustData(data: TrustAttestationData): Uint8Array {
  assertValidData(data);
  // borsher serializes u64 fields from bigint; everything else maps directly.
  return serializeAttestationData(SERIALIZER_SCHEMA as never, {
    mint: data.mint,
    creator: data.creator,
    stream_id: data.stream_id,
    tier: data.tier,
    lock_bps: data.lock_bps,
    cliff_ts: data.cliff_ts,
    policy_version: data.policy_version,
    github: data.github,
  });
}

/** Deserialize an on-chain attestation payload back into trust data. */
export function deserializeTrustData(bytes: Uint8Array): TrustAttestationData {
  const raw = deserializeAttestationData<Record<string, unknown>>(
    SERIALIZER_SCHEMA as never,
    bytes,
  );
  const data: TrustAttestationData = {
    mint: String(raw.mint),
    creator: String(raw.creator),
    stream_id: String(raw.stream_id),
    tier: Number(raw.tier),
    lock_bps: Number(raw.lock_bps),
    cliff_ts: BigInt(raw.cliff_ts as bigint | number | string),
    policy_version: Number(raw.policy_version),
    github: String(raw.github),
  };
  assertValidData(data);
  return data;
}
