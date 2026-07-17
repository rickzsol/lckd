import { PublicKey, SystemProgram } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { PUMPFUN_PROGRAM_ID } from "./constants";
import type { PumpCreateData } from "./pumpCreateValidation";

const PUMP_BUY_DISCRIMINATOR = "66063d1201daebea";
const PUMP_BUY_EXACT_SOL_DISCRIMINATOR = "38fc74089edfcd5f";
const PUMP_BUY_V2_DISCRIMINATOR = "b817ee6167c5d33d";
const PUMP_BUY_EXACT_QUOTE_V2_DISCRIMINATOR = "c2ab1c46684d5b2f";
const PUMP_FEE_PROGRAM_ID = new PublicKey("pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ");
const FEE_RECIPIENTS = new Set([
  "62qc2CNXwrYqQScmEdiZFFAnJR262PxWEuNQtxfafNgV",
  "7VtfL8fvgNfhz17qKRMjzQEXgbdpnHHHQRh54R9jP2RJ",
  "7hTckgnGnLQR6sdH7YkqFTAA7VwTfYFaZ6EhEsU3saCX",
  "9rPYyANsfQZw3DnDmKE3YCQF5E8oD89UXoHn9JFEhJUz",
  "AVmoTthdrX6tKt4nDjco2D775W2YK3sDhxPcMmzUAmTY",
  "CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM",
  "FWsW1xNtWscwNmKv6wVsU1iTzRN6wmmk3MjxRP5tT7hz",
  "G5UZAVbAf46s7cKWoyKu8kYTip9DGTpbLZ2qa9Aq69dP",
]);
const BUYBACK_FEE_RECIPIENTS = new Set([
  "5YxQFdt3Tr9zJLvkFccqXVUwhdTWJQc1fFg2YPbxvxeD",
  "9M4giFFMxmFGXtc3feFzRai56WbBqehoSeRE5GK7gf7",
  "GXPFM2caqTtQYC2cJ5yJRi9VDkpsYZXzYdwYpGnLmtDL",
  "3BpXnfJaUTiwXnJNe7Ej1rcbzqTTQUvLShZaWazebsVR",
  "5cjcW9wExnJJiqgLjq7DEG75Pm6JBgE1hNv4B2vHXUW6",
  "EHAAiTxcdDwQ3U4bU6YcMsQGaekdzLS3B5SmYo46kJtL",
  "5eHhjP8JaYkz83CWwvGU2uMUXefd3AazWGx4gpcuEEYD",
  "A7hAgCzFw14fejgCp387JUJRMNyz4j89JKnhtKU8piqW",
]);

interface PumpBuyLayout {
  accountCount: number;
  spendOffset: number;
  dataLength: number;
  version: "legacy" | "v2";
}

const BUY_LAYOUTS = new Map<string, PumpBuyLayout>([
  [PUMP_BUY_DISCRIMINATOR, { accountCount: 18, spendOffset: 16, dataLength: 25, version: "legacy" }],
  [PUMP_BUY_EXACT_SOL_DISCRIMINATOR, { accountCount: 18, spendOffset: 8, dataLength: 25, version: "legacy" }],
  [PUMP_BUY_V2_DISCRIMINATOR, { accountCount: 27, spendOffset: 16, dataLength: 24, version: "v2" }],
  [PUMP_BUY_EXACT_QUOTE_V2_DISCRIMINATOR, { accountCount: 27, spendOffset: 8, dataLength: 24, version: "v2" }],
]);

function derivePda(programId: PublicKey, ...seeds: Uint8Array[]): PublicKey {
  return PublicKey.findProgramAddressSync(seeds.map((seed) => Buffer.from(seed)), programId)[0];
}

function assertAccount(accounts: PublicKey[], index: number, expected: PublicKey): void {
  if (!accounts[index]?.equals(expected)) {
    throw new Error(`Pump buy account ${index} mismatch`);
  }
}

function assertRecipient(
  accounts: PublicKey[],
  index: number,
  recipients: Set<string>,
  label: string,
): void {
  if (!accounts[index] || !recipients.has(accounts[index].toBase58())) {
    throw new Error(`Pump buy ${label} mismatch`);
  }
}

function tokenProgramFor(create: PumpCreateData): PublicKey {
  return create.version === "create_v2" ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
}

function validateLegacyAccounts(
  accounts: PublicKey[],
  wallet: PublicKey,
  mint: PublicKey,
  create: PumpCreateData,
): void {
  const tokenProgram = tokenProgramFor(create);
  const bondingCurve = derivePda(PUMPFUN_PROGRAM_ID, Buffer.from("bonding-curve"), mint.toBuffer());
  assertAccount(accounts, 0, derivePda(PUMPFUN_PROGRAM_ID, Buffer.from("global")));
  assertRecipient(accounts, 1, FEE_RECIPIENTS, "fee recipient");
  assertAccount(accounts, 2, mint);
  assertAccount(accounts, 3, bondingCurve);
  assertAccount(accounts, 4, getAssociatedTokenAddressSync(mint, bondingCurve, true, tokenProgram));
  assertAccount(accounts, 5, getAssociatedTokenAddressSync(mint, wallet, false, tokenProgram));
  assertAccount(accounts, 6, wallet);
  assertAccount(accounts, 7, SystemProgram.programId);
  assertAccount(accounts, 8, tokenProgram);
  assertAccount(
    accounts,
    9,
    derivePda(PUMPFUN_PROGRAM_ID, Buffer.from("creator-vault"), create.creator.toBuffer()),
  );
  assertAccount(accounts, 10, derivePda(PUMPFUN_PROGRAM_ID, Buffer.from("__event_authority")));
  assertAccount(accounts, 11, PUMPFUN_PROGRAM_ID);
  assertAccount(
    accounts,
    12,
    derivePda(PUMPFUN_PROGRAM_ID, Buffer.from("global_volume_accumulator")),
  );
  assertAccount(
    accounts,
    13,
    derivePda(PUMPFUN_PROGRAM_ID, Buffer.from("user_volume_accumulator"), wallet.toBuffer()),
  );
  assertAccount(
    accounts,
    14,
    derivePda(PUMP_FEE_PROGRAM_ID, Buffer.from("fee_config"), PUMPFUN_PROGRAM_ID.toBuffer()),
  );
  assertAccount(accounts, 15, PUMP_FEE_PROGRAM_ID);
  assertAccount(
    accounts,
    16,
    derivePda(PUMPFUN_PROGRAM_ID, Buffer.from("bonding-curve-v2"), mint.toBuffer()),
  );
  assertRecipient(accounts, 17, BUYBACK_FEE_RECIPIENTS, "buyback fee recipient");
}

