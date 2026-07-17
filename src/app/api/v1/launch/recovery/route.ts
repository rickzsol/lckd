import { type NextRequest } from "next/server";
import {
  Connection,
  PublicKey,
  SYSVAR_SLOT_HASHES_PUBKEY,
  VersionedTransaction,
  type MessageV0,
} from "@solana/web3.js";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { z } from "zod";
import { apiError, apiResponse, OPTIONS } from "@/lib/api/helpers";
import { requireLinkedWallet, type LinkedWalletSession } from "@/lib/api/auth";
import { requireSameOrigin } from "@/lib/api/origin";
import { checkRateLimit } from "@/lib/api/rateLimit";
import { isValidSolanaAddress } from "@/lib/api/validation";
import { getFinalizedBlockHeight } from "@/lib/api/onchain";
import {
  AtomicLaunchRecoveryError,
  checkpointAtomicAltCloseSubmitted,
  checkpointAtomicAltClosed,
  checkpointAtomicAltDeactivating,
  checkpointAtomicAltReady,
  checkpointAtomicAltSetupSubmitted,
  checkpointAtomicTransactionSubmitted,
  getOwnedAtomicLaunchIntent,
  issueAtomicAltCleanup,
  requestAtomicCleanup,
} from "@/lib/api/atomicLaunchRecovery";
import {
  classifyExactIssuedReceipt,
  hasFinalizedIssuedTupleExpired,
  replacementState,
  type AtomicIntentSnapshot,
} from "@/lib/api/atomicLaunchRecoveryValidation";
import {
  resolveExactLookupTable,
  validateLookupTablePreparation,
} from "@/lib/solana/lookupTable";
import {
  LOOKUP_TABLE_ACTIVE_SLOT,
  assertExactLookupTableForCleanup,
  assertLookupTableCanClose,
  buildLegacyLookupCleanupTransaction,
  buildLookupCleanupTransaction,
  validateLookupCleanupMessage,
  validateLookupCleanupTransaction,
  type LookupCleanupPhase,
} from "@/lib/solana/atomicLookupCleanup";
import { hashAtomicTransactionMessage } from "@/lib/solana/atomicLaunchBuilder.server";

export { OPTIONS };

const address = z.string().refine(isValidSolanaAddress, "Invalid Solana address");
const signature = z.string().min(64).max(90);
const stateVersion = z.number().int().nonnegative().safe();
const blockHeight = z.number().int().positive().safe();
const signedTransaction = z.string().min(100).max(2_000);
const checkpointSchema = z.discriminatedUnion("phase", [
  z.object({
    phase: z.literal("alt_setup_submitted"),
    mintAddress: address,
    expectedStateVersion: stateVersion,
    previousSignature: signature.nullable().default(null),
    setupSignature: signature,
    setupBlockhash: z.string().min(32).max(64),
    setupLastValidBlockHeight: blockHeight,
    transaction: signedTransaction,
  }).strict(),
  z.object({
    phase: z.literal("alt_ready"),
    mintAddress: address,
    expectedStateVersion: stateVersion,
  }).strict(),
  z.object({
    phase: z.literal("atomic_submitted"),
    mintAddress: address,
    expectedStateVersion: stateVersion,
    previousSignature: signature.nullable().default(null),
    atomicTxSignature: signature,
    lockMetadataId: address,
    lockAmount: z.string().regex(/^\d+$/),
    unlockTimestamp: z.number().int().positive().safe(),
    atomicBlockhash: z.string().min(32).max(64),
    atomicLastValidBlockHeight: blockHeight,
    transaction: signedTransaction,
  }).strict(),
  z.object({
    phase: z.literal("alt_deactivating"),
    mintAddress: address,
    expectedStateVersion: stateVersion,
    expectedAltStateVersion: stateVersion,
    previousSignature: signature.nullable().default(null),
    cleanupSignature: signature,
    cleanupBlockhash: z.string().min(32).max(64),
    cleanupLastValidBlockHeight: blockHeight,
    transaction: signedTransaction,
  }).strict(),
  z.object({
    phase: z.literal("alt_close_submitted"),
    mintAddress: address,
    expectedStateVersion: stateVersion,
    expectedAltStateVersion: stateVersion,
    previousSignature: signature.nullable().default(null),
    cleanupSignature: signature,
    cleanupBlockhash: z.string().min(32).max(64),
    cleanupLastValidBlockHeight: blockHeight,
    transaction: signedTransaction,
  }).strict(),
  z.object({
    phase: z.literal("alt_closed"),
    mintAddress: address,
    expectedStateVersion: stateVersion,
    expectedAltStateVersion: stateVersion,
    closeSignature: signature,
  }).strict(),
]);
const cleanupSchema = z.object({
  mintAddress: address,
  expectedStateVersion: stateVersion,
}).strict();
const cleanupBuildSchema = z.object({ mintAddress: address }).strict();
type AtomicIntent = AtomicIntentSnapshot;

function issuedSetupSigners(intent: AtomicIntent): PublicKey[] {
  const wallet = new PublicKey(intent.creatorWallet);
  if (!intent.issuedSetupTransaction || intent.issuedSetupRecentSlot === null) {
    return [wallet];
  }

  const issued = VersionedTransaction.deserialize(
    Buffer.from(intent.issuedSetupTransaction, "base64"),
  );
  validateLookupTablePreparation(issued.serialize(), {
    authority: wallet,
    payer: wallet,
    coSigner: new PublicKey(intent.metadataAddress),
    addresses: intent.altAddresses.map((value) => new PublicKey(value)),
    recentSlot: intent.issuedSetupRecentSlot,
    blockhash: intent.issuedSetupBlockhash,
    lastValidBlockHeight: intent.issuedSetupLastValidBlockHeight,
  });
  const signers = issued.message.staticAccountKeys.slice(
    0,
    issued.message.header.numRequiredSignatures,
  );
  const metadata = new PublicKey(intent.metadataAddress);
  const isLegacy = signers.length === 1 && signers[0]?.equals(wallet);
  const isCoSigned = signers.length === 2 &&
    signers[0]?.equals(wallet) &&
    signers[1]?.equals(metadata);
  if (!isLegacy && !isCoSigned) {
    throw new AtomicLaunchRecoveryError("Issued ALT setup signers are invalid", 422);
  }
  return signers;
}

let connectionPromise: Promise<Connection> | null = null;

