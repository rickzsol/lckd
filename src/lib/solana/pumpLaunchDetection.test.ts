import assert from "node:assert/strict";
import test from "node:test";
import {
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
} from "@solana/spl-token";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import bs58 from "bs58";
import { PUMPFUN_PROGRAM_ID } from "./constants";
import {
  PUMP_CREATE_V2_DISCRIMINATOR,
} from "./pumpCreateValidation";
import { detectPumpLaunch, hasPumpCreateLogs } from "./pumpLaunchDetection";

const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);
const MAYHEM_PROGRAM_ID = new PublicKey("MAyhSmzXzV1pTf7LsNkrNwkWKTo4ougAJ1PPg47MD4e");

function pda(programId: PublicKey, ...seeds: Uint8Array[]): PublicKey {
  return PublicKey.findProgramAddressSync(
    seeds.map((seed) => Buffer.from(seed)),
    programId,
  )[0];
}

function v2Accounts(wallet: PublicKey, mint: PublicKey): PublicKey[] {
  const curve = pda(PUMPFUN_PROGRAM_ID, Buffer.from("bonding-curve"), mint.toBuffer());
  const solVault = pda(MAYHEM_PROGRAM_ID, Buffer.from("sol-vault"));
  return [
    mint,
    pda(PUMPFUN_PROGRAM_ID, Buffer.from("mint-authority")),
    curve,
    getAssociatedTokenAddressSync(mint, curve, true, TOKEN_2022_PROGRAM_ID),
    pda(PUMPFUN_PROGRAM_ID, Buffer.from("global")),
    wallet,
    SystemProgram.programId,
    TOKEN_2022_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
    MAYHEM_PROGRAM_ID,
    pda(MAYHEM_PROGRAM_ID, Buffer.from("global-params")),
    solVault,
    pda(MAYHEM_PROGRAM_ID, Buffer.from("mayhem-state"), mint.toBuffer()),
    getAssociatedTokenAddressSync(mint, solVault, true, TOKEN_2022_PROGRAM_ID),
    pda(PUMPFUN_PROGRAM_ID, Buffer.from("__event_authority")),
    PUMPFUN_PROGRAM_ID,
  ];
}

function borshString(value: string): Buffer {
  const bytes = Buffer.from(value, "utf8");
  const length = Buffer.alloc(4);
  length.writeUInt32LE(bytes.length);
  return Buffer.concat([length, bytes]);
}

function createData(creator: PublicKey): Buffer {
  return Buffer.concat([
    Buffer.from(PUMP_CREATE_V2_DISCRIMINATOR, "hex"),
    borshString("Official Token"),
    borshString("OFFICIAL"),
    borshString("https://gateway.pinata.cloud/ipfs/test"),
    creator.toBuffer(),
    Buffer.from([0, 0]),
  ]);
}

function parsedTransaction(wallet: PublicKey, mint: PublicKey, creator = wallet) {
  const accounts = v2Accounts(wallet, mint);
  const keys = [wallet, mint, ...accounts, PUMPFUN_PROGRAM_ID]
    .filter((key, index, all) => all.findIndex((candidate) => candidate.equals(key)) === index)
    .map((pubkey) => ({
      pubkey: pubkey.toBase58(),
      signer: pubkey.equals(wallet) || pubkey.equals(mint),
      writable: false,
    }));
  return {
    meta: { err: null as unknown },
    transaction: {
      message: {
        accountKeys: keys,
        instructions: [{
          accounts: accounts.map((account) => account.toBase58()),
          data: bs58.encode(createData(creator)),
          programId: PUMPFUN_PROGRAM_ID.toBase58(),
        }],
      },
    },
  };
}

test("detects an exact signed Pump create_v2 from the monitored wallet", () => {
  const wallet = Keypair.generate().publicKey;
  const mint = Keypair.generate().publicKey;
  const result = detectPumpLaunch(parsedTransaction(wallet, mint), wallet.toBase58());

  assert.deepEqual(result, {
    metadataUri: "https://gateway.pinata.cloud/ipfs/test",
    mintAddress: mint.toBase58(),
    name: "Official Token",
    symbol: "OFFICIAL",
  });
});

test("rejects a Pump create whose encoded creator is not the monitored wallet", () => {
  const wallet = Keypair.generate().publicKey;
  const mint = Keypair.generate().publicKey;
  const otherCreator = Keypair.generate().publicKey;
  assert.equal(
    detectPumpLaunch(parsedTransaction(wallet, mint, otherCreator), wallet.toBase58()),
    null,
  );
});

test("rejects failed transactions and unsigned mint accounts", () => {
  const wallet = Keypair.generate().publicKey;
  const mint = Keypair.generate().publicKey;
  const failed = parsedTransaction(wallet, mint);
  failed.meta.err = { InstructionError: [2, "Custom"] };
  assert.equal(detectPumpLaunch(failed, wallet.toBase58()), null);

  const unsigned = parsedTransaction(wallet, mint);
  const mintKey = unsigned.transaction.message.accountKeys.find(
    (account) => account.pubkey === mint.toBase58(),
  );
  if (mintKey) mintKey.signer = false;
  assert.equal(detectPumpLaunch(unsigned, wallet.toBase58()), null);
});

test("requires both the Pump invocation and InitializeMint2 logs", () => {
  const invoke = `Program ${PUMPFUN_PROGRAM_ID.toBase58()} invoke [1]`;
  assert.equal(hasPumpCreateLogs([invoke, "Program log: Instruction: InitializeMint2"]), true);
  assert.equal(hasPumpCreateLogs([invoke]), false);
  assert.equal(hasPumpCreateLogs(["Program log: Instruction: InitializeMint2"]), false);
});
