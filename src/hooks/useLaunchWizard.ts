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
  estimateTokensFromSol,
  calculateLockAmount,
} from "@/lib/solana";

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
  "Confirming token creation on-chain...",
  "Awaiting wallet signature (lock)...",
  "Confirming vesting lock on-chain...",
] as const;

export const LAUNCH_PHASES_NO_LOCK = [
  "Uploading metadata to IPFS...",
  "Building create transaction...",
  "Awaiting wallet signature (create)...",
  "Confirming token creation on-chain...",
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

const STORAGE_KEY = "trudev_launch_wizard";

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

      // Phase 3: Send + confirm create transaction
      setLaunchPhase(3);
      confirmedCreateSig = await connection.sendRawTransaction(
        createTx.serialize(),
        { skipPreflight: false, maxRetries: 3 },
      );
      await connection.confirmTransaction(confirmedCreateSig, "confirmed");
      isCreateConfirmed = true;

      // Store partial result in case lock fails
      setLaunchResult({
        mintAddress: confirmedMintAddress,
        createTxSignature: confirmedCreateSig,
        lockTxSignature: null,
      });

      let lockSig: string | null = null;

      if (!config.skipLock) {
        // Phase 4: Build + sign lock transaction
        setLaunchPhase(4);
        const { transaction: lockTx } = await buildLockTransaction(
          config,
          publicKey,
          mintKeypair.publicKey,
          connection,
        );
        const signedLockTx = await signTransaction(lockTx);

        // Phase 5: Send + confirm lock transaction
        setLaunchPhase(5);
        lockSig = await connection.sendRawTransaction(
          signedLockTx.serialize(),
          { skipPreflight: false, maxRetries: 3 },
        );
        await connection.confirmTransaction(lockSig, "confirmed");
      }

      // Record to Supabase (via server route with service role key)
      const estimatedTokens = estimateTokensFromSol(config.buyAmountSol);
      const lockAmount = config.skipLock
        ? 0
        : calculateLockAmount(estimatedTokens, config.lockPercentage);

      const recordRes = await fetch("/api/v1/token/record", {
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
          lockAmount: lockAmount.toString(),
          buyAmountSol: config.buyAmountSol,
          githubUsername: config.githubUsername,
          githubRepo: config.githubRepo,
          liveUrl: config.liveUrl,
          twitterUrl: config.twitterUrl,
          telegramUrl: config.telegramUrl,
          websiteUrl: config.websiteUrl,
        }),
      });
      if (!recordRes.ok) {
        console.warn("Failed to record launch to database — token page may not load immediately");
      }

      setLaunchResult({
        mintAddress: confirmedMintAddress,
        createTxSignature: confirmedCreateSig,
        lockTxSignature: lockSig,
      });
      setLaunchStatus("success");
      sessionStorage.removeItem(STORAGE_KEY);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error occurred";

      if (isCreateConfirmed && !config.skipLock) {
        setLaunchStatus("partial");
        setErrorMessage(`Token created but lock failed: ${message}`);
      } else if (isCreateConfirmed && config.skipLock) {
        // Create succeeded and no lock was needed — treat as success
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
    setLaunchPhase(4);
    setErrorMessage(null);

    try {
      const mintPubkey = new PublicKey(pendingMintAddress);

      const { transaction: lockTx } = await buildLockTransaction(
        config,
        publicKey,
        mintPubkey,
        connection,
      );
      const signedLockTx = await signTransaction(lockTx);

      setLaunchPhase(5);
      const lockSig = await connection.sendRawTransaction(
        signedLockTx.serialize(),
        { skipPreflight: false, maxRetries: 3 },
      );
      await connection.confirmTransaction(lockSig, "confirmed");

      const estimatedTokens = estimateTokensFromSol(config.buyAmountSol);
      const lockAmount = calculateLockAmount(estimatedTokens, config.lockPercentage);

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
          lockAmount: lockAmount.toString(),
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
      const message = err instanceof Error ? err.message : "Unknown error occurred";
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
