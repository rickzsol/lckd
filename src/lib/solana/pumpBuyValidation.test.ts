import assert from "node:assert/strict";
import test from "node:test";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { PUMPFUN_PROGRAM_ID } from "./constants";
import { validatePumpBuyInstruction } from "./pumpBuyValidation";
import type { PumpCreateData } from "./pumpCreateValidation";
import { parsePumpTradeEvent } from "./pumpTradeEvent";

const FEE_PROGRAM = new PublicKey("pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ");
const FEE_RECIPIENT = new PublicKey("62qc2CNXwrYqQScmEdiZFFAnJR262PxWEuNQtxfafNgV");
const BUYBACK_FEE_RECIPIENT = new PublicKey(
  "5YxQFdt3Tr9zJLvkFccqXVUwhdTWJQc1fFg2YPbxvxeD",
);

function pda(programId: PublicKey, ...seeds: Uint8Array[]): PublicKey {
  return PublicKey.findProgramAddressSync(seeds.map((seed) => Buffer.from(seed)), programId)[0];
}

function u64(value: bigint): Buffer {
  const data = Buffer.alloc(8);
  data.writeBigUInt64LE(value);
  return data;
}

function createData(wallet: PublicKey, version: PumpCreateData["version"]): PumpCreateData {
  return {
    creator: wallet,
    metadataUri: "https://gateway.pinata.cloud/ipfs/test",
    name: "Test",
    symbol: "TEST",
    version,
  };
}

function legacyAccounts(wallet: PublicKey, mint: PublicKey, tokenProgram: PublicKey): PublicKey[] {
  const curve = pda(PUMPFUN_PROGRAM_ID, Buffer.from("bonding-curve"), mint.toBuffer());
  return [
    pda(PUMPFUN_PROGRAM_ID, Buffer.from("global")),
    FEE_RECIPIENT,
    mint,
    curve,
    getAssociatedTokenAddressSync(mint, curve, true, tokenProgram),
    getAssociatedTokenAddressSync(mint, wallet, false, tokenProgram),
    wallet,
    SystemProgram.programId,
    tokenProgram,
    pda(PUMPFUN_PROGRAM_ID, Buffer.from("creator-vault"), wallet.toBuffer()),
    pda(PUMPFUN_PROGRAM_ID, Buffer.from("__event_authority")),
    PUMPFUN_PROGRAM_ID,
    pda(PUMPFUN_PROGRAM_ID, Buffer.from("global_volume_accumulator")),
    pda(PUMPFUN_PROGRAM_ID, Buffer.from("user_volume_accumulator"), wallet.toBuffer()),
    pda(FEE_PROGRAM, Buffer.from("fee_config"), PUMPFUN_PROGRAM_ID.toBuffer()),
    FEE_PROGRAM,
  ];
}

function v2Accounts(wallet: PublicKey, mint: PublicKey): PublicKey[] {
  const curve = pda(PUMPFUN_PROGRAM_ID, Buffer.from("bonding-curve"), mint.toBuffer());
  const feeRecipient = FEE_RECIPIENT;
  const buybackRecipient = BUYBACK_FEE_RECIPIENT;
  const creatorVault = pda(PUMPFUN_PROGRAM_ID, Buffer.from("creator-vault"), wallet.toBuffer());
  const userVolume = pda(
    PUMPFUN_PROGRAM_ID,
    Buffer.from("user_volume_accumulator"),
    wallet.toBuffer(),
  );
  return [
    pda(PUMPFUN_PROGRAM_ID, Buffer.from("global")),
    mint,
    NATIVE_MINT,
    TOKEN_2022_PROGRAM_ID,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    feeRecipient,
    getAssociatedTokenAddressSync(NATIVE_MINT, feeRecipient, true),
    buybackRecipient,
    getAssociatedTokenAddressSync(NATIVE_MINT, buybackRecipient, true),
    curve,
    getAssociatedTokenAddressSync(mint, curve, true, TOKEN_2022_PROGRAM_ID),
    getAssociatedTokenAddressSync(NATIVE_MINT, curve, true),
    wallet,
    getAssociatedTokenAddressSync(mint, wallet, false, TOKEN_2022_PROGRAM_ID),
    getAssociatedTokenAddressSync(NATIVE_MINT, wallet),
    creatorVault,
    getAssociatedTokenAddressSync(NATIVE_MINT, creatorVault, true),
    pda(FEE_PROGRAM, Buffer.from("sharing-config"), mint.toBuffer()),
    pda(PUMPFUN_PROGRAM_ID, Buffer.from("global_volume_accumulator")),
    userVolume,
    getAssociatedTokenAddressSync(NATIVE_MINT, userVolume, true),
    pda(FEE_PROGRAM, Buffer.from("fee_config"), PUMPFUN_PROGRAM_ID.toBuffer()),
    FEE_PROGRAM,
    SystemProgram.programId,
    pda(PUMPFUN_PROGRAM_ID, Buffer.from("__event_authority")),
    PUMPFUN_PROGRAM_ID,
  ];
}

