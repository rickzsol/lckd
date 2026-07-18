"use client";

import { useCallback, useEffect, useState } from "react";
import type { LaunchConfig } from "@/types/index";
import {
  Connection,
  Keypair,
  PublicKey,
  type Transaction,
  type VersionedTransaction,
} from "@solana/web3.js";
import BN from "bn.js";
import bs58 from "bs58";
import {
  buildLockTransaction,
  confirmTxReliably,
  CREATE_TX_SOL_OVERHEAD,
  LOCK_TX_SOL_OVERHEAD,
  parseTransactionError,
  prepareCreateTxForSigning,
  simulateLegacyTransactionOrThrow,
  simulateVersionedTransactionOrThrow,
  verifyStreamflowLock,
} from "@/lib/solana";

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

interface PersistLaunchInput {
  config: LaunchConfig;
  publicKey: PublicKey;
  mintAddress: string;
  imageUri: string;
  createTxSignature: string;
  lockTxSignature: string;
  lockAmount: string;
}

type RecoveredLaunchConfig = Omit<LaunchConfig, "image">;

async function saveLaunchCheckpoint(body: Record<string, unknown>): Promise<void> {
  const response = await fetch("/api/v1/launch/recovery", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await responseError(response, "Launch recovery checkpoint failed");
}

export const LAUNCH_PHASES_WITH_LOCK = [
  "Uploading metadata to IPFS...",
  "Building transactions...",
  "Awaiting wallet signature (create)...",
  "Simulating and sending token creation...",
  "Confirming token on-chain...",
  "Preparing token lock...",
  "Awaiting wallet signature (lock)...",
  "Simulating, confirming, and verifying token lock...",
] as const;

async function responseError(response: Response, fallback: string): Promise<Error> {
  const body = await response.json().catch(() => null);
  return new Error(
    body && typeof body.error === "string" ? body.error : fallback,
  );
}

async function persistLaunch(input: PersistLaunchInput): Promise<void> {
  const { config } = input;
  const response = await fetch("/api/v1/token/record", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      mintAddress: input.mintAddress,
      name: config.name,
      ticker: config.ticker,
      description: config.description,
      imageUri: input.imageUri,
      creatorWallet: input.publicKey.toBase58(),
      launchTxSignature: input.createTxSignature,
      lockTxSignature: input.lockTxSignature,
      lockDurationDays: config.lockDurationDays,
      lockPercentage: config.lockPercentage,
      lockAmount: input.lockAmount,
      buyAmountSol: config.buyAmountSol,
      githubUsername: config.githubUsername,
      githubRepo: config.githubRepo,
      liveUrl: config.liveUrl,
      twitterUrl: config.twitterUrl,
      telegramUrl: config.telegramUrl,
      websiteUrl: config.websiteUrl,
    }),
  });
  if (!response.ok) throw await responseError(response, "Launch record failed");
}