async function getConnection(): Promise<Connection> {
  const rpcUrl = process.env.HELIUS_RPC_URL;
  if (!rpcUrl) throw new Error("Atomic recovery RPC is unavailable");
  if (!connectionPromise) {
    connectionPromise = (async () => {
      const connection = new Connection(rpcUrl, "finalized");
      if (await connection.getGenesisHash() !== "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d") {
        throw new Error("Atomic recovery cluster mismatch");
      }
      return connection;
    })().catch((error) => {
      connectionPromise = null;
      throw error;
    });
  }
  return connectionPromise;
}

async function getOwnedIntent(
  session: LinkedWalletSession,
  mintAddress: string | null,
): Promise<AtomicIntent | null> {
  return getOwnedAtomicLaunchIntent({
    githubId: session.github_id,
    creatorWallet: session.wallet_address,
    mintAddress,
  });
}

async function verifyFinalizedAltSetup(intent: AtomicIntent): Promise<void> {
  if (!intent.setupTx || !intent.setupBlockhash || !intent.setupLastValidBlockHeight) {
    throw new AtomicLaunchRecoveryError("ALT setup checkpoint is incomplete", 409);
  }
  const connection = await getConnection();
  const receipt = await connection.getTransaction(intent.setupTx, {
    commitment: "finalized",
    maxSupportedTransactionVersion: 0,
  });
  if (!receipt) throw new AtomicLaunchRecoveryError("ALT setup is not finalized", 409);
  if (receipt.meta?.err) throw new AtomicLaunchRecoveryError("ALT setup failed on-chain", 422);
  if (receipt.transaction.signatures[0] !== intent.setupTx) {
    throw new AtomicLaunchRecoveryError("ALT setup signature mismatch", 422);
  }
  const message = receipt.transaction.message as MessageV0;
  if (intent.issuedSetupRecentSlot === null) {
    throw new AtomicLaunchRecoveryError("ALT setup instruction is invalid", 422);
  }
  const unsigned = new VersionedTransaction(message);
  validateLookupTablePreparation(unsigned.serialize(), {
    authority: new PublicKey(intent.creatorWallet),
    payer: new PublicKey(intent.creatorWallet),
    coSigner: new PublicKey(intent.metadataAddress),
    addresses: intent.altAddresses.map((value) => new PublicKey(value)),
    recentSlot: intent.issuedSetupRecentSlot,
    blockhash: intent.setupBlockhash,
    lastValidBlockHeight: intent.setupLastValidBlockHeight,
  });
  await resolveExactLookupTable(
    connection,
    new PublicKey(intent.altAddress),
    new PublicKey(intent.creatorWallet),
    intent.altAddresses.map((value) => new PublicKey(value)),
  );
}

async function exactCleanupTable(intent: AtomicIntent) {
  const connection = await getConnection();
  const lookupTable = new PublicKey(intent.altAddress);
  const [accountInfo, currentSlot] = await Promise.all([
    connection.getAccountInfo(lookupTable, "finalized"),
    connection.getSlot("finalized"),
  ]);
  if (!accountInfo) return null;
  return assertExactLookupTableForCleanup(accountInfo, {
    wallet: new PublicKey(intent.creatorWallet),
    lookupTable,
    addresses: intent.altAddresses.map((value) => new PublicKey(value)),
    currentSlot,
  });
}

interface IssuedMessageExpectation {
  messageHash: string;
  blockhash: string;
  signers: readonly string[];
  searchAddresses: readonly string[];
}

type IssuedMessageDiscovery =
  | { state: "absent" }
  | { state: "processing"; signature: string }
  | { state: "finalized"; signature: string };