test("validates every current Pump buy payload and exact account layout", () => {
  const wallet = Keypair.generate().publicKey;
  const mint = Keypair.generate().publicKey;
  const spend = BigInt(123_456_789);
  const cases = [
    {
      data: Buffer.concat([Buffer.from("66063d1201daebea", "hex"), u64(BigInt(1)), u64(spend), Buffer.from([0])]),
      accounts: legacyAccounts(wallet, mint, TOKEN_PROGRAM_ID),
      create: createData(wallet, "create"),
    },
    {
      data: Buffer.concat([Buffer.from("38fc74089edfcd5f", "hex"), u64(spend), u64(BigInt(1)), Buffer.from([1])]),
      accounts: legacyAccounts(wallet, mint, TOKEN_PROGRAM_ID),
      create: createData(wallet, "create"),
    },
    {
      data: Buffer.concat([Buffer.from("b817ee6167c5d33d", "hex"), u64(BigInt(1)), u64(spend)]),
      accounts: v2Accounts(wallet, mint),
      create: createData(wallet, "create_v2"),
    },
    {
      data: Buffer.concat([Buffer.from("c2ab1c46684d5b2f", "hex"), u64(spend), u64(BigInt(1))]),
      accounts: v2Accounts(wallet, mint),
      create: createData(wallet, "create_v2"),
    },
  ];
  for (const fixture of cases) {
    assert.equal(
      validatePumpBuyInstruction(fixture.data, fixture.accounts, wallet, mint, fixture.create),
      spend,
    );
  }
});

test("rejects an extra Pump buy account", () => {
  const wallet = Keypair.generate().publicKey;
  const mint = Keypair.generate().publicKey;
  const accounts = legacyAccounts(wallet, mint, TOKEN_PROGRAM_ID);
  accounts.push(Keypair.generate().publicKey);
  assert.throws(
    () => validatePumpBuyInstruction(
      Buffer.concat([
        Buffer.from("66063d1201daebea", "hex"),
        u64(BigInt(1)),
        u64(BigInt(2)),
        Buffer.from([0]),
      ]),
      accounts,
      wallet,
      mint,
      createData(wallet, "create"),
    ),
    /layout mismatch/,
  );
});

test("rejects an unauthorized Pump fee recipient", () => {
  const wallet = Keypair.generate().publicKey;
  const mint = Keypair.generate().publicKey;
  const accounts = v2Accounts(wallet, mint);
  accounts[6] = Keypair.generate().publicKey;
  assert.throws(
    () => validatePumpBuyInstruction(
      Buffer.concat([
        Buffer.from("b817ee6167c5d33d", "hex"),
        u64(BigInt(1)),
        u64(BigInt(2)),
      ]),
      accounts,
      wallet,
      mint,
      createData(wallet, "create_v2"),
    ),
    /fee recipient mismatch/,
  );
});

test("extracts the finalized Pump spend from the trade event", () => {
  const wallet = Keypair.generate().publicKey;
  const mint = Keypair.generate().publicKey;
  const instructionName = Buffer.from("buy_exact_quote_in", "utf8");
  const data = Buffer.alloc(270 + instructionName.length + 33);
  Buffer.from("e445a52e51cb9a1d", "hex").copy(data, 0);
  Buffer.from("bddb7fd34ee661ee", "hex").copy(data, 8);
  mint.toBuffer().copy(data, 16);
  data.writeBigUInt64LE(BigInt(900), 48);
  data.writeBigUInt64LE(BigInt(5_000), 56);
  data[64] = 1;
  wallet.toBuffer().copy(data, 65);
  data.writeBigUInt64LE(BigInt(50), 177);
  data.writeBigUInt64LE(BigInt(20), 225);
  data.writeUInt32LE(instructionName.length, 266);
  instructionName.copy(data, 270);
  let cursor = 270 + instructionName.length + 1;
  cursor += 8;
  data.writeBigUInt64LE(BigInt(10), cursor);
  cursor += 16;
  data.writeBigUInt64LE(BigInt(5), cursor);

  const event = parsePumpTradeEvent(data);
  assert(event);
  assert(event.mint.equals(mint));
  assert(event.user.equals(wallet));
  assert.equal(event.tokenAmount, BigInt(5_000));
  assert.equal(event.totalSolAmount, BigInt(985));
});