export function useTokenLaunch(config: LaunchConfig) {
  const [launchStatus, setLaunchStatus] = useState<LaunchStatus>("idle");
  const [launchPhase, setLaunchPhase] = useState(0);
  const [launchResult, setLaunchResult] = useState<LaunchResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingImageUri, setPendingImageUri] = useState<string | null>(null);
  const [pendingSignedLockTransaction, setPendingSignedLockTransaction] =
    useState<Uint8Array | null>(null);
  const [recoveredConfig, setRecoveredConfig] =
    useState<RecoveredLaunchConfig | null>(null);
  const [isRecoveredLockReady, setIsRecoveredLockReady] = useState(true);

  useEffect(() => {
    let isCancelled = false;
    void fetch("/api/v1/launch/recovery", { cache: "no-store" })
      .then(async (response) => {
        if (response.status === 401 || response.status === 403) return null;
        if (!response.ok) throw await responseError(response, "Launch recovery is unavailable");
        return response.json();
      })
      .then((body) => {
        const intent = body?.intent;
        const result = intent?.launchResult;
        if (
          isCancelled ||
          !intent ||
          typeof intent.imageUri !== "string" ||
          !intent.config ||
          typeof result?.mintAddress !== "string" ||
          typeof result?.createTxSignature !== "string"
        ) return;

        setRecoveredConfig({ ...intent.config, imageUri: intent.imageUri });
        setPendingImageUri(intent.imageUri);
        setLaunchResult(result as LaunchResult);
        setIsRecoveredLockReady(intent.canRetryLock === true);
        setLaunchStatus("partial");
        setErrorMessage(
          intent.canRetryLock
            ? "Recovered a finalized token creation that still requires its mandatory lock."
            : "Recovered a submitted token creation. Wait for finalization before retrying the lock.",
        );
      })
      .catch((error) => {
        if (!isCancelled) console.error("[launch/recovery] Restore failed:", error);
      });
    return () => { isCancelled = true; };
  }, []);

  const launch = useCallback(async (deps: LaunchDeps) => {
    const { publicKey, signTransaction, connection } = deps;
    setLaunchStatus("launching");
    setLaunchPhase(0);
    setErrorMessage(null);

    let isCreateConfirmed = false;
    let isLockVerified = false;
    let createTxSignature = "";
    let lockTxSignature = "";
    let mintAddress = "";
    let imageUri = "";
    let lockAmount = "";
    let lockMetadataId = "";
    let unlockTimestamp: number | null = null;

    try {
      const walletSol = (await connection.getBalance(publicKey)) / LAMPORTS_PER_SOL;
      const requiredSol =
        config.buyAmountSol + CREATE_TX_SOL_OVERHEAD + LOCK_TX_SOL_OVERHEAD;
      if (walletSol < requiredSol) {
        throw new Error(
          `Insufficient SOL. You have ${walletSol.toFixed(4)} SOL but need ~${requiredSol.toFixed(4)} SOL including the buy, Streamflow creation fee, rent, and network fees.`,
        );
      }
      if (!config.image) throw new Error("Token image is required");

      const metadataForm = new FormData();
      metadataForm.append("file", config.image);
      metadataForm.append("name", config.name);
      metadataForm.append("symbol", config.ticker);
      metadataForm.append("description", config.description);
      if (config.twitterUrl) metadataForm.append("twitter", config.twitterUrl);
      if (config.telegramUrl) metadataForm.append("telegram", config.telegramUrl);
      if (config.websiteUrl) metadataForm.append("website", config.websiteUrl);

      const metadataResponse = await fetch("/api/v1/metadata/upload", {
        method: "POST",
        body: metadataForm,
      });
      if (!metadataResponse.ok) {
        throw await responseError(metadataResponse, "Metadata upload failed");
      }
      const metadata = await metadataResponse.json();
      if (typeof metadata.metadataUri !== "string" || typeof metadata.imageUri !== "string") {
        throw new Error("Metadata upload returned an invalid response");
      }
      imageUri = metadata.imageUri;
      setPendingImageUri(imageUri);

      setLaunchPhase(1);
      const mintKeypair = Keypair.generate();
      mintAddress = mintKeypair.publicKey.toBase58();
      const launchResponse = await fetch("/api/v1/launch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletPublicKey: publicKey.toBase58(),
          mintPublicKey: mintAddress,
          metadataUri: metadata.metadataUri,
          imageUri,
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
      if (!launchResponse.ok) {
        throw await responseError(launchResponse, "Build transaction failed");
      }
      const launchBody = await launchResponse.json();
      if (typeof launchBody.transaction !== "string") {
        throw new Error("Launch API returned an invalid transaction");
      }
      const txBytes = Uint8Array.from(atob(launchBody.transaction), (value) =>
        value.charCodeAt(0),
      );

      setLaunchPhase(2);
      const createBlockhash = await connection.getLatestBlockhash("confirmed");
      let createTransaction = prepareCreateTxForSigning(
        txBytes,
        publicKey,
        mintKeypair,
        createBlockhash.blockhash,
        config,
        metadata.metadataUri,
      );
      createTransaction = await signTransaction(createTransaction);
      await simulateVersionedTransactionOrThrow(
        connection,
        createTransaction,
        "Token creation",
        {
          wallet: publicKey,
          maxLamports: Math.ceil(
            (config.buyAmountSol + CREATE_TX_SOL_OVERHEAD) * LAMPORTS_PER_SOL,
          ),
        },
      );

      setLaunchPhase(3);
      const createSignatureBytes = createTransaction.signatures[0];
      if (!createSignatureBytes) throw new Error("Wallet did not sign the creation transaction");
      createTxSignature = bs58.encode(createSignatureBytes);
      await saveLaunchCheckpoint({
        phase: "create_submitted",
        mintAddress,
        createTxSignature,
        createBlockhash: createBlockhash.blockhash,
        createLastValidBlockHeight: createBlockhash.lastValidBlockHeight,
      });
      const submittedCreateSignature = await connection.sendRawTransaction(
        createTransaction.serialize(),
        { skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 3 },
      );
      if (submittedCreateSignature !== createTxSignature) {
        throw new Error("RPC returned an unexpected creation transaction signature");
      }
      setLaunchResult({
        mintAddress,
        createTxSignature,
        lockTxSignature: null,
        lockMetadataId: null,
        lockAmount: "",
        unlockTimestamp: null,
        lockBlockhash: null,
        lockLastValidBlockHeight: null,
      });
      setLaunchPhase(4);
      await confirmTxReliably(
        connection,
        createTxSignature,
        createBlockhash.blockhash,
        createBlockhash.lastValidBlockHeight,
      );
      await saveLaunchCheckpoint({
        phase: "create_finalized",
        mintAddress,
        createTxSignature,
      });
      isCreateConfirmed = true;
      setIsRecoveredLockReady(true);
      setLaunchResult({
        mintAddress,
        createTxSignature,
        lockTxSignature: null,
        lockMetadataId: null,
        lockAmount: "",
        unlockTimestamp: null,
        lockBlockhash: null,
        lockLastValidBlockHeight: null,
      });

      setLaunchPhase(5);
      const postCreateSol = (await connection.getBalance(publicKey)) / LAMPORTS_PER_SOL;
      if (postCreateSol < LOCK_TX_SOL_OVERHEAD) {
        throw new Error(
          `Insufficient SOL for Streamflow. You have ${postCreateSol.toFixed(4)} SOL but need ~${LOCK_TX_SOL_OVERHEAD} SOL for its creation fee, rent, and network fees.`,
        );
      }
      const lockBundle = await buildLockTransaction(
        config,
        publicKey,
        mintKeypair.publicKey,
        connection,
      );
      lockAmount = lockBundle.lockAmount;
      lockMetadataId = lockBundle.metadataId;
      unlockTimestamp = lockBundle.unlockTimestamp;

      setLaunchPhase(6);
      for (const signer of lockBundle.additionalSigners) {
        lockBundle.transaction.partialSign(signer);
      }
      const signedLockTransaction = await signTransaction(lockBundle.transaction);
      await simulateLegacyTransactionOrThrow(
        connection,
        signedLockTransaction,
        "Token lock",
      );

      setLaunchPhase(7);
      if (!signedLockTransaction.signature) {
        throw new Error("Wallet did not sign the lock transaction");
      }
      const serializedLockTransaction = signedLockTransaction.serialize();
      lockTxSignature = bs58.encode(signedLockTransaction.signature);
      setPendingSignedLockTransaction(serializedLockTransaction);
      const submittedLockResult: LaunchResult = {
        mintAddress,
        createTxSignature,
        lockTxSignature,
        lockMetadataId,
        lockAmount,
        unlockTimestamp,
        lockBlockhash: lockBundle.blockhash,
        lockLastValidBlockHeight: lockBundle.lastValidBlockHeight,
      };
      setLaunchResult(submittedLockResult);
      await saveLaunchCheckpoint({
        phase: "lock_submitted",
        mintAddress,
        lockTxSignature,
        lockMetadataId,
        lockAmount,
        unlockTimestamp,
        lockBlockhash: lockBundle.blockhash,
        lockLastValidBlockHeight: lockBundle.lastValidBlockHeight,
      });
      const submittedSignature = await connection.sendRawTransaction(
        serializedLockTransaction,
        { skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 5 },
      );
      if (submittedSignature !== lockTxSignature) {
        throw new Error("RPC returned an unexpected lock transaction signature");
      }
      await confirmTxReliably(
        connection,
        lockTxSignature,
        lockBundle.blockhash,
        lockBundle.lastValidBlockHeight,
        "finalized",
      );
      await verifyStreamflowLock({
        connection,
        metadataId: lockMetadataId,
        sender: publicKey,
        mint: mintKeypair.publicKey,
        amount: new BN(lockAmount),
        unlockTimestamp: lockBundle.unlockTimestamp,
      });
      isLockVerified = true;

      await persistLaunch({
        config,
        publicKey,
        mintAddress,
        imageUri,
        createTxSignature,
        lockTxSignature,
        lockAmount,
      });

      setLaunchStatus("success");
      setPendingSignedLockTransaction(null);
      sessionStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      console.error("[launch] Error:", error);
      const raw = error instanceof Error ? error.message : String(error);
      const message = parseTransactionError(raw, config.buyAmountSol);

      if (isLockVerified) {
        setLaunchStatus("partial");
        setErrorMessage(`Token and lock are confirmed, but saving failed: ${message}`);
      } else if (isCreateConfirmed || createTxSignature) {
        setLaunchStatus("partial");
        setErrorMessage(
          lockTxSignature
            ? `Lock submitted but confirmation is incomplete: ${message}`
            : `Token submitted but the lock is incomplete: ${message}`,
        );
      } else {
        setLaunchStatus("error");
        setErrorMessage(message);
      }
    }
  }, [config]);

  const retryLock = useCallback(async (deps: LaunchDeps) => {
    if (!launchResult?.createTxSignature || !pendingImageUri) return;
    const { publicKey, signTransaction, connection } = deps;
    setLaunchStatus("launching");
    setLaunchPhase(5);
    setErrorMessage(null);

    if (!isRecoveredLockReady) {
      setLaunchStatus("partial");
      setErrorMessage("Token creation is not finalized yet. Check its receipt and retry shortly.");
      return;
    }

    try {
      if (launchResult.lockTxSignature) {
        if (
          !launchResult.lockMetadataId ||
          !launchResult.lockAmount ||
          launchResult.unlockTimestamp === null ||
          !launchResult.lockBlockhash ||
          launchResult.lockLastValidBlockHeight === null
        ) {
          throw new Error("Submitted lock state is incomplete");
        }
        const status = await connection.getSignatureStatus(
          launchResult.lockTxSignature,
          { searchTransactionHistory: true },
        );
        const hasExpired =
          (await connection.getBlockHeight("confirmed")) >
          launchResult.lockLastValidBlockHeight;
        if (!status.value && hasExpired) {
          const metadataAccount = await connection.getAccountInfo(
            new PublicKey(launchResult.lockMetadataId),
            "finalized",
          );
          if (metadataAccount) {
            await verifyStreamflowLock({
              connection,
              metadataId: launchResult.lockMetadataId,
              sender: publicKey,
              mint: new PublicKey(launchResult.mintAddress),
              amount: new BN(launchResult.lockAmount),
              unlockTimestamp: launchResult.unlockTimestamp,
            });
            await persistLaunch({
              config,
              publicKey,
              mintAddress: launchResult.mintAddress,
              imageUri: pendingImageUri,
              createTxSignature: launchResult.createTxSignature,
              lockTxSignature: launchResult.lockTxSignature,
              lockAmount: launchResult.lockAmount,
            });
            setLaunchStatus("success");
            setPendingSignedLockTransaction(null);
            sessionStorage.removeItem(STORAGE_KEY);
            return;
          }
        }
        if (status.value?.err || (!status.value && hasExpired)) {
          setLaunchResult({
            ...launchResult,
            lockTxSignature: null,
            lockMetadataId: null,
            lockAmount: "",
            unlockTimestamp: null,
            lockBlockhash: null,
            lockLastValidBlockHeight: null,
          });
          setPendingSignedLockTransaction(null);
          throw new Error(
            "The previous lock transaction did not land. Retry once more to build a fresh lock.",
          );
        }
        if (pendingSignedLockTransaction && !status.value) {
          const rebroadcastSignature = await connection.sendRawTransaction(
            pendingSignedLockTransaction,
            { skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 5 },
          );
          if (rebroadcastSignature !== launchResult.lockTxSignature) {
            throw new Error("RPC returned an unexpected lock transaction signature");
          }
        }
        await confirmTxReliably(
          connection,
          launchResult.lockTxSignature,
          launchResult.lockBlockhash,
          launchResult.lockLastValidBlockHeight,
          "finalized",
        );
        await verifyStreamflowLock({
          connection,
          metadataId: launchResult.lockMetadataId,
          sender: publicKey,
          mint: new PublicKey(launchResult.mintAddress),
          amount: new BN(launchResult.lockAmount),
          unlockTimestamp: launchResult.unlockTimestamp,
        });
        await persistLaunch({
          config,
          publicKey,
          mintAddress: launchResult.mintAddress,
          imageUri: pendingImageUri,
          createTxSignature: launchResult.createTxSignature,
          lockTxSignature: launchResult.lockTxSignature,
          lockAmount: launchResult.lockAmount,
        });
      } else {
        const mint = new PublicKey(launchResult.mintAddress);
        const lockBundle = await buildLockTransaction(config, publicKey, mint, connection);
        setLaunchPhase(6);
        for (const signer of lockBundle.additionalSigners) {
          lockBundle.transaction.partialSign(signer);
        }
        const signedLockTransaction = await signTransaction(lockBundle.transaction);
        await simulateLegacyTransactionOrThrow(
          connection,
          signedLockTransaction,
          "Token lock retry",
        );

        setLaunchPhase(7);
        if (!signedLockTransaction.signature) {
          throw new Error("Wallet did not sign the lock transaction");
        }
        const serializedLockTransaction = signedLockTransaction.serialize();
        const lockTxSignature = bs58.encode(signedLockTransaction.signature);
        setPendingSignedLockTransaction(serializedLockTransaction);
        const result: LaunchResult = {
          ...launchResult,
          lockTxSignature,
          lockMetadataId: lockBundle.metadataId,
          lockAmount: lockBundle.lockAmount,
          unlockTimestamp: lockBundle.unlockTimestamp,
          lockBlockhash: lockBundle.blockhash,
          lockLastValidBlockHeight: lockBundle.lastValidBlockHeight,
        };
        setLaunchResult(result);
        await saveLaunchCheckpoint({
          phase: "lock_submitted",
          mintAddress: result.mintAddress,
          lockTxSignature,
          lockMetadataId: lockBundle.metadataId,
          lockAmount: lockBundle.lockAmount,
          unlockTimestamp: lockBundle.unlockTimestamp,
          lockBlockhash: lockBundle.blockhash,
          lockLastValidBlockHeight: lockBundle.lastValidBlockHeight,
        });
        const submittedSignature = await connection.sendRawTransaction(
          serializedLockTransaction,
          { skipPreflight: false, preflightCommitment: "confirmed", maxRetries: 5 },
        );
        if (submittedSignature !== lockTxSignature) {
          throw new Error("RPC returned an unexpected lock transaction signature");
        }
        await confirmTxReliably(
          connection,
          lockTxSignature,
          lockBundle.blockhash,
          lockBundle.lastValidBlockHeight,
          "finalized",
        );
        await verifyStreamflowLock({
          connection,
          metadataId: lockBundle.metadataId,
          sender: publicKey,
          mint,
          amount: new BN(lockBundle.lockAmount),
          unlockTimestamp: lockBundle.unlockTimestamp,
        });

        await persistLaunch({
          config,
          publicKey,
          mintAddress: result.mintAddress,
          imageUri: pendingImageUri,
          createTxSignature: result.createTxSignature,
          lockTxSignature,
          lockAmount: result.lockAmount,
        });
      }

      setLaunchStatus("success");
      setPendingSignedLockTransaction(null);
      sessionStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      const raw = error instanceof Error ? error.message : "Unknown error occurred";
      setLaunchStatus("partial");
      setErrorMessage(`Lock retry failed: ${parseTransactionError(raw, config.buyAmountSol)}`);
    }
  }, [config, isRecoveredLockReady, launchResult, pendingImageUri, pendingSignedLockTransaction]);

  const resetLaunch = useCallback(() => {
    setLaunchStatus("idle");
    setLaunchPhase(0);
    setLaunchResult(null);
    setErrorMessage(null);
    setPendingImageUri(null);
    setPendingSignedLockTransaction(null);
    setRecoveredConfig(null);
    setIsRecoveredLockReady(true);
  }, []);

  return {
    launchStatus,
    launchPhase,
    launchPhases: LAUNCH_PHASES_WITH_LOCK,
    launchResult,
    recoveredConfig,
    errorMessage,
    launch,
    retryLock,
    resetLaunch,
  };
}
