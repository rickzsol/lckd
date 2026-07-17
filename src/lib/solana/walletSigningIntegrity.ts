import {
  type Signer,
  VersionedTransaction,
} from "@solana/web3.js";

function hasSameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

export function assertVersionedMessageUnchanged(
  issuedMessage: Uint8Array,
  transaction: VersionedTransaction,
  label: string,
): void {
  if (!hasSameBytes(issuedMessage, transaction.message.serialize())) {
    throw new Error(`Wallet changed the ${label} transaction message while signing`);
  }
}

export function restoreLocalVersionedSignatures(
  issuedMessage: Uint8Array,
  transaction: VersionedTransaction,
  localSigners: readonly Signer[],
  label: string,
): VersionedTransaction {
  assertVersionedMessageUnchanged(issuedMessage, transaction, label);

  const requiredSignerKeys = transaction.message.staticAccountKeys.slice(
    0,
    transaction.message.header.numRequiredSignatures,
  );
  const localSignerKeys = new Set(localSigners.map((signer) => signer.publicKey.toBase58()));
  const preservedSignatures = transaction.signatures.map((signature, index) =>
    localSignerKeys.has(requiredSignerKeys[index]?.toBase58() ?? "")
      ? null
      : new Uint8Array(signature)
  );

  transaction.sign([...localSigners]);
  assertVersionedMessageUnchanged(issuedMessage, transaction, label);

  preservedSignatures.forEach((signature, index) => {
    if (signature && !hasSameBytes(signature, transaction.signatures[index])) {
      throw new Error(`Local signing changed the wallet signature for ${label}`);
    }
  });
  return transaction;
}
