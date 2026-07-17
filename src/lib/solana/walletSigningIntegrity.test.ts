import assert from "node:assert/strict";
import test from "node:test";
import {
  Keypair,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import nacl from "tweetnacl";
import {
  assertVersionedMessageUnchanged,
  restoreLocalVersionedSignatures,
} from "./walletSigningIntegrity";

const keypair = (seed: number) =>
  Keypair.fromSeed(Uint8Array.from({ length: 32 }, () => seed));

function transactionFixture() {
  const wallet = keypair(1);
  const localSigner = keypair(2);
  const blockhash = keypair(3).publicKey.toBase58();
  const transaction = new VersionedTransaction(new TransactionMessage({
    payerKey: wallet.publicKey,
    recentBlockhash: blockhash,
    instructions: [SystemProgram.createAccount({
      fromPubkey: wallet.publicKey,
      newAccountPubkey: localSigner.publicKey,
      lamports: 1,
      space: 0,
      programId: SystemProgram.programId,
    })],
  }).compileToV0Message());
  return { wallet, localSigner, transaction };
}

function signatureIndex(transaction: VersionedTransaction, signer: Keypair): number {
  return transaction.message.staticAccountKeys
    .slice(0, transaction.message.header.numRequiredSignatures)
    .findIndex((key) => key.equals(signer.publicKey));
}

test("accepts an unchanged transaction returned as a wallet clone", () => {
  const { wallet, localSigner, transaction } = transactionFixture();
  transaction.sign([localSigner]);
  const issuedMessage = transaction.message.serialize();
  const walletClone = VersionedTransaction.deserialize(transaction.serialize());
  walletClone.sign([wallet]);

  assert.doesNotThrow(() =>
    assertVersionedMessageUnchanged(issuedMessage, walletClone, "lookup setup"));
});

test("rejects a transaction whose message changed during wallet signing", () => {
  const { wallet, transaction } = transactionFixture();
  const issuedMessage = transaction.message.serialize();
  transaction.message.recentBlockhash = keypair(4).publicKey.toBase58();
  transaction.sign([wallet]);

  assert.throws(
    () => assertVersionedMessageUnchanged(issuedMessage, transaction, "atomic launch"),
    /Wallet changed the atomic launch transaction message while signing/,
  );
});

test("restores local signatures without changing the wallet signature", () => {
  const { wallet, localSigner, transaction } = transactionFixture();
  const issuedMessage = transaction.message.serialize();
  transaction.sign([wallet]);
  const walletIndex = signatureIndex(transaction, wallet);
  const localIndex = signatureIndex(transaction, localSigner);
  const walletSignature = new Uint8Array(transaction.signatures[walletIndex]);

  const restored = restoreLocalVersionedSignatures(
    issuedMessage,
    transaction,
    [localSigner],
    "atomic launch",
  );
  const message = restored.message.serialize();

  assert.deepEqual(restored.signatures[walletIndex], walletSignature);
  assert.equal(
    nacl.sign.detached.verify(message, restored.signatures[walletIndex], wallet.publicKey.toBytes()),
    true,
  );
  assert.equal(
    nacl.sign.detached.verify(
      message,
      restored.signatures[localIndex],
      localSigner.publicKey.toBytes(),
    ),
    true,
  );
});