async function discoverIssuedSignature(
  expectation: IssuedMessageExpectation,
): Promise<IssuedMessageDiscovery> {
  const connection = await getConnection();
  const histories = await Promise.all(
    [...new Set(expectation.searchAddresses)].map((value) =>
      connection.getSignaturesForAddress(new PublicKey(value), { limit: 25 }, "confirmed")
    ),
  );
  const entries = new Map(
    histories.flat().filter((entry) => entry.err === null)
      .map((entry) => [entry.signature, entry] as const),
  );
  let processingSignature: string | null = null;

  for (const [signatureValue, signatureInfo] of entries) {
    const receipt = await connection.getTransaction(signatureValue, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (!receipt || receipt.meta?.err || receipt.transaction.message.version !== 0) continue;
    const message = receipt.transaction.message as MessageV0;
    const signers = message.staticAccountKeys
      .slice(0, message.header.numRequiredSignatures)
      .map((key) => key.toBase58());
    const serialized = new VersionedTransaction(message).serialize();
    if (
      message.recentBlockhash === expectation.blockhash &&
      hashAtomicTransactionMessage(serialized) === expectation.messageHash &&
      receipt.transaction.signatures.length === expectation.signers.length &&
      signers.length === expectation.signers.length &&
      signers.every((value, index) => value === expectation.signers[index]) &&
      receipt.transaction.signatures[0] === signatureValue
    ) {
      if (classifyExactIssuedReceipt(signatureInfo.confirmationStatus) === "finalized") {
        return { state: "finalized", signature: signatureValue };
      }
      processingSignature = signatureValue;
    }
  }
  return processingSignature
    ? { state: "processing", signature: processingSignature }
    : { state: "absent" };
}

async function requireIssuedBlockhashExpiry(
  blockhash: string,
  lastValidBlockHeight: number,
  finalizedBlockHeight: number,
  label: string,
): Promise<void> {
  const connection = await getConnection();
  const validity = await connection.isBlockhashValid(blockhash, { commitment: "finalized" });
  if (!hasFinalizedIssuedTupleExpired(
    finalizedBlockHeight,
    lastValidBlockHeight,
    validity.value,
  )) {
    throw new AtomicLaunchRecoveryError(`${label} is still valid and cannot be cleaned up`, 409);
  }
}

async function reconcileUncheckpointedSetup(
  session: LinkedWalletSession,
  intent: AtomicIntent,
  finalizedBlockHeight: number,
) {
  const setupSigners = issuedSetupSigners(intent);
  const discovery = await discoverIssuedSignature({
    messageHash: intent.issuedSetupMessageHash,
    blockhash: intent.issuedSetupBlockhash,
    signers: setupSigners.map((signer) => signer.toBase58()),
    searchAddresses: [intent.altAddress, intent.metadataAddress],
  });
  if (discovery.state === "processing") {
    throw new AtomicLaunchRecoveryError("Issued ALT setup is still processing", 409);
  }
  if (discovery.state === "absent") return null;
  const setupSignature = discovery.signature;
  const submitted = await checkpointAtomicAltSetupSubmitted({
    githubId: session.github_id,
    creatorWallet: session.wallet_address,
    mintAddress: intent.mintAddress,
    expectedStateVersion: intent.stateVersion,
    previousSignature: null,
    signature: setupSignature,
    blockhash: intent.issuedSetupBlockhash,
    lastValidBlockHeight: intent.issuedSetupLastValidBlockHeight,
    finalizedBlockHeight,
  });
  const checkpointed = await getOwnedIntent(session, intent.mintAddress);
  if (!checkpointed) throw new AtomicLaunchRecoveryError("ALT setup recovery state disappeared", 409);
  await verifyFinalizedAltSetup(checkpointed);
  return checkpointAtomicAltReady({
    githubId: session.github_id,
    creatorWallet: session.wallet_address,
    mintAddress: intent.mintAddress,
    expectedStateVersion: submitted.stateVersion,
    setupSignature,
  });
}

async function reconcileUncheckpointedAtomic(
  session: LinkedWalletSession,
  intent: AtomicIntent,
  finalizedBlockHeight: number,
) {
  if (
    !intent.issuedAtomicMessageHash || !intent.issuedAtomicBlockhash ||
    intent.issuedAtomicLastValidBlockHeight === null || !intent.issuedLockAmount ||
    intent.issuedUnlockTimestamp === null
  ) return null;
  const discovery = await discoverIssuedSignature({
    messageHash: intent.issuedAtomicMessageHash,
    blockhash: intent.issuedAtomicBlockhash,
    signers: [intent.creatorWallet, intent.mintAddress, intent.metadataAddress],
    searchAddresses: [intent.mintAddress, intent.metadataAddress, intent.altAddress],
  });
  if (discovery.state === "processing") {
    throw new AtomicLaunchRecoveryError("Issued atomic launch is still processing", 409);
  }
  if (discovery.state === "absent") return null;
  const atomicSignature = discovery.signature;
  return checkpointAtomicTransactionSubmitted({
    githubId: session.github_id,
    creatorWallet: session.wallet_address,
    mintAddress: intent.mintAddress,
    expectedStateVersion: intent.stateVersion,
    previousSignature: null,
    signature: atomicSignature,
    lockMetadataId: intent.metadataAddress,
    lockAmount: intent.issuedLockAmount,
    unlockTimestamp: intent.issuedUnlockTimestamp,
    blockhash: intent.issuedAtomicBlockhash,
    lastValidBlockHeight: intent.issuedAtomicLastValidBlockHeight,
    finalizedBlockHeight,
  });
}

async function verifyFinalizedCleanupReceipt(
  intent: AtomicIntent,
  phase: LookupCleanupPhase,
  transactionSignature: string,
  blockhash: string,
): Promise<void> {
  const connection = await getConnection();
  const receipt = await connection.getTransaction(transactionSignature, {
    commitment: "finalized",
    maxSupportedTransactionVersion: 0,
  });
  if (!receipt) throw new AtomicLaunchRecoveryError("ALT cleanup is not finalized", 409);
  if (receipt.meta?.err) throw new AtomicLaunchRecoveryError("ALT cleanup failed on-chain", 422);
  if (receipt.transaction.signatures[0] !== transactionSignature) {
    throw new AtomicLaunchRecoveryError("ALT cleanup signature mismatch", 422);
  }
  if (receipt.transaction.message.version !== 0) {
    throw new AtomicLaunchRecoveryError("ALT cleanup transaction version changed", 422);
  }
  try {
    validateLookupCleanupMessage(receipt.transaction.message, {
      phase,
      wallet: new PublicKey(intent.creatorWallet),
      lookupTable: new PublicKey(intent.altAddress),
      blockhash,
    });
  } catch {
    throw new AtomicLaunchRecoveryError("ALT cleanup transaction changed", 422);
  }
}

function validateSignedCleanupCheckpoint(
  intent: AtomicIntent,
  phase: LookupCleanupPhase,
  transactionBase64: string,
  transactionSignature: string,
  blockhash: string,
  lastValidBlockHeight: number,
): void {
  try {
    if (
      intent.issuedCleanupPhase !== phase ||
      !intent.issuedCleanupMessageHash ||
      intent.issuedCleanupBlockhash !== blockhash ||
      intent.issuedCleanupLastValidBlockHeight !== lastValidBlockHeight
    ) {
      throw new Error("ALT cleanup issuance changed");
    }
    const transaction = validateLookupCleanupTransaction(transactionBase64, {
      phase,
      wallet: new PublicKey(intent.creatorWallet),
      lookupTable: new PublicKey(intent.altAddress),
      blockhash,
    }, true);
    if (bs58.encode(transaction.signatures[0]) !== transactionSignature) {
      throw new Error("ALT cleanup signature changed");
    }
  } catch (error) {
    console.warn(
      "[launch/recovery] Cleanup checkpoint rejected:",
      error instanceof Error ? error.message : "unknown validation failure",
    );
    throw new AtomicLaunchRecoveryError("Signed ALT cleanup transaction changed", 422);
  }
}

function validateSignedIssuedTransaction(
  intent: AtomicIntent,
  phase: "setup" | "atomic",
  transactionBase64: string,
  claimedSignature: string,
  claimedBlockhash: string,
  claimedLastValidBlockHeight: number,
): void {
  try {
    const bytes = Buffer.from(transactionBase64, "base64");
    const transaction = VersionedTransaction.deserialize(bytes);
    const expectedHash = phase === "setup"
      ? intent.issuedSetupMessageHash
      : intent.issuedAtomicMessageHash;
    const expectedBlockhash = phase === "setup"
      ? intent.issuedSetupBlockhash
      : intent.issuedAtomicBlockhash;
    const expectedLastValidBlockHeight = phase === "setup"
      ? intent.issuedSetupLastValidBlockHeight
      : intent.issuedAtomicLastValidBlockHeight;
    if (!expectedHash || !expectedBlockhash || expectedLastValidBlockHeight === null) {
      throw new Error("issued tuple is incomplete");
    }
    if (hashAtomicTransactionMessage(bytes) !== expectedHash) {
      throw new Error("message hash changed after wallet signing");
    }
    if (transaction.message.recentBlockhash !== expectedBlockhash) {
      throw new Error("message blockhash changed after wallet signing");
    }
    if (claimedBlockhash !== expectedBlockhash) {
      throw new Error("claimed blockhash changed");
    }
    if (claimedLastValidBlockHeight !== expectedLastValidBlockHeight) {
      throw new Error("claimed last-valid block height changed");
    }
    if (bs58.encode(transaction.signatures[0]) !== claimedSignature) {
      throw new Error("claimed signature changed");
    }
    const signers = transaction.message.staticAccountKeys.slice(
      0,
      transaction.message.header.numRequiredSignatures,
    );
    const expectedSigners = phase === "setup"
      ? issuedSetupSigners(intent)
      : [
          new PublicKey(intent.creatorWallet),
          new PublicKey(intent.mintAddress),
          new PublicKey(intent.metadataAddress),
        ];
    if (
      signers.length !== expectedSigners.length ||
      signers.some((signer, index) => !signer.equals(expectedSigners[index]))
    ) {
      throw new Error("Issued transaction signers changed");
    }
    const message = transaction.message.serialize();
    transaction.signatures.forEach((signatureBytes, index) => {
      if (!nacl.sign.detached.verify(message, signatureBytes, signers[index].toBytes())) {
        throw new Error("Issued transaction signature is invalid");
      }
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "invalid signed transaction";
    console.warn("[launch/recovery] Issued transaction rejected", { phase, reason });
    throw new AtomicLaunchRecoveryError(`Signed ${phase} transaction rejected: ${reason}`, 422);
  }
}

async function reloadIntent(intent: AtomicIntent): Promise<AtomicIntent> {
  const current = await getOwnedAtomicLaunchIntent({
    githubId: intent.githubId,
    creatorWallet: intent.creatorWallet,
    mintAddress: intent.mintAddress,
  });
  if (!current) throw new AtomicLaunchRecoveryError("Atomic recovery state disappeared", 409);
  return current;
}

async function reconcileUncheckpointedCleanup(intent: AtomicIntent): Promise<AtomicIntent> {
  const phase = intent.issuedCleanupPhase;
  if (
    !phase || !intent.issuedCleanupMessageHash || !intent.issuedCleanupBlockhash ||
    intent.issuedCleanupLastValidBlockHeight === null
  ) return intent;
  const hasCheckpoint = phase === "deactivate"
    ? intent.altDeactivationTx !== null
    : intent.altCloseTx !== null;
  if (hasCheckpoint) return intent;
  const discovery = await discoverIssuedSignature({
    messageHash: intent.issuedCleanupMessageHash,
    blockhash: intent.issuedCleanupBlockhash,
    signers: [intent.creatorWallet],
    searchAddresses: [intent.altAddress],
  });
  if (discovery.state === "processing") {
    throw new AtomicLaunchRecoveryError("Issued ALT cleanup is still processing", 409);
  }
  if (discovery.state === "absent") return intent;
  const transactionSignature = discovery.signature;
  await verifyFinalizedCleanupReceipt(
    intent,
    phase,
    transactionSignature,
    intent.issuedCleanupBlockhash,
  );
  const finalizedBlockHeight = await getFinalizedBlockHeight();
  if (phase === "deactivate") {
    await checkpointAtomicAltDeactivating({
      githubId: intent.githubId,
      creatorWallet: intent.creatorWallet,
      mintAddress: intent.mintAddress,
      expectedStateVersion: intent.stateVersion,
      expectedAltStateVersion: intent.altStateVersion,
      previousSignature: null,
      signature: transactionSignature,
      blockhash: intent.issuedCleanupBlockhash,
      lastValidBlockHeight: intent.issuedCleanupLastValidBlockHeight,
      finalizedBlockHeight,
    });
    return reloadIntent(intent);
  }

  await checkpointAtomicAltCloseSubmitted({
    githubId: intent.githubId,
    creatorWallet: intent.creatorWallet,
    mintAddress: intent.mintAddress,
    expectedStateVersion: intent.stateVersion,
    expectedAltStateVersion: intent.altStateVersion,
    previousSignature: null,
    signature: transactionSignature,
    blockhash: intent.issuedCleanupBlockhash,
    lastValidBlockHeight: intent.issuedCleanupLastValidBlockHeight,
    finalizedBlockHeight,
  });
  const submitted = await reloadIntent(intent);
  if (await exactCleanupTable(submitted)) {
    throw new AtomicLaunchRecoveryError("ALT account still exists after finalized close", 422);
  }
  await checkpointAtomicAltClosed({
    githubId: submitted.githubId,
    creatorWallet: submitted.creatorWallet,
    mintAddress: submitted.mintAddress,
    expectedStateVersion: submitted.stateVersion,
    expectedAltStateVersion: submitted.altStateVersion,
    closeSignature: transactionSignature,
  });
  return reloadIntent(submitted);
}

async function cleanupTransactionResponse(
  intent: AtomicIntent,
  phase: LookupCleanupPhase,
  previousSignature: string | null,
) {
  const connection = await getConnection();
  const finalizedBlockHeight = await connection.getBlockHeight("finalized");
  let blockhash: string;
  let lastValidBlockHeight: number;
  let isReplayingIssuedCleanup = false;
  if (
    intent.issuedCleanupPhase === phase && intent.issuedCleanupMessageHash &&
    intent.issuedCleanupBlockhash && intent.issuedCleanupLastValidBlockHeight !== null
  ) {
    const validity = await connection.isBlockhashValid(intent.issuedCleanupBlockhash, {
      commitment: "finalized",
    });
    if (validity.value) {
      blockhash = intent.issuedCleanupBlockhash;
      lastValidBlockHeight = intent.issuedCleanupLastValidBlockHeight;
      isReplayingIssuedCleanup = true;
    } else {
      if (finalizedBlockHeight <= intent.issuedCleanupLastValidBlockHeight) {
        throw new AtomicLaunchRecoveryError("ALT cleanup issuance cannot be replaced yet", 409);
      }
      const latest = await connection.getLatestBlockhash("finalized");
      blockhash = latest.blockhash;
      lastValidBlockHeight = latest.lastValidBlockHeight;
    }
  } else {
    const latest = await connection.getLatestBlockhash("finalized");
    blockhash = latest.blockhash;
    lastValidBlockHeight = latest.lastValidBlockHeight;
  }
  const expectation = {
    phase,
    wallet: new PublicKey(intent.creatorWallet),
    lookupTable: new PublicKey(intent.altAddress),
    blockhash,
  };
  let transaction = buildLookupCleanupTransaction(expectation);
  if (
    isReplayingIssuedCleanup &&
    intent.issuedCleanupPhase === phase &&
    intent.issuedCleanupMessageHash &&
    hashAtomicTransactionMessage(transaction.serialize()) !== intent.issuedCleanupMessageHash
  ) {
    const legacyTransaction = buildLegacyLookupCleanupTransaction(expectation);
    if (hashAtomicTransactionMessage(legacyTransaction.serialize()) !== intent.issuedCleanupMessageHash) {
      throw new AtomicLaunchRecoveryError("ALT cleanup issuance changed", 422);
    }
    transaction = legacyTransaction;
  }
  await issueAtomicAltCleanup({
    githubId: intent.githubId,
    creatorWallet: intent.creatorWallet,
    mintAddress: intent.mintAddress,
    expectedStateVersion: intent.stateVersion,
    expectedAltStateVersion: intent.altStateVersion,
    phase,
    messageHash: hashAtomicTransactionMessage(transaction.serialize()),
    blockhash,
    lastValidBlockHeight,
    finalizedBlockHeight,
  });
  return {
    action: phase,
    transaction: Buffer.from(transaction.serialize()).toString("base64"),
    lookupTableAddress: intent.altAddress,
    lookupAddresses: intent.altAddresses,
    blockhash,
    lastValidBlockHeight,
    stateVersion: intent.stateVersion,
    altStateVersion: intent.altStateVersion,
    previousSignature,
  };
}

async function pendingCleanupHasExpired(
  transactionSignature: string,
  blockhash: string,
): Promise<boolean> {
  const connection = await getConnection();
  const [status, validity] = await Promise.all([
    connection.getSignatureStatus(transactionSignature, { searchTransactionHistory: true }),
    connection.isBlockhashValid(blockhash, { commitment: "finalized" }),
  ]);
  if (status.value && !status.value.err) return false;
  return !validity.value;
}

async function buildCleanupAction(intent: AtomicIntent) {
  let currentIntent = await reconcileUncheckpointedCleanup(intent);
  let lookupTable = await exactCleanupTable(currentIntent);
  if (currentIntent.altSetupExpired) {
    if (lookupTable) throw new AtomicLaunchRecoveryError("Expired ALT setup exists on-chain", 422);
    return { action: "closed", stateVersion: currentIntent.stateVersion };
  }
  if (!lookupTable) {
    if (currentIntent.altStatus === "closed") {
      return { action: "closed", stateVersion: currentIntent.stateVersion };
    }
    if (
      currentIntent.altStatus !== "close_submitted" ||
      !currentIntent.altCloseTx ||
      !currentIntent.altCloseBlockhash
    ) {
      throw new AtomicLaunchRecoveryError("ALT account disappeared before close verification", 422);
    }
    await verifyFinalizedCleanupReceipt(
      currentIntent,
      "close",
      currentIntent.altCloseTx,
      currentIntent.altCloseBlockhash,
    );
    const closed = await checkpointAtomicAltClosed({
      githubId: currentIntent.githubId,
      creatorWallet: currentIntent.creatorWallet,
      mintAddress: currentIntent.mintAddress,
      expectedStateVersion: currentIntent.stateVersion,
      expectedAltStateVersion: currentIntent.altStateVersion,
      closeSignature: currentIntent.altCloseTx,
    });
    return { action: "closed", stateVersion: closed.stateVersion };
  }

  if (lookupTable.state.deactivationSlot === LOOKUP_TABLE_ACTIVE_SLOT) {
    if (currentIntent.status !== "cleanup_required") {
      throw new AtomicLaunchRecoveryError("Completed launch ALT is unexpectedly active", 422);
    }
    if (currentIntent.altStatus === "deactivating") {
      if (
        !currentIntent.altDeactivationTx ||
        !currentIntent.altDeactivationBlockhash ||
        currentIntent.altDeactivationLastValidBlockHeight === null
      ) {
        throw new AtomicLaunchRecoveryError("ALT deactivation checkpoint is incomplete", 422);
      }
      if (!await pendingCleanupHasExpired(
        currentIntent.altDeactivationTx,
        currentIntent.altDeactivationBlockhash,
      )) {
        return { action: "awaiting_deactivation", stateVersion: currentIntent.stateVersion };
      }
      return cleanupTransactionResponse(
        currentIntent,
        "deactivate",
        currentIntent.altDeactivationTx,
      );
    }
    if (currentIntent.altStatus !== "ready") {
      throw new AtomicLaunchRecoveryError("ALT deactivation state is invalid", 409);
    }
    return cleanupTransactionResponse(currentIntent, "deactivate", null);
  }

  if (currentIntent.altStatus === "ready" && currentIntent.status === "completed") {
    if (
      !currentIntent.atomicTx ||
      !currentIntent.atomicBlockhash ||
      currentIntent.atomicLastValidBlockHeight === null
    ) {
      throw new AtomicLaunchRecoveryError("Completed atomic receipt is incomplete", 422);
    }
    const connection = await getConnection();
    const receipt = await connection.getTransaction(currentIntent.atomicTx, {
      commitment: "finalized",
      maxSupportedTransactionVersion: 0,
    });
    if (!receipt || receipt.meta?.err || receipt.transaction.signatures[0] !== currentIntent.atomicTx) {
      throw new AtomicLaunchRecoveryError("Completed atomic receipt is not finalized", 409);
    }
    const reconciled = await checkpointAtomicAltDeactivating({
      githubId: currentIntent.githubId,
      creatorWallet: currentIntent.creatorWallet,
      mintAddress: currentIntent.mintAddress,
      expectedStateVersion: currentIntent.stateVersion,
      expectedAltStateVersion: currentIntent.altStateVersion,
      previousSignature: null,
      signature: currentIntent.atomicTx,
      blockhash: currentIntent.atomicBlockhash,
      lastValidBlockHeight: currentIntent.atomicLastValidBlockHeight,
      finalizedBlockHeight: await getFinalizedBlockHeight(),
    });
    currentIntent = (await getOwnedAtomicLaunchIntent({
      githubId: currentIntent.githubId,
      creatorWallet: currentIntent.creatorWallet,
      mintAddress: currentIntent.mintAddress,
    })) ?? { ...currentIntent, altStatus: reconciled.altStatus, altStateVersion: reconciled.altStateVersion };
    lookupTable = await exactCleanupTable(currentIntent);
    if (!lookupTable) throw new AtomicLaunchRecoveryError("ALT account disappeared", 422);
  }

  if (currentIntent.altStatus === "close_submitted") {
    if (!currentIntent.altCloseTx || !currentIntent.altCloseBlockhash ||
        currentIntent.altCloseLastValidBlockHeight === null) {
      throw new AtomicLaunchRecoveryError("ALT close checkpoint is incomplete", 422);
    }
    if (!await pendingCleanupHasExpired(
      currentIntent.altCloseTx,
      currentIntent.altCloseBlockhash,
    )) {
      return { action: "awaiting_close", stateVersion: currentIntent.stateVersion };
    }
    return cleanupTransactionResponse(currentIntent, "close", currentIntent.altCloseTx);
  }
  if (currentIntent.altStatus !== "deactivating") {
    throw new AtomicLaunchRecoveryError("ALT is deactivated without a valid checkpoint", 422);
  }
  if (
    currentIntent.altDeactivationTx !== currentIntent.atomicTx &&
    currentIntent.altDeactivationTx &&
    currentIntent.altDeactivationBlockhash
  ) {
    await verifyFinalizedCleanupReceipt(
      currentIntent,
      "deactivate",
      currentIntent.altDeactivationTx,
      currentIntent.altDeactivationBlockhash,
    );
  }
  const connection = await getConnection();
  const slotHashes = await connection.getAccountInfo(SYSVAR_SLOT_HASHES_PUBKEY, "finalized");
  if (!slotHashes) throw new AtomicLaunchRecoveryError("SlotHashes sysvar is unavailable", 503);
  try {
    assertLookupTableCanClose(lookupTable.state.deactivationSlot, slotHashes.data);
  } catch (error) {
    if (error instanceof Error && error.message.includes("cooldown")) {
      return { action: "cooldown", stateVersion: currentIntent.stateVersion };
    }
    throw error;
  }
  return cleanupTransactionResponse(currentIntent, "close", null);
}

async function priorSignatureState(
  signatureValue: string,
  blockhash: string,
): Promise<"failed-or-absent" | "finalized"> {
  const connection = await getConnection();
  const [status, validity] = await Promise.all([
    connection.getSignatureStatus(signatureValue, { searchTransactionHistory: true }),
    connection.isBlockhashValid(blockhash, { commitment: "finalized" }),
  ]);
  const state = replacementState(status.value, validity.value);
  if (state === "failed-or-absent") return state;
  if (state === "blockhash-valid") {
    throw new AtomicLaunchRecoveryError(
      "The prior transaction blockhash remains valid and cannot be replaced",
      409,
    );
  }
  if (state === "finalized") return state;
  throw new AtomicLaunchRecoveryError(
    "The prior transaction is still processing and cannot be replaced",
    409,
  );
}

async function requestCleanupWithReceiptGuards(
  session: LinkedWalletSession,
  intent: AtomicIntent,
) {
  const finalizedBlockHeight = await getFinalizedBlockHeight();
  if (intent.status === "completed") {
    return {
      status: intent.status,
      stateVersion: intent.stateVersion,
      altStatus: intent.altStatus,
      altStateVersion: intent.altStateVersion,
      replayed: true,
    };
  }
  if (intent.status === "prepared") {
    const reconciled = await reconcileUncheckpointedSetup(session, intent, finalizedBlockHeight);
    if (reconciled) {
      return requestAtomicCleanup({
        githubId: session.github_id,
        creatorWallet: session.wallet_address,
        mintAddress: intent.mintAddress,
        expectedStateVersion: reconciled.stateVersion,
        finalizedBlockHeight,
      });
    }
    await requireIssuedBlockhashExpiry(
      intent.issuedSetupBlockhash,
      intent.issuedSetupLastValidBlockHeight,
      finalizedBlockHeight,
      "Issued ALT setup",
    );
    if (await exactCleanupTable(intent)) {
      throw new AtomicLaunchRecoveryError("Uncheckpointed ALT exists on-chain", 422);
    }
  }
  if (intent.status === "alt_setup_submitted") {
    if (!intent.setupTx || intent.setupLastValidBlockHeight === null) {
      throw new AtomicLaunchRecoveryError("ALT setup checkpoint is incomplete", 422);
    }
    if (!intent.setupBlockhash) {
      throw new AtomicLaunchRecoveryError("ALT setup checkpoint is incomplete", 422);
    }
    const setupState = await priorSignatureState(intent.setupTx, intent.setupBlockhash);
    if (setupState === "finalized") {
      await verifyFinalizedAltSetup(intent);
      const ready = await checkpointAtomicAltReady({
        githubId: session.github_id,
        creatorWallet: session.wallet_address,
        mintAddress: intent.mintAddress,
        expectedStateVersion: intent.stateVersion,
        setupSignature: intent.setupTx,
      });
      return requestAtomicCleanup({
        githubId: session.github_id,
        creatorWallet: session.wallet_address,
        mintAddress: intent.mintAddress,
        expectedStateVersion: ready.stateVersion,
        finalizedBlockHeight,
      });
    }
    if (finalizedBlockHeight <= intent.setupLastValidBlockHeight) {
      throw new AtomicLaunchRecoveryError("ALT setup has not expired", 409);
    }
    if (await exactCleanupTable(intent)) {
      throw new AtomicLaunchRecoveryError("ALT setup exists despite a failed receipt", 422);
    }
  }
  if (
    intent.status === "alt_ready" && intent.issuedAtomicMessageHash &&
    intent.issuedAtomicBlockhash && intent.issuedAtomicLastValidBlockHeight !== null
  ) {
    const reconciled = await reconcileUncheckpointedAtomic(session, intent, finalizedBlockHeight);
    if (reconciled) return reconciled;
    await requireIssuedBlockhashExpiry(
      intent.issuedAtomicBlockhash,
      intent.issuedAtomicLastValidBlockHeight,
      finalizedBlockHeight,
      "Issued atomic launch",
    );
  }
  if (intent.status === "atomic_submitted") {
    if (!intent.atomicTx) {
      throw new AtomicLaunchRecoveryError("Atomic checkpoint is incomplete", 422);
    }
    if (!intent.atomicBlockhash) {
      throw new AtomicLaunchRecoveryError("Atomic checkpoint is incomplete", 422);
    }
    if (await priorSignatureState(intent.atomicTx, intent.atomicBlockhash) === "finalized") {
      throw new AtomicLaunchRecoveryError(
        "Atomic launch finalized and must be reconciled before cleanup",
        409,
      );
    }
  }
  return requestAtomicCleanup({
    githubId: session.github_id,
    creatorWallet: session.wallet_address,
    mintAddress: intent.mintAddress,
    expectedStateVersion: intent.stateVersion,
    finalizedBlockHeight,
  });
}

function publicIntent(intent: AtomicIntent) {
  return {
    status: intent.status,
    stateVersion: intent.stateVersion,
    altStatus: intent.altStatus,
    altStateVersion: intent.altStateVersion,
    config: intent.config,
    metadata: intent.metadata,
    imageUri: intent.imageUri,
    expiresAt: intent.expiresAt,
    launchResult: {
      mintAddress: intent.mintAddress,
      createTxSignature: intent.atomicTx,
      lockTxSignature: intent.atomicTx,
      lockMetadataId: intent.lockMetadataId,
      lockAmount: intent.lockAmount ?? "",
      unlockTimestamp: intent.unlockTimestamp,
      lockBlockhash: intent.atomicBlockhash,
      lockLastValidBlockHeight: intent.atomicLastValidBlockHeight,
    },
  };
}

export async function GET(request: NextRequest) {
  const limited = await checkRateLimit(request, "launch");
  if (limited) return limited;
  const { session, error: authError } = await requireLinkedWallet();
  if (authError) return authError;
  try {
    const intent = await getOwnedIntent(session, null);
    if (!intent) return apiResponse({ intent: null });
    return apiResponse({ intent: publicIntent(intent) });
  } catch (error) {
    if (error instanceof AtomicLaunchRecoveryError) return apiError(error.message, error.status);
    console.error("[launch/recovery] Restore failed:", error);
    return apiError("Atomic launch recovery is unavailable", 503);
  }
}

export async function POST(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const limited = await checkRateLimit(request, "launch");
  if (limited) return limited;
  const { session, error: authError } = await requireLinkedWallet();
  if (authError) return authError;
  const parsed = checkpointSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError(parsed.error.issues[0].message, 400);
  const body = parsed.data;

  try {
    const intent = await getOwnedIntent(session, body.mintAddress);
    if (!intent) return apiError("Atomic launch recovery state was not found", 404);
    const finalizedBlockHeight = await getFinalizedBlockHeight();
    if (body.phase === "alt_setup_submitted") {
      if (body.previousSignature) {
        if (body.previousSignature !== intent.setupTx) {
          return apiError("Prior ALT setup signature does not match recovery state", 409);
        }
        if (!intent.setupBlockhash) return apiError("Prior ALT setup checkpoint is incomplete", 422);
        if (await priorSignatureState(body.previousSignature, intent.setupBlockhash) === "finalized") {
          await verifyFinalizedAltSetup(intent);
          const ready = await checkpointAtomicAltReady({
            githubId: session.github_id,
            creatorWallet: session.wallet_address,
            mintAddress: body.mintAddress,
            expectedStateVersion: body.expectedStateVersion,
            setupSignature: body.previousSignature,
          });
          return apiResponse(ready);
        }
      }
      validateSignedIssuedTransaction(
        intent,
        "setup",
        body.transaction,
        body.setupSignature,
        body.setupBlockhash,
        body.setupLastValidBlockHeight,
      );
      const result = await checkpointAtomicAltSetupSubmitted({
        githubId: session.github_id,
        creatorWallet: session.wallet_address,
        mintAddress: body.mintAddress,
        expectedStateVersion: body.expectedStateVersion,
        previousSignature: body.previousSignature,
        signature: body.setupSignature,
        blockhash: body.setupBlockhash,
        lastValidBlockHeight: body.setupLastValidBlockHeight,
        finalizedBlockHeight,
        transaction: body.transaction,
      });
      return apiResponse(result);
    }
    if (body.phase === "alt_ready") {
      await verifyFinalizedAltSetup(intent);
      const result = await checkpointAtomicAltReady({
        githubId: session.github_id,
        creatorWallet: session.wallet_address,
        mintAddress: body.mintAddress,
        expectedStateVersion: body.expectedStateVersion,
        setupSignature: intent.setupTx!,
      });
      return apiResponse(result);
    }
    if (body.phase === "alt_deactivating") {
      if (intent.status !== "cleanup_required") {
        return apiError("ALT deactivation is not available for this launch state", 409);
      }
      if (body.previousSignature) {
        if (body.previousSignature !== intent.altDeactivationTx) {
          return apiError("Prior ALT deactivation signature does not match recovery state", 409);
        }
        if (!intent.altDeactivationBlockhash) {
          return apiError("Prior ALT deactivation checkpoint is incomplete", 422);
        }
        if (await priorSignatureState(
          body.previousSignature,
          intent.altDeactivationBlockhash,
        ) === "finalized") {
          if (!intent.altDeactivationBlockhash) {
            return apiError("Prior ALT deactivation checkpoint is incomplete", 422);
          }
          await verifyFinalizedCleanupReceipt(
            intent,
            "deactivate",
            body.previousSignature,
            intent.altDeactivationBlockhash,
          );
          return apiResponse({
            status: intent.status,
            stateVersion: intent.stateVersion,
            altStatus: intent.altStatus,
            altStateVersion: intent.altStateVersion,
            replayed: true,
          });
        }
      }
      const lookupTable = await exactCleanupTable(intent);
      if (!lookupTable || lookupTable.state.deactivationSlot !== LOOKUP_TABLE_ACTIVE_SLOT) {
        return apiError("ALT is not active for deactivation", 409);
      }
      validateSignedCleanupCheckpoint(
        intent,
        "deactivate",
        body.transaction,
        body.cleanupSignature,
        body.cleanupBlockhash,
        body.cleanupLastValidBlockHeight,
      );
      const result = await checkpointAtomicAltDeactivating({
        githubId: session.github_id,
        creatorWallet: session.wallet_address,
        mintAddress: body.mintAddress,
        expectedStateVersion: body.expectedStateVersion,
        expectedAltStateVersion: body.expectedAltStateVersion,
        previousSignature: body.previousSignature,
        signature: body.cleanupSignature,
        blockhash: body.cleanupBlockhash,
        lastValidBlockHeight: body.cleanupLastValidBlockHeight,
        finalizedBlockHeight,
      });
      return apiResponse(result);
    }
    if (body.phase === "alt_close_submitted") {
      if (body.previousSignature) {
        if (body.previousSignature !== intent.altCloseTx) {
          return apiError("Prior ALT close signature does not match recovery state", 409);
        }
        if (!intent.altCloseBlockhash) return apiError("Prior ALT close checkpoint is incomplete", 422);
        if (await priorSignatureState(body.previousSignature, intent.altCloseBlockhash) === "finalized") {
          if (!intent.altCloseBlockhash) {
            return apiError("Prior ALT close checkpoint is incomplete", 422);
          }
          await verifyFinalizedCleanupReceipt(
            intent,
            "close",
            body.previousSignature,
            intent.altCloseBlockhash,
          );
          if (await exactCleanupTable(intent)) {
            return apiError("ALT account still exists after finalized close", 422);
          }
          const closed = await checkpointAtomicAltClosed({
            githubId: session.github_id,
            creatorWallet: session.wallet_address,
            mintAddress: body.mintAddress,
            expectedStateVersion: intent.stateVersion,
            expectedAltStateVersion: intent.altStateVersion,
            closeSignature: body.previousSignature,
          });
          return apiResponse(closed);
        }
      }
      const lookupTable = await exactCleanupTable(intent);
      if (!lookupTable || lookupTable.state.deactivationSlot === LOOKUP_TABLE_ACTIVE_SLOT) {
        return apiError("ALT is not ready to close", 409);
      }
      const slotHashes = await (await getConnection()).getAccountInfo(
        SYSVAR_SLOT_HASHES_PUBKEY,
        "finalized",
      );
      if (!slotHashes) return apiError("SlotHashes sysvar is unavailable", 503);
      try {
        assertLookupTableCanClose(lookupTable.state.deactivationSlot, slotHashes.data);
      } catch {
        return apiError("ALT cooldown has not finished", 409);
      }
      validateSignedCleanupCheckpoint(
        intent,
        "close",
        body.transaction,
        body.cleanupSignature,
        body.cleanupBlockhash,
        body.cleanupLastValidBlockHeight,
      );
      const result = await checkpointAtomicAltCloseSubmitted({
        githubId: session.github_id,
        creatorWallet: session.wallet_address,
        mintAddress: body.mintAddress,
        expectedStateVersion: body.expectedStateVersion,
        expectedAltStateVersion: body.expectedAltStateVersion,
        previousSignature: body.previousSignature,
        signature: body.cleanupSignature,
        blockhash: body.cleanupBlockhash,
        lastValidBlockHeight: body.cleanupLastValidBlockHeight,
        finalizedBlockHeight,
      });
      return apiResponse(result);
    }
    if (body.phase === "alt_closed") {
      if (
        intent.altStatus !== "close_submitted" ||
        intent.altCloseTx !== body.closeSignature ||
        !intent.altCloseBlockhash
      ) {
        return apiError("ALT close checkpoint does not match recovery state", 409);
      }
      await verifyFinalizedCleanupReceipt(
        intent,
        "close",
        body.closeSignature,
        intent.altCloseBlockhash,
      );
      if (await exactCleanupTable(intent)) {
        return apiError("ALT account still exists after close", 409);
      }
      const result = await checkpointAtomicAltClosed({
        githubId: session.github_id,
        creatorWallet: session.wallet_address,
        mintAddress: body.mintAddress,
        expectedStateVersion: body.expectedStateVersion,
        expectedAltStateVersion: body.expectedAltStateVersion,
        closeSignature: body.closeSignature,
      });
      return apiResponse(result);
    }
    if (body.lockMetadataId !== intent.metadataAddress) {
      return apiError("Atomic lock signer does not match the immutable launch intent", 422);
    }
    if (
      body.lockAmount !== intent.issuedLockAmount ||
      body.unlockTimestamp !== intent.issuedUnlockTimestamp
    ) {
      return apiError("Atomic lock terms changed from server issuance", 422);
    }
    if (body.previousSignature) {
      if (body.previousSignature !== intent.atomicTx) {
        return apiError("Prior atomic signature does not match recovery state", 409);
      }
      if (!intent.atomicBlockhash) return apiError("Prior atomic checkpoint is incomplete", 422);
      if (await priorSignatureState(body.previousSignature, intent.atomicBlockhash) === "finalized") {
        return apiError("Prior atomic launch finalized; reconcile its receipt", 409);
      }
    }
    validateSignedIssuedTransaction(
      intent,
      "atomic",
      body.transaction,
      body.atomicTxSignature,
      body.atomicBlockhash,
      body.atomicLastValidBlockHeight,
    );
    const result = await checkpointAtomicTransactionSubmitted({
      githubId: session.github_id,
      creatorWallet: session.wallet_address,
      mintAddress: body.mintAddress,
      expectedStateVersion: body.expectedStateVersion,
      previousSignature: body.previousSignature,
      signature: body.atomicTxSignature,
      lockMetadataId: body.lockMetadataId,
      lockAmount: body.lockAmount,
      unlockTimestamp: body.unlockTimestamp,
      blockhash: body.atomicBlockhash,
      lastValidBlockHeight: body.atomicLastValidBlockHeight,
      finalizedBlockHeight,
      transaction: body.transaction,
    });
    return apiResponse(result);
  } catch (error) {
    if (error instanceof AtomicLaunchRecoveryError) return apiError(error.message, error.status);
    console.error("[launch/recovery] Checkpoint failed:", error);
    return apiError("Atomic launch recovery is unavailable", 503);
  }
}

export async function PUT(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const limited = await checkRateLimit(request, "launch");
  if (limited) return limited;
  const { session, error: authError } = await requireLinkedWallet();
  if (authError) return authError;
  const parsed = cleanupBuildSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError(parsed.error.issues[0].message, 400);
  try {
    const intent = await getOwnedIntent(session, parsed.data.mintAddress);
    if (!intent) return apiError("Atomic launch recovery state was not found", 404);
    if (![
      "cleanup_required",
      "completed",
      "abandoned",
    ].includes(intent.status)) {
      return apiError("ALT cleanup has not been requested", 409);
    }
    return apiResponse(await buildCleanupAction(intent));
  } catch (error) {
    if (error instanceof AtomicLaunchRecoveryError) return apiError(error.message, error.status);
    console.error("[launch/recovery] Cleanup build failed:", error);
    return apiError("Atomic launch cleanup is unavailable", 503);
  }
}

export async function DELETE(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;
  const limited = await checkRateLimit(request, "launch");
  if (limited) return limited;
  const { session, error: authError } = await requireLinkedWallet();
  if (authError) return authError;
  const parsed = cleanupSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError(parsed.error.issues[0].message, 400);
  try {
    const intent = await getOwnedIntent(session, parsed.data.mintAddress);
    if (!intent) return apiError("Atomic launch recovery state was not found", 404);
    if (intent.stateVersion !== parsed.data.expectedStateVersion) {
      return apiError("Atomic launch recovery state changed", 409);
    }
    const result = await requestCleanupWithReceiptGuards(session, intent);
    return apiResponse(result);
  } catch (error) {
    if (error instanceof AtomicLaunchRecoveryError) return apiError(error.message, error.status);
    return apiError("Atomic launch cleanup is unavailable", 503);
  }
}
