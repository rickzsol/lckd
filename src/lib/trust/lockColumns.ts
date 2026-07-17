/**
 * Service-role column list for reading the base `locks` table. Raw u64/u128
 * columns (deposited_amount, withdrawn_amount, total_supply_raw, cliff_ts_raw,
 * creation_slot, last_verified_slot) are cast to text at the query boundary so
 * bigint/numeric never arrive as a JS number and lose precision (finding 9).
 * Consumers keep these as decimal strings and do ratio math with BigInt.
 */
export const LOCK_COLUMNS = [
  "id",
  "token_id",
  "cluster",
  "mint",
  "stream_program",
  "stream_id",
  "escrow_ata",
  "recipient",
  "deposited_amount::text",
  "cliff_ts",
  "cliff_ts_raw::text",
  "withdrawn_amount::text",
  "total_supply_raw::text",
  "decimals",
  "lock_bps",
  "status",
  "canonical",
  "creation_signature",
  "creation_slot::text",
  "last_verified_signature",
  "last_verified_slot::text",
  "last_verified_at",
  "created_at",
].join(", ");
