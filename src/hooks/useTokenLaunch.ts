"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Connection,
  Keypair,
  PublicKey,
  type Transaction,
  type VersionedTransaction,
} from "@solana/web3.js";
import bs58 from "bs58";
import type { LaunchConfig } from "@/types/index";
import {
  confirmTxReliably,
  CREATE_TX_SOL_OVERHEAD,
  LOCK_TX_SOL_OVERHEAD,
  parseTransactionError,
  simulateVersionedTransactionOrThrow,
  validateAtomicLaunchTransactionClient,
  deriveReviewedAtomicEconomics,
  validateReviewedUnlockTimestamp,
  validateLookupSetupTransaction,
  assertLookupSetupCoSigner,
  restoreLocalVersionedSignatures,
} from "@/lib/solana";
import { validateLookupCleanupTransaction } from "@/lib/solana/atomicLookupCleanup";
import { formatLaunchFee, type LaunchFeeTerms } from "@/lib/solana/launchFee";
import {
  metadataDraftMatchesConfig,
  parseLaunchMetadataDraft,
  readLaunchMetadataDraft,
  writeLaunchMetadataDraft,
  type LaunchMetadataDraft,
} from "@/lib/launchMetadataDraft";

const LAMPORTS_PER_SOL = 1_000_000_000;
const STORAGE_KEY = "lckd_launch_wizard";

export type LaunchStatus = "idle" | "launching" | "success" | "error" | "partial";

export interface LaunchResult {
  mintAddress: string;
  createTxSignature: string;
  lockTxSignature: string | null;
  lockMetadataId: string | null;
  lockAmount: string;
  unlockTimestamp: number | null;
  lockBlockhash: string | null;
  lockLastValidBlockHeight: number | null;
}

export interface LaunchDeps {
  publicKey: PublicKey;
  signTransaction: <T extends Transaction | VersionedTransaction>(tx: T) => Promise<T>;
  connection: Connection;
}

type RecoveredLaunchConfig = Omit<LaunchConfig, "image">;

interface AtomicState {
  stateVersion: number;
  altStateVersion: number;
  status: string;
  altStatus: string;
}

interface CleanupActionResponse {
  action: "deactivate" | "close" | "cooldown" | "closed" |
    "awaiting_deactivation" | "awaiting_close";
  stateVersion: number;
  altStateVersion?: number;
  transaction?: string;
  lookupTableAddress?: string;
  lookupAddresses?: string[];
  blockhash?: string;
  lastValidBlockHeight?: number;
  previousSignature?: string | null;
}

interface SetupResponse extends AtomicState {
  transaction: string;
  mintPublicKey: string;
  metadataPublicKey: string;
  lookupTableAddress: string;
  lookupAddresses: string[];
  lookupAddressesHash: string;
  recentSlot: number;
  blockhash: string;
  lastValidBlockHeight: number;
  quotedTokenAmount: string;
  maxQuoteAmount: string;
  lockAmount: string;
  unlockTimestamp: number;
  streamflowFeePercent: number;
  feeMode: LaunchFeeTerms["feeMode"];
  feeLamports: number | null;
  feeLckdRaw: string | null;
  feeTreasury: string | null;
}

interface AtomicResponse {
  stateVersion: number;
  altStateVersion: number;
  transaction: string;
  mintPublicKey: string;
  metadataPublicKey: string;
  lookupTableAddress: string;
  lookupAddresses: string[];
  lookupAddressesHash: string;
  blockhash: string;
  lastValidBlockHeight: number;
  quotedTokenAmount: string;
  maxQuoteAmount: string;
  lockAmount: string;
  unlockTimestamp: number;
  feeMode: LaunchFeeTerms["feeMode"];
  feeLamports: number | null;
  feeLckdRaw: string | null;
  feeTreasury: string | null;
}

export const LAUNCH_PHASES_WITH_LOCK = [
  "Uploading metadata to IPFS...",
  "Preparing atomic launch resources...",
  "Awaiting wallet signature (lookup setup)...",
  "Finalizing lookup setup...",
  "Building atomic token launch and lock...",
  "Awaiting wallet signature (atomic launch)...",
  "Simulating atomic launch...",
  "Finalizing token launch and lock...",
] as const;

async function responseError(response: Response, fallback: string): Promise<Error> {
  const body = await response.json().catch(() => null);
  return new Error(body && typeof body.error === "string" ? body.error : fallback);
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) throw await responseError(response, "Launch request failed");
  return response.json() as Promise<T>;
}

