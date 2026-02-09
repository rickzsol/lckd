"use client";

import { useState, useCallback, useMemo, useEffect } from "react";
import { type LaunchConfig, TrustTier } from "@/types/index";
import {
  Connection,
  Keypair,
  PublicKey,
  type Transaction,
  type VersionedTransaction,
} from "@solana/web3.js";
import {
  prepareCreateTxForSigning,
  buildLockTransaction,
  sendViaJito,
  createJitoTipInstruction,
} from "@/lib/solana";

const LAMPORTS_PER_SOL = 1_000_000_000;

/**
 * Confirms a transaction using blockhash-based strategy (reliable) with a
 * fallback signature status poll. The deprecated 2-arg confirmTransaction
 * relies on WebSocket which drops silently on many RPC providers.
 */
async function confirmTxReliably(
  connection: Connection,
  signature: string,
  blockhash: string,
  lastValidBlockHeight: number,
): Promise<void> {
  try {
    const result = await connection.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      "confirmed",
    );
    if (result.value.err) {
      throw new Error(`Transaction failed: ${JSON.stringify(result.value.err)}`);
    }
    return;
  } catch (err) {
    // Blockhash-based confirmation can throw if the blockhash expires.
    // Fall back to polling getSignatureStatuses (up to ~60s).
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const statusRes = await connection.getSignatureStatuses([signature]);
      const status = statusRes.value[0];
      if (status) {
        if (status.err) {
          throw new Error(`Transaction failed: ${JSON.stringify(status.err)}`);
        }
        if (
          status.confirmationStatus === "confirmed" ||
          status.confirmationStatus === "finalized"
        ) {
          return;
        }
      }
    }
    throw err;
  }
}

function parseTransactionError(raw: string, buyAmountSol: number): string {
  // Insufficient SOL
  const lamportMatch = raw.match(/insufficient lamports (\d+), need (\d+)/);
  if (lamportMatch) {
    const have = parseInt(lamportMatch[1]) / LAMPORTS_PER_SOL;
    const need = parseInt(lamportMatch[2]) / LAMPORTS_PER_SOL;
    return `Insufficient SOL. You have ${have.toFixed(3)} SOL but need ~${need.toFixed(3)} SOL (${buyAmountSol} SOL buy + fees). Fund your wallet and try again.`;
  }

  // Insufficient token balance (lock overshoot)
  if (raw.includes("insufficient") && raw.includes("token")) {
    return "Insufficient token balance for the lock amount. Try a lower lock percentage.";
  }

  // Streamflow timestamp
  if (raw.includes("timestamps are invalid")) {
    return "Token lock failed due to a timing issue. Please try again.";
  }

  // Token account not found
  if (raw.includes("could not find account") || raw.includes("No tokens found")) {
    return "Token account not found yet. Wait a few seconds for the network to confirm, then retry.";
  }

  // Confirmation timeout
  if (raw.includes("not confirmed in") || raw.includes("unknown if it succeeded")) {
    return "Transaction was sent but confirmation timed out. Check Solscan — it may have succeeded. If not, retry.";
  }

  // Blockhash expired
  if (raw.includes("blockhash") && raw.includes("not found")) {
    return "Transaction expired before it could be confirmed. Please try again.";
  }

  // User rejected
  if (raw.includes("User rejected") || raw.includes("user rejected")) {
    return "Transaction was rejected in your wallet.";
  }

  // Slippage / swap failure
  if (raw.includes("Slippage") || raw.includes("0x1771")) {
    return "Transaction failed due to slippage. Try increasing your buy amount or try again.";
  }

  return raw;
}

export const STEP_LABELS = [
  "Token Details",
  "Lock Config",
  "GitHub",
  "Review & Launch",
] as const;

export const STEP_COUNT = 4;

export const LAUNCH_PHASES_WITH_LOCK = [
  "Uploading metadata to IPFS...",
  "Building create transaction...",
  "Awaiting wallet signature (create)...",
  "Sending token creation...",
  "Confirming token on-chain...",
  "Building token lock...",
  "Awaiting wallet signature (lock)...",
  "Confirming token lock on-chain...",
] as const;

export const LAUNCH_PHASES_NO_LOCK = [
  "Uploading metadata to IPFS...",
  "Building create transaction...",
  "Awaiting wallet signature (create)...",
  "Sending token creation...",
  "Confirming token on-chain...",
] as const;

export type LaunchStatus = "idle" | "launching" | "success" | "error" | "partial";