function validateV2Accounts(
  accounts: PublicKey[],
  wallet: PublicKey,
  mint: PublicKey,
  create: PumpCreateData,
): void {
  const baseTokenProgram = tokenProgramFor(create);
  const bondingCurve = derivePda(PUMPFUN_PROGRAM_ID, Buffer.from("bonding-curve"), mint.toBuffer());
  const creatorVault = derivePda(
    PUMPFUN_PROGRAM_ID,
    Buffer.from("creator-vault"),
    create.creator.toBuffer(),
  );
  const userVolume = derivePda(
    PUMPFUN_PROGRAM_ID,
    Buffer.from("user_volume_accumulator"),
    wallet.toBuffer(),
  );

  assertAccount(accounts, 0, derivePda(PUMPFUN_PROGRAM_ID, Buffer.from("global")));
  assertAccount(accounts, 1, mint);
  assertAccount(accounts, 2, NATIVE_MINT);
  assertAccount(accounts, 3, baseTokenProgram);
  assertAccount(accounts, 4, TOKEN_PROGRAM_ID);
  assertAccount(accounts, 5, ASSOCIATED_TOKEN_PROGRAM_ID);
  assertRecipient(accounts, 6, FEE_RECIPIENTS, "fee recipient");
  assertAccount(accounts, 7, getAssociatedTokenAddressSync(NATIVE_MINT, accounts[6], true));
  assertRecipient(accounts, 8, BUYBACK_FEE_RECIPIENTS, "buyback fee recipient");
  assertAccount(accounts, 9, getAssociatedTokenAddressSync(NATIVE_MINT, accounts[8], true));
  assertAccount(accounts, 10, bondingCurve);
  assertAccount(accounts, 11, getAssociatedTokenAddressSync(mint, bondingCurve, true, baseTokenProgram));
  assertAccount(accounts, 12, getAssociatedTokenAddressSync(NATIVE_MINT, bondingCurve, true));
  assertAccount(accounts, 13, wallet);
  assertAccount(accounts, 14, getAssociatedTokenAddressSync(mint, wallet, false, baseTokenProgram));
  assertAccount(accounts, 15, getAssociatedTokenAddressSync(NATIVE_MINT, wallet));
  assertAccount(accounts, 16, creatorVault);
  assertAccount(accounts, 17, getAssociatedTokenAddressSync(NATIVE_MINT, creatorVault, true));
  assertAccount(
    accounts,
    18,
    derivePda(PUMP_FEE_PROGRAM_ID, Buffer.from("sharing-config"), mint.toBuffer()),
  );
  assertAccount(
    accounts,
    19,
    derivePda(PUMPFUN_PROGRAM_ID, Buffer.from("global_volume_accumulator")),
  );
  assertAccount(accounts, 20, userVolume);
  assertAccount(accounts, 21, getAssociatedTokenAddressSync(NATIVE_MINT, userVolume, true));
  assertAccount(
    accounts,
    22,
    derivePda(PUMP_FEE_PROGRAM_ID, Buffer.from("fee_config"), PUMPFUN_PROGRAM_ID.toBuffer()),
  );
  assertAccount(accounts, 23, PUMP_FEE_PROGRAM_ID);
  assertAccount(accounts, 24, SystemProgram.programId);
  assertAccount(accounts, 25, derivePda(PUMPFUN_PROGRAM_ID, Buffer.from("__event_authority")));
  assertAccount(accounts, 26, PUMPFUN_PROGRAM_ID);
}

export function validatePumpBuyInstruction(
  data: Buffer,
  accounts: PublicKey[],
  wallet: PublicKey,
  mint: PublicKey,
  create: PumpCreateData,
): bigint {
  const discriminator = data.subarray(0, 8).toString("hex");
  const layout = BUY_LAYOUTS.get(discriminator);
  if (!layout || data.length !== layout.dataLength || accounts.length !== layout.accountCount) {
    throw new Error("Pump buy instruction layout mismatch");
  }
  if (layout.version === "legacy" && data[24] > 1) {
    throw new Error("Pump buy track-volume flag is invalid");
  }

  if (layout.version === "legacy") {
    validateLegacyAccounts(accounts, wallet, mint, create);
  } else {
    validateV2Accounts(accounts, wallet, mint, create);
  }
  return data.readBigUInt64LE(layout.spendOffset);
}
