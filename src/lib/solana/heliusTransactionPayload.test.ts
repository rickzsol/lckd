import assert from "node:assert/strict";
import test from "node:test";
import {
  Keypair,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { normalizeHeliusTransactionPayload } from "./heliusTransactionPayload";

test("normalizes Helius base64 transaction notifications", () => {
  const payer = Keypair.generate();
  const recipient = Keypair.generate().publicKey;
  const message = new TransactionMessage({
    instructions: [SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      lamports: 1,
      toPubkey: recipient,
    })],
    payerKey: payer.publicKey,
    recentBlockhash: Keypair.generate().publicKey.toBase58(),
  }).compileToV0Message();
  const transaction = new VersionedTransaction(message);
  transaction.sign([payer]);
  const normalized = normalizeHeliusTransactionPayload({
    meta: { err: null, loadedAddresses: { readonly: [], writable: [] } },
    transaction: [Buffer.from(transaction.serialize()).toString("base64"), "base64"],
  }) as {
    transaction: { message: { accountKeys: Array<{ pubkey: string; signer: boolean }>; instructions: Array<{ programId: string }> } };
  };
  assert.deepEqual(normalized.transaction.message.accountKeys[0], {
    pubkey: payer.publicKey.toBase58(),
    signer: true,
  });
  assert.equal(normalized.transaction.message.instructions[0].programId, SystemProgram.programId.toBase58());
});

test("passes through parsed transaction notifications and rejects bad encodings", () => {
  const parsed = { meta: { err: null }, transaction: { message: { accountKeys: [], instructions: [] } } };
  assert.deepEqual(normalizeHeliusTransactionPayload(parsed), parsed);
  assert.equal(normalizeHeliusTransactionPayload({ meta: { err: null }, transaction: ["bad", "json"] }), null);
});
