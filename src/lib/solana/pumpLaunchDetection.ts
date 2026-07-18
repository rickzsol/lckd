import bs58 from "bs58";
import { PublicKey } from "@solana/web3.js";
import { PUMPFUN_PROGRAM_ID } from "./constants";
import { validatePumpCreateInstruction } from "./pumpCreateValidation";

interface ParsedAccountKey {
  pubkey: string;
  signer: boolean;
}

interface ParsedInstruction {
  accounts: string[];
  data: string;
  programId: string;
}

interface ParsedTransaction {
  meta?: { err?: unknown } | null;
  transaction?: {
    message?: {
      accountKeys?: unknown[];
      instructions?: unknown[];
    };
  };
}

export interface DetectedPumpLaunch {
  metadataUri: string;
  mintAddress: string;
  name: string;
  symbol: string;
}

function parseAccountKey(value: unknown): ParsedAccountKey | null {
  if (!value || typeof value !== "object") return null;
  const pubkey = Reflect.get(value, "pubkey");
  const signer = Reflect.get(value, "signer");
  return typeof pubkey === "string" && typeof signer === "boolean"
    ? { pubkey, signer }
    : null;
}

function parseInstruction(value: unknown): ParsedInstruction | null {
  if (!value || typeof value !== "object") return null;
  const programId = Reflect.get(value, "programId");
  const accounts = Reflect.get(value, "accounts");
  const data = Reflect.get(value, "data");
  if (
    typeof programId !== "string" ||
    typeof data !== "string" ||
    !Array.isArray(accounts) ||
    !accounts.every((account) => typeof account === "string")
  ) return null;
  return { programId, accounts, data };
}

export function detectPumpLaunch(
  value: unknown,
  expectedWalletAddress: string,
): DetectedPumpLaunch | null {
  const parsed = value as ParsedTransaction;
  if (!parsed?.meta || parsed.meta.err != null) return null;

  const message = parsed.transaction?.message;
  if (!message?.accountKeys || !message.instructions) return null;
  const accountKeys = message.accountKeys.map(parseAccountKey);
  const payer = accountKeys[0];
  if (!payer?.signer || payer.pubkey !== expectedWalletAddress) return null;

  const wallet = new PublicKey(expectedWalletAddress);
  for (const rawInstruction of message.instructions) {
    const instruction = parseInstruction(rawInstruction);
    if (!instruction || instruction.programId !== PUMPFUN_PROGRAM_ID.toBase58()) continue;

    try {
      const mint = new PublicKey(instruction.accounts[0]);
      const mintKey = accountKeys.find((account) => account?.pubkey === mint.toBase58());
      if (!mintKey?.signer) continue;
      const create = validatePumpCreateInstruction(
        Buffer.from(bs58.decode(instruction.data)),
        instruction.accounts.map((account) => new PublicKey(account)),
        wallet,
        mint,
      );
      return {
        metadataUri: create.metadataUri,
        mintAddress: mint.toBase58(),
        name: create.name,
        symbol: create.symbol,
      };
    } catch {
      continue;
    }
  }
  return null;
}

export function hasPumpCreateLogs(logs: readonly string[]): boolean {
  const pumpProgram = PUMPFUN_PROGRAM_ID.toBase58();
  return logs.some((log) => log.includes(`Program ${pumpProgram} invoke`)) &&
    logs.some((log) => log.includes("Instruction: InitializeMint2"));
}