export interface LaunchResult {
  mintAddress: string;
  createTxSignature: string;
  lockTxSignature: string | null;
}

export interface LaunchDeps {
  publicKey: PublicKey;
  signTransaction: <T extends Transaction | VersionedTransaction>(tx: T) => Promise<T>;
  connection: Connection;
}

const STORAGE_KEY = "lockpad_launch_wizard";

const INITIAL_CONFIG: LaunchConfig = {
  name: "",
  ticker: "",
  description: "",
  image: null,
  imageUri: null,
  buyAmountSol: 1,
  skipLock: false,
  lockDurationDays: 90,
  lockPercentage: 100,
  githubUsername: null,
  githubRepo: null,
  liveUrl: null,
  twitterUrl: null,
  telegramUrl: null,
  websiteUrl: null,
};

function isValidUrl(str: string): boolean {
  try {
    new URL(str);
    return true;
  } catch {
    return false;
  }
}

function loadSavedState(): { config: LaunchConfig; step: number } {
  try {
    if (typeof window === "undefined") return { config: INITIAL_CONFIG, step: 1 };
    const saved = sessionStorage.getItem(STORAGE_KEY);
    if (!saved) return { config: INITIAL_CONFIG, step: 1 };
    const parsed = JSON.parse(saved);
    return {
      config: parsed.config
        ? { ...INITIAL_CONFIG, ...parsed.config, image: null }
        : INITIAL_CONFIG,
      step: parsed.step ?? 1,
    };
  } catch {
    return { config: INITIAL_CONFIG, step: 1 };
  }
}

