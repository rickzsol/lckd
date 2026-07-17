import {
  PublicKey,
  SYSVAR_RENT_PUBKEY,
  SystemProgram,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  MPL_TOKEN_METADATA_PROGRAM_ID,
  PUMPFUN_PROGRAM_ID,
} from "./constants";

export const PUMP_CREATE_DISCRIMINATOR = "181ec828051c0777";
export const PUMP_CREATE_V2_DISCRIMINATOR = "d6904cec5f8b31b4";

const MAYHEM_PROGRAM_ID = new PublicKey("MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e");

export interface PumpCreateExpectation {
  name: string;
  symbol: string;
  metadataUri: string;
}

export interface PumpCreateData extends PumpCreateExpectation {
  creator: PublicKey;
  version: "create" | "create_v2";
}

function derivePda(programId: PublicKey, ...seeds: Uint8Array[]): PublicKey {
  return PublicKey.findProgramAddressSync(seeds.map((seed) => Buffer.from(seed)), programId)[0];
}

function readBorshString(data: Buffer, cursor: { offset: number }): string {
  if (cursor.offset + 4 > data.length) throw new Error("Pump create metadata is truncated");
  const length = data.readUInt32LE(cursor.offset);
  cursor.offset += 4;
  if (length > 1_000 || cursor.offset + length > data.length) {
    throw new Error("Pump create metadata has an invalid length");
  }
  const value = data.subarray(cursor.offset, cursor.offset + length).toString("utf8");
  cursor.offset += length;
  return value;
}

function expectedLegacyAccounts(wallet: PublicKey, mint: PublicKey): PublicKey[] {
  const mintAuthority = derivePda(PUMPFUN_PROGRAM_ID, Buffer.from("mint-authority"));
  const bondingCurve = derivePda(PUMPFUN_PROGRAM_ID, Buffer.from("bonding-curve"), mint.toBuffer());
  const metadata = derivePda(
    MPL_TOKEN_METADATA_PROGRAM_ID,
    Buffer.from("metadata"),
    MPL_TOKEN_METADATA_PROGRAM_ID.toBuffer(),
    mint.toBuffer(),
  );
  return [
    mint,
    mintAuthority,
    bondingCurve,
    getAssociatedTokenAddressSync(mint, bondingCurve, true, TOKEN_PROGRAM_ID),
    derivePda(PUMPFUN_PROGRAM_ID, Buffer.from("global")),
    MPL_TOKEN_METADATA_PROGRAM_ID,
    metadata,
    wallet,
    SystemProgram.programId,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    SYSVAR_RENT_PUBKEY,
    derivePda(PUMPFUN_PROGRAM_ID, Buffer.from("__event_authority")),
    PUMPFUN_PROGRAM_ID,
  ];
}

function expectedV2Accounts(wallet: PublicKey, mint: PublicKey): PublicKey[] {
  const bondingCurve = derivePda(PUMPFUN_PROGRAM_ID, Buffer.from("bonding-curve"), mint.toBuffer());
  const solVault = derivePda(MAYHEM_PROGRAM_ID, Buffer.from("sol-vault"));
  return [
    mint,
    derivePda(PUMPFUN_PROGRAM_ID, Buffer.from("mint-authority")),
    bondingCurve,
    getAssociatedTokenAddressSync(mint, bondingCurve, true, TOKEN_2022_PROGRAM_ID),
    derivePda(PUMPFUN_PROGRAM_ID, Buffer.from("global")),
    wallet,
    SystemProgram.programId,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    MAYHEM_PROGRAM_ID,
    derivePda(MAYHEM_PROGRAM_ID, Buffer.from("global-params")),
    solVault,
    derivePda(MAYHEM_PROGRAM_ID, Buffer.from("mayhem-state"), mint.toBuffer()),
    getAssociatedTokenAddressSync(mint, solVault, true, TOKEN_2022_PROGRAM_ID),
    derivePda(PUMPFUN_PROGRAM_ID, Buffer.from("__event_authority")),
    PUMPFUN_PROGRAM_ID,
  ];
}

function assertExactAccounts(actual: PublicKey[], expected: PublicKey[]): void {
  if (
    actual.length !== expected.length ||
    actual.some((account, index) => !account?.equals(expected[index]))
  ) {
    throw new Error("Pump create instruction account layout mismatch");
  }
}

export function validatePumpCreateInstruction(
  data: Buffer,
  accounts: PublicKey[],
  wallet: PublicKey,
  mint: PublicKey,
  expectation?: PumpCreateExpectation,
): PumpCreateData {
  const discriminator = data.subarray(0, 8).toString("hex");
  const isV2 = discriminator === PUMP_CREATE_V2_DISCRIMINATOR;
  if (!isV2 && discriminator !== PUMP_CREATE_DISCRIMINATOR) {
    throw new Error("Pump create instruction discriminator mismatch");
  }

  assertExactAccounts(
    accounts,
    isV2 ? expectedV2Accounts(wallet, mint) : expectedLegacyAccounts(wallet, mint),
  );

  const cursor = { offset: 8 };
  const name = readBorshString(data, cursor);
  const symbol = readBorshString(data, cursor);
  const metadataUri = readBorshString(data, cursor);
  if (cursor.offset + 32 > data.length) throw new Error("Pump creator is missing");
  const creator = new PublicKey(data.subarray(cursor.offset, cursor.offset + 32));
  cursor.offset += 32;

  if (isV2) {
    if (data.length !== cursor.offset + 2) throw new Error("Pump create_v2 data length mismatch");
    const isMayhemMode = data[cursor.offset];
    const isCashbackEnabled = data[cursor.offset + 1];
    if (isMayhemMode !== 0 || isCashbackEnabled !== 0) {
      throw new Error("Pump create_v2 mayhem and cashback must be disabled");
    }
  } else if (data.length !== cursor.offset) {
    throw new Error("Pump create data length mismatch");
  }

  if (!creator.equals(wallet)) throw new Error("Pump create creator mismatch");
  if (
    expectation &&
    (name !== expectation.name ||
      symbol !== expectation.symbol ||
      metadataUri !== expectation.metadataUri)
  ) {
    throw new Error("Pump create metadata does not match the launch review");
  }

  return {
    name,
    symbol,
    metadataUri,
    creator,
    version: isV2 ? "create_v2" : "create",
  };
}