async function saveLaunchCheckpoint(body: Record<string, unknown>): Promise<AtomicState> {
  return requestJson<AtomicState>("/api/v1/launch/recovery", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function requestCleanup(
  mintAddress: string,
  expectedStateVersion: number,
): Promise<AtomicState> {
  return requestJson<AtomicState>("/api/v1/launch/recovery", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mintAddress, expectedStateVersion }),
  });
}

async function requestCleanupAction(mintAddress: string): Promise<CleanupActionResponse> {
  return requestJson<CleanupActionResponse>("/api/v1/launch/recovery", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mintAddress }),
  });
}

async function persistAtomicLaunch(
  publicKey: PublicKey,
  mintAddress: string,
  atomicTxSignature: string,
  lockMetadataId: string,
): Promise<AtomicState> {
  return requestJson<AtomicState>("/api/v1/token/record", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mintAddress,
      creatorWallet: publicKey.toBase58(),
      atomicTxSignature,
      lockMetadataId,
    }),
  });
}

async function hashLookupAddresses(addresses: readonly string[]): Promise<string> {
  const prefix = new TextEncoder().encode("lckd-atomic-alt-v1");
  const addressBytes = addresses.map((address) => new PublicKey(address).toBytes());
  const payload = new Uint8Array(prefix.length + addressBytes.length * 32);
  payload.set(prefix);
  addressBytes.forEach((address, index) => payload.set(address, prefix.length + index * 32));
  const digest = await crypto.subtle.digest("SHA-256", payload);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function assertSetupResponse(value: SetupResponse, wallet: PublicKey): void {
  if (
    typeof value.transaction !== "string" ||
    typeof value.lookupTableAddress !== "string" ||
    !Array.isArray(value.lookupAddresses) ||
    !/^[0-9a-f]{64}$/.test(value.lookupAddressesHash) ||
    !Number.isSafeInteger(value.stateVersion) ||
    !Number.isSafeInteger(value.altStateVersion) ||
    !Number.isSafeInteger(value.recentSlot) ||
    !Number.isSafeInteger(value.lastValidBlockHeight) ||
    !/^\d+$/.test(value.quotedTokenAmount) ||
    !/^\d+$/.test(value.maxQuoteAmount) ||
    !/^\d+$/.test(value.lockAmount) ||
    !Number.isSafeInteger(value.unlockTimestamp) ||
    !Number.isFinite(value.streamflowFeePercent) ||
    value.streamflowFeePercent < 0 ||
    value.streamflowFeePercent >= 100 ||
    value.status !== "prepared" ||
    value.mintPublicKey === wallet.toBase58() ||
    value.metadataPublicKey === wallet.toBase58() ||
    value.mintPublicKey === value.metadataPublicKey
  ) {
    throw new Error("Atomic setup API returned invalid state");
  }
}

function assertAtomicResponse(
  value: AtomicResponse,
  mint: PublicKey,
  metadata: PublicKey,
  setup: SetupResponse,
): void {
  if (
    typeof value.transaction !== "string" ||
    value.mintPublicKey !== mint.toBase58() ||
    value.metadataPublicKey !== metadata.toBase58() ||
    value.lookupTableAddress !== setup.lookupTableAddress ||
    value.lookupAddresses.join(",") !== setup.lookupAddresses.join(",") ||
    value.lookupAddressesHash !== setup.lookupAddressesHash ||
    !/^\d+$/.test(value.quotedTokenAmount) ||
    !/^\d+$/.test(value.maxQuoteAmount) ||
    !/^\d+$/.test(value.lockAmount) ||
    !Number.isSafeInteger(value.unlockTimestamp) ||
    !Number.isSafeInteger(value.stateVersion) ||
    !Number.isSafeInteger(value.altStateVersion) ||
    !Number.isSafeInteger(value.lastValidBlockHeight)
  ) {
    throw new Error("Atomic launch API returned invalid state");
  }
}

function signatureOf(transaction: VersionedTransaction, label: string): string {
  const signature = transaction.signatures[0];
  if (!signature || signature.every((byte) => byte === 0)) {
    throw new Error(`Wallet did not sign the ${label} transaction`);
  }
  return bs58.encode(signature);
}

function transactionBase64(transaction: VersionedTransaction): string {
  const bytes = transaction.serialize();
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 1) {
    binary += String.fromCharCode(bytes[offset]);
  }
  return btoa(binary);
}