export function useLaunchWizard() {
  const [step, setStep] = useState(() => loadSavedState().step);
  const [config, setConfig] = useState<LaunchConfig>(() => loadSavedState().config);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [launchStatus, setLaunchStatus] = useState<LaunchStatus>("idle");
  const [launchPhase, setLaunchPhase] = useState(0);
  const [launchResult, setLaunchResult] = useState<LaunchResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Internal refs for retry — stored in state to survive re-renders
  const [pendingMintAddress, setPendingMintAddress] = useState<string | null>(null);
  const [pendingMetadataUri, setPendingMetadataUri] = useState<string | null>(null);

  // Persist state to sessionStorage on change
  useEffect(() => {
    const serializable = { ...config, image: undefined };
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ config: serializable, step }),
    );
  }, [config, step]);

  const updateConfig = useCallback(
    <K extends keyof LaunchConfig>(key: K, value: LaunchConfig[K]) => {
      setConfig((prev) => ({ ...prev, [key]: value }));
      setErrors((prev) => {
        if (!prev[key]) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      });
    },
    [],
  );

  const handleImageUpload = useCallback((file: File) => {
    const MAX_SIZE = 5 * 1024 * 1024;
    const ALLOWED = ["image/png", "image/jpeg", "image/gif", "image/webp"];

    if (!ALLOWED.includes(file.type)) {
      setErrors((p) => ({ ...p, image: "Only PNG, JPG, GIF, WebP allowed" }));
      return;
    }
    if (file.size > MAX_SIZE) {
      setErrors((p) => ({ ...p, image: "Image must be under 5MB" }));
      return;
    }

    setConfig((prev) => ({ ...prev, image: file }));
    setErrors((p) => {
      const n = { ...p };
      delete n.image;
      return n;
    });

    const reader = new FileReader();
    reader.onload = (e) => setImagePreview(e.target?.result as string);
    reader.readAsDataURL(file);
  }, []);

  const removeImage = useCallback(() => {
    setConfig((prev) => ({ ...prev, image: null, imageUri: null }));
    setImagePreview(null);
  }, []);

  // --- Validation ---
  const validateStep1 = useCallback((): boolean => {
    const errs: Record<string, string> = {};
    const name = config.name.trim();
    if (!name) errs.name = "Token name is required";
    else if (name.length < 2) errs.name = "Min 2 characters";
    else if (name.length > 32) errs.name = "Max 32 characters";

    const ticker = config.ticker.trim();
    if (!ticker) errs.ticker = "Ticker is required";
    else if (ticker.length < 2) errs.ticker = "Min 2 characters";
    else if (ticker.length > 10) errs.ticker = "Max 10 characters";

    if (!config.image) errs.image = "Token image is required";

    const desc = config.description.trim();
    if (!desc) errs.description = "Description is required";
    else if (desc.length > 500) errs.description = "Max 500 characters";

    if (config.twitterUrl && !isValidUrl(config.twitterUrl))
      errs.twitterUrl = "Enter a valid URL";
    if (config.telegramUrl && !isValidUrl(config.telegramUrl))
      errs.telegramUrl = "Enter a valid URL";
    if (config.websiteUrl && !isValidUrl(config.websiteUrl))
      errs.websiteUrl = "Enter a valid URL";

    setErrors(errs);
    return Object.keys(errs).length === 0;
  }, [config]);

  const validateStep2 = useCallback((): boolean => {
    const errs: Record<string, string> = {};
    if (config.buyAmountSol < 0.1)
      errs.buyAmountSol = "Minimum buy is 0.1 SOL";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }, [config.buyAmountSol]);

  // --- Navigation ---
  const goNext = useCallback(() => {
    if (step === 1 && !validateStep1()) return;
    if (step === 2 && !validateStep2()) return;
    if (step < STEP_COUNT) {
      setErrors({});
      setStep((s) => s + 1);
    }
  }, [step, validateStep1, validateStep2]);

  const goBack = useCallback(() => {
    if (step > 1) {
      setErrors({});
      setStep((s) => s - 1);
    }
  }, [step]);

  const goToStep = useCallback(
    (target: number) => {
      if (target < 1 || target > STEP_COUNT) return;
      if (target <= step) {
        setErrors({});
        setStep(target);
        return;
      }
      if (step <= 1 && target > 1 && !validateStep1()) return;
      if (step <= 2 && target > 2 && !validateStep2()) return;
      setErrors({});
      setStep(target);
    },
    [step, validateStep1, validateStep2],
  );

  // --- Trust tier ---
  const computedTier = useMemo((): TrustTier => {
    if (!config.githubUsername) return TrustTier.LOCKED;
    if (config.githubRepo && config.liveUrl) return TrustTier.SHIPPED;
    if (config.githubRepo) return TrustTier.BUILDER;
    return TrustTier.VERIFIED;
  }, [config.githubUsername, config.githubRepo, config.liveUrl]);

  const tierLabel = useMemo(() => {
    const map: Record<TrustTier, string> = {
      [TrustTier.LOCKED]: "LOCKED",
      [TrustTier.VERIFIED]: "VERIFIED",
      [TrustTier.BUILDER]: "BUILDER",
      [TrustTier.SHIPPED]: "SHIPPED",
    };
    return map[computedTier];
  }, [computedTier]);

  // --- Real launch ---
  const launch = useCallback(async (deps: LaunchDeps) => {
    const { publicKey, signTransaction, connection } = deps;

    setLaunchStatus("launching");
    setLaunchPhase(0);
    setErrorMessage(null);

    let isCreateConfirmed = false;
    let confirmedCreateSig = "";
    let confirmedMintAddress = "";

    try {
      // Phase 0: Upload metadata to IPFS (via server proxy)
      const metadataForm = new FormData();
      metadataForm.append("file", config.image!);
      metadataForm.append("name", config.name);
      metadataForm.append("symbol", config.ticker);
      metadataForm.append("description", config.description);
      if (config.twitterUrl) metadataForm.append("twitter", config.twitterUrl);
      if (config.telegramUrl) metadataForm.append("telegram", config.telegramUrl);
      if (config.websiteUrl) metadataForm.append("website", config.websiteUrl);

      const metaRes = await fetch("/api/v1/metadata/upload", {
        method: "POST",
        body: metadataForm,
      });
      if (!metaRes.ok) {
        const err = await metaRes.json().catch(() => ({ error: "Metadata upload failed" }));
        throw new Error(err.error ?? "Metadata upload failed");
      }
      const { metadataUri } = await metaRes.json();
      setPendingMetadataUri(metadataUri);

      // Resolve the actual image URL from the metadata JSON
      let resolvedImageUri = metadataUri;
      try {
        const metaJson = await fetch(metadataUri).then((r) => r.json());
        if (metaJson?.image) resolvedImageUri = metaJson.image;
      } catch {
        // Fall back to metadata URI if fetch fails
      }

      // Phase 1: Build create + buy transaction (via server proxy)
      setLaunchPhase(1);
      const launchRes = await fetch("/api/v1/launch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletPublicKey: publicKey.toBase58(),
          metadataUri,
          name: config.name,
          ticker: config.ticker,
          description: config.description,
          buyAmountSol: config.buyAmountSol,
          skipLock: config.skipLock,
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
      if (!launchRes.ok) {
        const err = await launchRes.json().catch(() => ({ error: "Build transaction failed" }));
        throw new Error(err.error ?? "Build transaction failed");
      }
      const { transaction: txBase64, mintPublicKey, mintSecretKey } = await launchRes.json();
      const txBytes = Uint8Array.from(atob(txBase64), (c) => c.charCodeAt(0));
      const mintKeypair = Keypair.fromSecretKey(Uint8Array.from(atob(mintSecretKey), (c) => c.charCodeAt(0)));
      confirmedMintAddress = mintPublicKey;
      setPendingMintAddress(confirmedMintAddress);

      // Phase 2: Sign create transaction
      setLaunchPhase(2);
      let createTx = prepareCreateTxForSigning(txBytes, mintKeypair);
      createTx = await signTransaction(createTx);

      // Phase 3: Send create transaction via RPC (+ Jito fire-and-forget for speed)
      setLaunchPhase(3);
      const createBlockhash = await connection.getLatestBlockhash("confirmed");
      const serializedCreate = createTx.serialize();
      // Send via regular RPC for guaranteed propagation to all validators.
      // The PumpPortal VersionedTx already has priority fees but no Jito tip,
      // so bundleOnly submission is unreliable. RPC is the primary path.
      confirmedCreateSig = await connection.sendRawTransaction(
        serializedCreate,
        { skipPreflight: false, maxRetries: 3 },
      );
      // Also fire via Jito for faster landing (fire-and-forget, don't block)
      sendViaJito(serializedCreate).catch(() => {});

      // Phase 4: Wait for create tx to actually confirm on-chain
      setLaunchPhase(4);
      await confirmTxReliably(
        connection,
        confirmedCreateSig,
        createBlockhash.blockhash,
        createBlockhash.lastValidBlockHeight,
      );
      isCreateConfirmed = true;

      let lockSig: string | null = null;

      if (!config.skipLock) {
        // Phase 5: Build lock transaction (polls for token balance)
        setLaunchPhase(5);
        const { transaction: lockTx, additionalSigners } = await buildLockTransaction(
          config,
          publicKey,
          mintKeypair.publicKey,
          connection,
        );

        // Add Jito tip to the lock transaction for faster landing
        lockTx.add(createJitoTipInstruction(publicKey));

        // Phase 6: Sign lock transaction
        setLaunchPhase(6);
        const walletSignedLockTx = await signTransaction(lockTx);
        for (const signer of additionalSigners) {
          walletSignedLockTx.partialSign(signer);
        }

        // Store partial result in case lock send fails
        setLaunchResult({
          mintAddress: confirmedMintAddress,
          createTxSignature: confirmedCreateSig,
          lockTxSignature: null,
        });

        // Phase 7: Send + confirm lock transaction (Jito with RPC fallback)
        setLaunchPhase(7);
        const lockBlockhash = await connection.getLatestBlockhash("confirmed");
        const serializedLock = walletSignedLockTx.serialize();
        const jitoLockResult = await sendViaJito(serializedLock);
        if (jitoLockResult) {
          lockSig = jitoLockResult.signature;
        } else {
          lockSig = await connection.sendRawTransaction(
            serializedLock,
            { skipPreflight: true, maxRetries: 5 },
          );
        }
        await confirmTxReliably(
          connection,
          lockSig,
          lockBlockhash.blockhash,
          lockBlockhash.lastValidBlockHeight,
        );
      }

      // Record to Supabase after both TXs confirmed
      setLaunchResult({
        mintAddress: confirmedMintAddress,
        createTxSignature: confirmedCreateSig,
        lockTxSignature: lockSig,
      });

      await fetch("/api/v1/token/record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mintAddress: confirmedMintAddress,
          name: config.name,
          ticker: config.ticker,
          description: config.description,
          imageUri: resolvedImageUri,
          creatorWallet: publicKey.toBase58(),
          launchTxSignature: confirmedCreateSig,
          lockTxSignature: lockSig ?? "",
          lockDurationDays: config.skipLock ? 0 : config.lockDurationDays,
          lockPercentage: config.skipLock ? 0 : config.lockPercentage,
          lockAmount: "0",
          buyAmountSol: config.buyAmountSol,
          githubUsername: config.githubUsername,
          githubRepo: config.githubRepo,
          liveUrl: config.liveUrl,
          twitterUrl: config.twitterUrl,
          telegramUrl: config.telegramUrl,
          websiteUrl: config.websiteUrl,
        }),
      });

      setLaunchStatus("success");
      sessionStorage.removeItem(STORAGE_KEY);
    } catch (err) {
      const raw = err instanceof Error ? err.message : "Unknown error occurred";
      const message = parseTransactionError(raw, config.buyAmountSol);

      if (isCreateConfirmed && !config.skipLock) {
        setLaunchStatus("partial");
        setErrorMessage(`Token created but lock failed: ${message}`);
      } else if (isCreateConfirmed && config.skipLock) {
        setLaunchStatus("success");
        sessionStorage.removeItem(STORAGE_KEY);
      } else {
        setLaunchStatus("error");
        setErrorMessage(message);
      }
    }
  }, [config]);

  // --- Retry lock (after partial success) ---
  const retryLock = useCallback(async (deps: LaunchDeps) => {
    if (!pendingMintAddress || !launchResult?.createTxSignature) return;

    const { publicKey, signTransaction, connection } = deps;

    setLaunchStatus("launching");
    setLaunchPhase(5); // Building lock
    setErrorMessage(null);

    try {
      const mintPubkey = new PublicKey(pendingMintAddress);

      const { transaction: lockTx, additionalSigners } = await buildLockTransaction(
        config,
        publicKey,
        mintPubkey,
        connection,
      );

      // Add Jito tip for faster landing
      lockTx.add(createJitoTipInstruction(publicKey));

      setLaunchPhase(6); // Signing lock
      const walletSignedLockTx = await signTransaction(lockTx);
      for (const signer of additionalSigners) {
        walletSignedLockTx.partialSign(signer);
      }

      setLaunchPhase(7); // Confirming lock
      const retryBlockhash = await connection.getLatestBlockhash("confirmed");
      const serializedRetryLock = walletSignedLockTx.serialize();
      const jitoRetryResult = await sendViaJito(serializedRetryLock);
      let lockSig: string;
      if (jitoRetryResult) {
        lockSig = jitoRetryResult.signature;
      } else {
        lockSig = await connection.sendRawTransaction(
          serializedRetryLock,
          { skipPreflight: true, maxRetries: 5 },
        );
      }
      await confirmTxReliably(
        connection,
        lockSig,
        retryBlockhash.blockhash,
        retryBlockhash.lastValidBlockHeight,
      );

      await fetch("/api/v1/token/record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mintAddress: pendingMintAddress,
          name: config.name,
          ticker: config.ticker,
          description: config.description,
          imageUri: pendingMetadataUri ?? "",
          creatorWallet: publicKey.toBase58(),
          launchTxSignature: launchResult.createTxSignature,
          lockTxSignature: lockSig,
          lockDurationDays: config.lockDurationDays,
          lockPercentage: config.lockPercentage,
          lockAmount: "0",
          buyAmountSol: config.buyAmountSol,
          githubUsername: config.githubUsername,
          githubRepo: config.githubRepo,
          liveUrl: config.liveUrl,
          twitterUrl: config.twitterUrl,
          telegramUrl: config.telegramUrl,
          websiteUrl: config.websiteUrl,
        }),
      });

      setLaunchResult((prev) => prev ? { ...prev, lockTxSignature: lockSig } : null);
      setLaunchStatus("success");
      sessionStorage.removeItem(STORAGE_KEY);
    } catch (err) {
      const raw = err instanceof Error ? err.message : "Unknown error occurred";
      const message = parseTransactionError(raw, config.buyAmountSol);
      setLaunchStatus("partial");
      setErrorMessage(`Lock retry failed: ${message}`);
    }
  }, [config, pendingMintAddress, pendingMetadataUri, launchResult]);

  const reset = useCallback(() => {
    setStep(1);
    setConfig(INITIAL_CONFIG);
    setImagePreview(null);
    setErrors({});
    setLaunchStatus("idle");
    setLaunchPhase(0);
    setLaunchResult(null);
    setErrorMessage(null);
    setPendingMintAddress(null);
    setPendingMetadataUri(null);
    sessionStorage.removeItem(STORAGE_KEY);
  }, []);

  const launchPhases = config.skipLock
    ? LAUNCH_PHASES_NO_LOCK
    : LAUNCH_PHASES_WITH_LOCK;

  return {
    step,
    config,
    imagePreview,
    errors,
    launchStatus,
    launchPhase,
    launchPhases,
    launchResult,
    errorMessage,
    computedTier,
    tierLabel,
    updateConfig,
    handleImageUpload,
    removeImage,
    goNext,
    goBack,
    goToStep,
    launch,
    retryLock,
    reset,
  };
}

export type WizardContext = ReturnType<typeof useLaunchWizard>;
