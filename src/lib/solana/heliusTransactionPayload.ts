import bs58 from "bs58";
import { VersionedTransaction } from "@solana/web3.js";

function stringArray(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : null;
}

export function normalizeHeliusTransactionPayload(value: unknown): unknown | null {
  if (!value || typeof value !== "object") return null;
  const meta = Reflect.get(value, "meta");
  const transaction = Reflect.get(value, "transaction");
  if (!meta || typeof meta !== "object") return null;
  if (transaction && typeof transaction === "object" && !Array.isArray(transaction) &&
    Reflect.get(transaction, "message")) {
    return { meta, transaction };
  }

  const encoded = Array.isArray(transaction) && transaction[1] === "base64"
    ? transaction[0]
    : typeof transaction === "string" ? transaction : null;
  if (typeof encoded !== "string") return null;
  try {
    const decoded = VersionedTransaction.deserialize(Buffer.from(encoded, "base64"));
    const message = decoded.message;
    const loaded = Reflect.get(meta, "loadedAddresses");
    const writable = loaded && typeof loaded === "object"
      ? stringArray(Reflect.get(loaded, "writable"))
      : [];
    const readonly = loaded && typeof loaded === "object"
      ? stringArray(Reflect.get(loaded, "readonly"))
      : [];
    if (writable === null || readonly === null) return null;
    const accountAddresses = [
      ...message.staticAccountKeys.map((key) => key.toBase58()),
      ...writable,
      ...readonly,
    ];
    const instructions = message.compiledInstructions.map((instruction) => {
      const programId = accountAddresses[instruction.programIdIndex];
      const accounts = [...instruction.accountKeyIndexes].map((index) => accountAddresses[index]);
      if (!programId || accounts.some((account) => !account)) throw new Error("Missing account key");
      return {
        accounts,
        data: bs58.encode(instruction.data),
        programId,
      };
    });
    return {
      meta,
      transaction: {
        message: {
          accountKeys: accountAddresses.map((pubkey, index) => ({
            pubkey,
            signer: index < message.header.numRequiredSignatures,
          })),
          instructions,
        },
      },
    };
  } catch {
    return null;
  }
}