export function useTokenLaunch(config: LaunchConfig) {
  const [launchStatus, setLaunchStatus] = useState<LaunchStatus>("idle");
  const [launchPhase, setLaunchPhase] = useState(0);
  const [launchResult, setLaunchResult] = useState<LaunchResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [recoveredConfig, setRecoveredConfig] = useState<RecoveredLaunchConfig | null>(null);
  const [recoveryStateVersion, setRecoveryStateVersion] = useState<number | null>(null);
  const [, setRecoveryAltStateVersion] = useState<number | null>(null);
  const [recoveryStatus, setRecoveryStatus] = useState<string | null>(null);
  const [recoveryAltStatus, setRecoveryAltStatus] = useState<string | null>(null);
  const [resolvedFee, setResolvedFee] = useState<string | null>(null);
  const [metadataDraft, setMetadataDraft] = useState<LaunchMetadataDraft | null>(
    readLaunchMetadataDraft,
  );
  const isLaunchInFlight = useRef(false);

  const applyRecoveryState = useCallback((state: AtomicState) => {
    setRecoveryStateVersion(state.stateVersion);
    setRecoveryAltStateVersion(state.altStateVersion);
    setRecoveryStatus(state.status);
    setRecoveryAltStatus(state.altStatus);
  }, []);

  useEffect(() => {
    let isCancelled = false;
    void requestJson<{ intent: null | {
      status: string;
      stateVersion: number;
      altStatus: string;
      altStateVersion: number;
      config: RecoveredLaunchConfig;
      metadata: LaunchMetadataDraft;
      imageUri: string;
      launchResult: LaunchResult;
    } }>("/api/v1/launch/recovery", { cache: "no-store" })
      .then(async ({ intent }) => {
        if (isCancelled || !intent) return;
        applyRecoveryState(intent);
        const recoveredMetadata = parseLaunchMetadataDraft(intent.metadata);
        if (recoveredMetadata) {
          setMetadataDraft(recoveredMetadata);
          writeLaunchMetadataDraft(recoveredMetadata);
        }
        setRecoveredConfig({ ...intent.config, imageUri: intent.imageUri });
        setLaunchResult(intent.launchResult);
        if (intent.status === "completed") {
          setMetadataDraft(null);
          writeLaunchMetadataDraft(null);
          setLaunchStatus("success");
          return;
        }
        setLaunchStatus("partial");
        if (intent.status === "atomic_submitted") {
          setErrorMessage("Recovered a submitted atomic launch. Verify its finalized receipt to continue.");
          return;
        }
        if (intent.status === "cleanup_required") {
          setErrorMessage("The lookup table must be deactivated and closed before a new launch.");
          return;
        }
        if (intent.status === "abandoned" && intent.altStatus === "closed") {
          setLaunchStatus("idle");
          setLaunchResult(null);
          setErrorMessage(null);
          return;
        }
        const cleanup = await requestCleanup(
          intent.launchResult.mintAddress,
          intent.stateVersion,
        );
        if (isCancelled) return;
        applyRecoveryState(cleanup);
        if (cleanup.status === "abandoned" && cleanup.altStatus === "closed") {
          setLaunchStatus("idle");
          setLaunchResult(null);
          setErrorMessage(null);
          return;
        }
        setErrorMessage(cleanup.status === "atomic_submitted"
          ? "The atomic launch finalized and is ready for receipt verification."
          : "The lookup table is ready for wallet-authorized cleanup.");
      })
      .catch((error) => {
        if (!isCancelled) {
          console.error("[launch/recovery] Restore failed:", error);
          setLaunchStatus("partial");
          setErrorMessage(error instanceof Error
            ? error.message
            : "Atomic launch recovery is waiting for a safe retry");
        }
      });
    return () => { isCancelled = true; };
  }, [applyRecoveryState]);

  const launch = useCallback(async ({ publicKey, signTransaction, connection }: LaunchDeps) => {
    if (isLaunchInFlight.current) return;
    isLaunchInFlight.current = true;
    setLaunchStatus("launching");
    setLaunchPhase(0);
    setErrorMessage(null);
    let mintAddress = "";
    let stateVersion: number | null = null;
    let isSetupCheckpointed = false;
    let setupLanded = false;
    let atomicSignature = "";
    let isAtomicCheckpointed = false;
    try {
      const requiredSol = config.buyAmountSol + CREATE_TX_SOL_OVERHEAD + LOCK_TX_SOL_OVERHEAD;
      const walletSol = (await connection.getBalance(publicKey, "confirmed")) / LAMPORTS_PER_SOL;
      if (walletSol < requiredSol) {
        throw new Error(`Insufficient SOL. You have ${walletSol.toFixed(4)} SOL but need ~${requiredSol.toFixed(4)} SOL.`);
      }
      let uploaded = !config.image && metadataDraft && config.imageUri === metadataDraft.imageUri &&
          metadataDraftMatchesConfig(metadataDraft, config)
        ? metadataDraft
        : null;
      if (!uploaded) {
        if (!config.image) throw new Error("Token image is required");
        const metadataForm = new FormData();
        metadataForm.append("file", config.image);
        metadataForm.append("name", config.name);
        metadataForm.append("symbol", config.ticker);
        metadataForm.append("description", config.description);
        if (config.twitterUrl) metadataForm.append("twitter", config.twitterUrl);
        if (config.telegramUrl) metadataForm.append("telegram", config.telegramUrl);
        if (config.websiteUrl) metadataForm.append("website", config.websiteUrl);
        const result = await requestJson<{ metadataUri: string; imageUri: string }>(
          "/api/v1/metadata/upload",
          { method: "POST", body: metadataForm },
        );
        uploaded = parseLaunchMetadataDraft({
          ...result,
          name: config.name,
          ticker: config.ticker,
          description: config.description,
          twitterUrl: config.twitterUrl,
          telegramUrl: config.telegramUrl,
          websiteUrl: config.websiteUrl,
        });
        if (!uploaded) throw new Error("Metadata upload returned an invalid response");
        setMetadataDraft(uploaded);
        writeLaunchMetadataDraft(uploaded);
        const { image: ignoredImage, ...storedConfig } = config;
        void ignoredImage;
        setRecoveredConfig({ ...storedConfig, imageUri: uploaded.imageUri });
      }

      setLaunchPhase(1);
      const mintKeypair = Keypair.generate();
      const metadataKeypair = Keypair.generate();
      mintAddress = mintKeypair.publicKey.toBase58();
      const setupEconomics = await deriveReviewedAtomicEconomics(connection, config, publicKey);
      const setup = await requestJson<SetupResponse>("/api/v1/launch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletPublicKey: publicKey.toBase58(),
          mintPublicKey: mintAddress,
          metadataPublicKey: metadataKeypair.publicKey.toBase58(),
          metadataUri: uploaded.metadataUri,
          imageUri: uploaded.imageUri,
          name: config.name,
          ticker: config.ticker,
          description: config.description,
          buyAmountSol: config.buyAmountSol,
          lockDurationDays: config.lockDurationDays,
          lockPercentage: config.lockPercentage,
          githubUsername: config.githubUsername,
          githubRepo: config.githubRepo,
          liveUrl: config.liveUrl,
          twitterUrl: config.twitterUrl,
          telegramUrl: config.telegramUrl,
          websiteUrl: config.websiteUrl,
        }),
      });
      assertSetupResponse(setup, publicKey);
      setResolvedFee(formatLaunchFee({
        feeMode: setup.feeMode ?? "waived",
        feeLamports: setup.feeLamports ?? null,
        feeLckdRaw: setup.feeLckdRaw ?? null,
        feeTreasury: setup.feeTreasury ?? null,
      }));
      if (
        setup.quotedTokenAmount !== setupEconomics.quotedTokenAmount ||
        setup.maxQuoteAmount !== setupEconomics.maxQuoteAmount ||
        setup.lockAmount !== setupEconomics.lockAmount ||
        setup.streamflowFeePercent !== setupEconomics.streamflowFeePercent
      ) {
        throw new Error("Atomic setup economics changed from the reviewed configuration");
      }
      validateReviewedUnlockTimestamp(
        setup.unlockTimestamp,
        setupEconomics.clusterTimestamp,
        config.lockDurationDays,
      );
      if (setup.mintPublicKey !== mintAddress ||
          setup.metadataPublicKey !== metadataKeypair.publicKey.toBase58()) {
        throw new Error("Atomic setup signer identities changed");
      }
      if (await hashLookupAddresses(setup.lookupAddresses) !== setup.lookupAddressesHash) {
        throw new Error("Atomic setup lookup vector hash mismatch");
      }
      stateVersion = setup.stateVersion;
      applyRecoveryState(setup);
      setLaunchResult({
        mintAddress,
        createTxSignature: "",
        lockTxSignature: null,
        lockMetadataId: null,
        lockAmount: "",
        unlockTimestamp: null,
        lockBlockhash: setup.blockhash,
        lockLastValidBlockHeight: setup.lastValidBlockHeight,
      });

      setLaunchPhase(2);
      let setupTransaction = validateLookupSetupTransaction(setup.transaction, {
        wallet: publicKey,
        coSigner: metadataKeypair.publicKey,
        lookupTable: new PublicKey(setup.lookupTableAddress),
        addresses: setup.lookupAddresses.map((address) => new PublicKey(address)),
        recentSlot: setup.recentSlot,
        blockhash: setup.blockhash,
        lastValidBlockHeight: setup.lastValidBlockHeight,
      });
      assertLookupSetupCoSigner(setupTransaction, metadataKeypair.publicKey);
      setupTransaction.sign([metadataKeypair]);
      const issuedSetupMessage = setupTransaction.message.serialize();
      setupTransaction = await signTransaction(setupTransaction);
      setupTransaction = restoreLocalVersionedSignatures(
        issuedSetupMessage,
        setupTransaction,
        [metadataKeypair],
        "lookup setup",
      );
      await simulateVersionedTransactionOrThrow(connection, setupTransaction, "Lookup setup", {
        wallet: publicKey,
        maxLamports: Math.ceil(0.02 * LAMPORTS_PER_SOL),
      });
      const setupSignature = signatureOf(setupTransaction, "lookup setup");
      const setupCheckpoint = await saveLaunchCheckpoint({
        phase: "alt_setup_submitted",
        mintAddress,
        expectedStateVersion: stateVersion,
        previousSignature: null,
        setupSignature,
        setupBlockhash: setup.blockhash,
        setupLastValidBlockHeight: setup.lastValidBlockHeight,
        transaction: transactionBase64(setupTransaction),
      });
      stateVersion = setupCheckpoint.stateVersion;
      applyRecoveryState(setupCheckpoint);
      isSetupCheckpointed = true;
      const submittedSetup = await connection.sendRawTransaction(setupTransaction.serialize(), {
        skipPreflight: false,
        preflightCommitment: "confirmed",
        maxRetries: 3,
      });
      if (submittedSetup !== setupSignature) throw new Error("RPC returned an unexpected setup signature");

      setLaunchPhase(3);
      await confirmTxReliably(connection, setupSignature, setup.blockhash, setup.lastValidBlockHeight, "finalized");
      setupLanded = true;
      const ready = await saveLaunchCheckpoint({
        phase: "alt_ready",
        mintAddress,
        expectedStateVersion: stateVersion,
      });
      stateVersion = ready.stateVersion;
      applyRecoveryState(ready);

      setLaunchPhase(4);
      const atomic = await requestJson<AtomicResponse>("/api/v1/launch/atomic", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mintPublicKey: mintAddress,
          metadataPublicKey: metadataKeypair.publicKey.toBase58(),
        }),
      });
      assertAtomicResponse(atomic, mintKeypair.publicKey, metadataKeypair.publicKey, setup);
      if (
        atomic.quotedTokenAmount !== setup.quotedTokenAmount ||
        atomic.maxQuoteAmount !== setup.maxQuoteAmount ||
        atomic.lockAmount !== setup.lockAmount ||
        atomic.unlockTimestamp !== setup.unlockTimestamp ||
        atomic.feeMode !== setup.feeMode ||
        atomic.feeLamports !== setup.feeLamports ||
        atomic.feeLckdRaw !== setup.feeLckdRaw ||
        atomic.feeTreasury !== setup.feeTreasury
      ) {
        throw new Error("Atomic launch economics changed after setup approval");
      }
      stateVersion = atomic.stateVersion;
      setRecoveryStateVersion(stateVersion);
      const lookupAddress = new PublicKey(atomic.lookupTableAddress);
      const lookupResponse = await connection.getAddressLookupTable(lookupAddress, {
        commitment: "confirmed",
      });
      if (!lookupResponse.value) throw new Error("Atomic lookup table is unavailable");
      if ((await connection.getSlot("confirmed")) <= lookupResponse.value.state.lastExtendedSlot) {
        throw new Error("Atomic lookup table is not activated yet");
      }

      setLaunchPhase(5);
      let atomicTransaction = await validateAtomicLaunchTransactionClient(atomic.transaction, {
        wallet: publicKey,
        mint: mintKeypair.publicKey,
        metadata: metadataKeypair.publicKey,
        lookupTable: lookupResponse.value,
        lookupAddresses: atomic.lookupAddresses.map((address) => new PublicKey(address)),
        blockhash: atomic.blockhash,
        name: config.name,
        ticker: config.ticker,
        metadataUri: uploaded.metadataUri,
        quotedTokenAmount: atomic.quotedTokenAmount,
        maxQuoteAmount: atomic.maxQuoteAmount,
        lockAmount: atomic.lockAmount,
        unlockTimestamp: atomic.unlockTimestamp,
        fee: {
          feeMode: setup.feeMode ?? "waived",
          feeLamports: setup.feeLamports ?? null,
          feeLckdRaw: setup.feeLckdRaw ?? null,
          feeTreasury: setup.feeTreasury ?? null,
        },
      });
      atomicTransaction.sign([mintKeypair, metadataKeypair]);
      const issuedAtomicMessage = atomicTransaction.message.serialize();
      atomicTransaction = await signTransaction(atomicTransaction);
      atomicTransaction = restoreLocalVersionedSignatures(
        issuedAtomicMessage,
        atomicTransaction,
        [mintKeypair, metadataKeypair],
        "atomic launch",
      );

      setLaunchPhase(6);
      await simulateVersionedTransactionOrThrow(connection, atomicTransaction, "Atomic launch", {
        wallet: publicKey,
        maxLamports: Math.ceil(requiredSol * LAMPORTS_PER_SOL),
      });
      atomicSignature = signatureOf(atomicTransaction, "atomic launch");
      const atomicCheckpoint = await saveLaunchCheckpoint({
        phase: "atomic_submitted",
        mintAddress,
        expectedStateVersion: stateVersion,
        previousSignature: null,
        atomicTxSignature: atomicSignature,
        lockMetadataId: metadataKeypair.publicKey.toBase58(),
        lockAmount: atomic.lockAmount,
        unlockTimestamp: atomic.unlockTimestamp,
        atomicBlockhash: atomic.blockhash,
        atomicLastValidBlockHeight: atomic.lastValidBlockHeight,
        transaction: transactionBase64(atomicTransaction),
      });
      stateVersion = atomicCheckpoint.stateVersion;
      applyRecoveryState(atomicCheckpoint);
      isAtomicCheckpointed = true;
      setLaunchResult({
        mintAddress,
        createTxSignature: atomicSignature,
        lockTxSignature: atomicSignature,
        lockMetadataId: metadataKeypair.publicKey.toBase58(),
        lockAmount: atomic.lockAmount,
        unlockTimestamp: atomic.unlockTimestamp,
        lockBlockhash: atomic.blockhash,
        lockLastValidBlockHeight: atomic.lastValidBlockHeight,
      });
      const submittedAtomic = await connection.sendRawTransaction(atomicTransaction.serialize(), {
        skipPreflight: false,
        preflightCommitment: "confirmed",
        maxRetries: 5,
      });
      if (submittedAtomic !== atomicSignature) throw new Error("RPC returned an unexpected atomic signature");

      setLaunchPhase(7);
      await confirmTxReliably(connection, atomicSignature, atomic.blockhash, atomic.lastValidBlockHeight, "finalized");
      const completed = await persistAtomicLaunch(
        publicKey,
        mintAddress,
        atomicSignature,
        metadataKeypair.publicKey.toBase58(),
      );
      applyRecoveryState(completed);
      setLaunchStatus("success");
      setMetadataDraft(null);
      writeLaunchMetadataDraft(null);
      sessionStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      console.error("[launch] Error:", error);
      let hasPendingCleanup = false;
      if (stateVersion !== null && mintAddress && !isSetupCheckpointed) {
        try {
          const cleanup = await requestCleanup(mintAddress, stateVersion);
          applyRecoveryState(cleanup);
          hasPendingCleanup = cleanup.status !== "abandoned" || cleanup.altStatus !== "closed";
          stateVersion = hasPendingCleanup ? cleanup.stateVersion : null;
        } catch (cleanupError) {
          hasPendingCleanup = true;
          console.error("[launch] Cleanup request deferred:", cleanupError);
        }
      }
      const message = parseTransactionError(
        error instanceof Error ? error.message : String(error),
        config.buyAmountSol,
      );
      if (stateVersion !== null) setRecoveryStateVersion(stateVersion);
      if (isAtomicCheckpointed) {
        setLaunchStatus("partial");
        setErrorMessage(`Atomic launch submitted; receipt reconciliation is pending: ${message}`);
      } else if (setupLanded || isSetupCheckpointed) {
        setLaunchStatus("partial");
        setErrorMessage(`No token was created. The lookup table requires cleanup: ${message}`);
      } else if (hasPendingCleanup) {
        setLaunchStatus("partial");
        setErrorMessage(`No token was created. Wait for the issued lookup transaction to expire, then retry cleanup: ${message}`);
      } else {
        setLaunchStatus("error");
        setErrorMessage(message);
      }
    } finally {
      isLaunchInFlight.current = false;
    }
  }, [applyRecoveryState, config, metadataDraft]);

  const cleanupLookup = useCallback(async ({
    publicKey,
    signTransaction,
    connection,
  }: LaunchDeps): Promise<boolean> => {
    if (!launchResult?.mintAddress) throw new Error("ALT cleanup mint is unavailable");
    const mintAddress = launchResult.mintAddress;
    if (!["cleanup_required", "completed", "abandoned"].includes(recoveryStatus ?? "")) {
      if (recoveryStateVersion === null) throw new Error("Recovery version is unavailable");
      const cleanup = await requestCleanup(mintAddress, recoveryStateVersion);
      applyRecoveryState(cleanup);
      if (cleanup.status === "abandoned" && cleanup.altStatus === "closed") return true;
      if (cleanup.status !== "cleanup_required") {
        throw new Error("The issued transaction is still being reconciled. Retry shortly.");
      }
    }
    const action = await requestCleanupAction(mintAddress);
    if (action.action === "closed") {
      setRecoveryAltStatus("closed");
      return true;
    }
    if (action.action === "cooldown") {
      throw new Error("ALT deactivation is finalized. Retry cleanup after the SlotHashes cooldown.");
    }
    if (action.action === "awaiting_deactivation" || action.action === "awaiting_close") {
      throw new Error("ALT cleanup is still finalizing. Retry shortly.");
    }
    if (
      !action.transaction ||
      !action.lookupTableAddress ||
      !action.blockhash ||
      !Number.isSafeInteger(action.lastValidBlockHeight) ||
      !Number.isSafeInteger(action.altStateVersion)
    ) {
      throw new Error("ALT cleanup API returned invalid state");
    }
    let transaction = validateLookupCleanupTransaction(action.transaction, {
      phase: action.action,
      wallet: publicKey,
      lookupTable: new PublicKey(action.lookupTableAddress),
      blockhash: action.blockhash,
    });
    transaction = await signTransaction(transaction);
    validateLookupCleanupTransaction(transactionBase64(transaction), {
      phase: action.action,
      wallet: publicKey,
      lookupTable: new PublicKey(action.lookupTableAddress),
      blockhash: action.blockhash,
    }, true);
    await simulateVersionedTransactionOrThrow(connection, transaction, "Lookup cleanup", {
      wallet: publicKey,
      maxLamports: Math.ceil(0.005 * LAMPORTS_PER_SOL),
    });
    const cleanupSignature = signatureOf(transaction, `lookup ${action.action}`);
    const checkpoint = await saveLaunchCheckpoint({
      phase: action.action === "deactivate" ? "alt_deactivating" : "alt_close_submitted",
      mintAddress,
      expectedStateVersion: action.stateVersion,
      expectedAltStateVersion: action.altStateVersion,
      previousSignature: action.previousSignature ?? null,
      cleanupSignature,
      cleanupBlockhash: action.blockhash,
      cleanupLastValidBlockHeight: action.lastValidBlockHeight,
      transaction: transactionBase64(transaction),
    });
    applyRecoveryState(checkpoint);
    const submitted = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      preflightCommitment: "confirmed",
      maxRetries: 5,
    });
    if (submitted !== cleanupSignature) {
      throw new Error("RPC returned an unexpected ALT cleanup signature");
    }
    await confirmTxReliably(
      connection,
      cleanupSignature,
      action.blockhash,
      action.lastValidBlockHeight!,
      "finalized",
    );
    if (action.action === "deactivate") {
      throw new Error("ALT deactivation finalized. Retry cleanup after the SlotHashes cooldown.");
    }
    const closed = await saveLaunchCheckpoint({
      phase: "alt_closed",
      mintAddress,
      expectedStateVersion: checkpoint.stateVersion,
      expectedAltStateVersion: checkpoint.altStateVersion,
      closeSignature: cleanupSignature,
    });
    applyRecoveryState(closed);
    return closed.altStatus === "closed";
  }, [applyRecoveryState, launchResult, recoveryStateVersion, recoveryStatus]);

  const retryLock = useCallback(async (deps: LaunchDeps) => {
    const { publicKey, connection } = deps;
    if (
      recoveryStatus !== "atomic_submitted"
    ) {
      setLaunchStatus("launching");
      setLaunchPhase(-1);
      setErrorMessage(null);
      try {
        const isClosed = await cleanupLookup(deps);
        if (isClosed) {
          setLaunchStatus("idle");
          setLaunchResult(null);
          setRecoveredConfig(null);
          setErrorMessage(null);
          setRecoveryStateVersion(null);
          setRecoveryAltStateVersion(null);
          setRecoveryStatus(null);
          setRecoveryAltStatus(null);
        }
      } catch (error) {
        setLaunchStatus("partial");
        setErrorMessage(error instanceof Error ? error.message : "ALT cleanup failed");
      }
      return;
    }
    const submittedLaunch = launchResult;
    if (!submittedLaunch?.createTxSignature || !submittedLaunch.lockMetadataId) {
      setLaunchStatus("partial");
      setErrorMessage("The atomic launch checkpoint is incomplete. Recheck recovery state.");
      return;
    }
    setLaunchStatus("launching");
    setLaunchPhase(7);
    setErrorMessage(null);
    try {
      const status = await connection.getSignatureStatus(submittedLaunch.createTxSignature, {
        searchTransactionHistory: true,
      });
      if (status.value?.err || !status.value || status.value.confirmationStatus !== "finalized") {
        if (
          status.value?.err || (
            submittedLaunch.lockLastValidBlockHeight !== null &&
            await connection.getBlockHeight("finalized") > submittedLaunch.lockLastValidBlockHeight
          )
        ) {
          if (recoveryStateVersion === null) throw new Error("Recovery version is unavailable");
          const cleanup = await requestCleanup(
            submittedLaunch.mintAddress,
            recoveryStateVersion,
          );
          applyRecoveryState(cleanup);
          throw new Error("Atomic launch failed or expired without creating a token; lookup cleanup is required");
        }
        throw new Error("Atomic launch is not finalized yet");
      }
      const completed = await persistAtomicLaunch(
        publicKey,
        submittedLaunch.mintAddress,
        submittedLaunch.createTxSignature,
        submittedLaunch.lockMetadataId,
      );
      applyRecoveryState(completed);
      setLaunchStatus("success");
      setMetadataDraft(null);
      writeLaunchMetadataDraft(null);
      sessionStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      setLaunchStatus("partial");
      setErrorMessage(`Atomic recovery failed: ${parseTransactionError(
        error instanceof Error ? error.message : String(error),
        (recoveredConfig ?? config).buyAmountSol,
      )}`);
    }
  }, [
    cleanupLookup,
    applyRecoveryState,
    config,
    launchResult,
    recoveredConfig,
    recoveryStateVersion,
    recoveryStatus,
  ]);

  const resetLaunch = useCallback(async () => {
    if (launchResult?.mintAddress && launchStatus === "partial" && recoveryStateVersion !== null) {
      try {
        const cleanup = await requestCleanup(launchResult.mintAddress, recoveryStateVersion);
        applyRecoveryState(cleanup);
        if (cleanup.status !== "abandoned" || cleanup.altStatus !== "closed") {
          setErrorMessage(cleanup.status === "cleanup_required"
            ? "The lookup table must be deactivated and closed with the connected wallet before this launch can be cleared."
            : "The issued transaction must finish reconciliation before this launch can be cleared.");
          return false;
        }
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Atomic cleanup request failed");
        return false;
      }
    }
    setLaunchStatus("idle");
    setLaunchPhase(0);
    setLaunchResult(null);
    setErrorMessage(null);
    setRecoveredConfig(null);
    setRecoveryStateVersion(null);
    setRecoveryAltStateVersion(null);
    setRecoveryStatus(null);
    setRecoveryAltStatus(null);
    setMetadataDraft(null);
    writeLaunchMetadataDraft(null);
    return true;
  }, [applyRecoveryState, launchResult, launchStatus, recoveryStateVersion]);

  return {
    launchStatus,
    launchPhase,
    launchPhases: LAUNCH_PHASES_WITH_LOCK,
    launchResult,
    recoveredConfig,
    errorMessage,
    launch,
    retryLock,
    cleanupLookup,
    recoveryStatus,
    recoveryAltStatus,
    resolvedFee,
    resetLaunch,
  };
}
