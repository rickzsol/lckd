"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { parseEther, toHex, type Address, type Hash } from "viem";
import { usePublicClient, useWalletClient } from "wagmi";
import { ROBINHOOD_CHAIN_ID, assertPonsDeployment, decodePonsLaunchReceipt, verifyPonsLaunchReceipt } from "@/lib/evm/pons";
import type { VerifiedLaunchDisplay } from "./RobinhoodLaunchStatus";
import type { LaunchPhase, RobinhoodLaunchFormData } from "./launchTypes";
import { validateRobinhoodLaunch, type LaunchErrors } from "./launchValidation";
import {
  canonicalizeRecoveryForm,
  getRobinhoodRecovery,
  assertPreparedRecovery,
  assertSubmittedRecovery,
  isActiveRecovery,
  markRobinhoodRecoveryAmbiguous,
  prepareRobinhoodRecovery,
  reconcileFallbackIntent,
  reconcileLocalPendingLaunch,
  reconcileRobinhoodRecovery,
  submitRobinhoodRecovery,
  type RobinhoodRecoveryIntent,
} from "./robinhoodRecovery";
import { clearLocalPendingLaunch, loadLocalRecoveryMarker, saveLocalAmbiguousLaunch, saveLocalPendingLaunch } from "./recoveryLocal";
import { acquireSingleFlight, buildRecoveredLaunchRequest, getPonsActionError, isUserRejectedWalletRequest } from "./ponsLaunchClient";
import { usePonsDeployment } from "./usePonsDeployment";

const MAINNET_ENABLED = process.env.NEXT_PUBLIC_ENABLE_ROBINHOOD_LAUNCHES === "true";
export function usePonsLaunch(account?: Address) {
  const publicClient = usePublicClient({ chainId: ROBINHOOD_CHAIN_ID });
  const { data: walletClient } = useWalletClient({ chainId: ROBINHOOD_CHAIN_ID });
  const currentAccount = useRef(account);
  const submitInFlight = useRef(false);
  const retryInFlight = useRef(false);
  currentAccount.current = account;
  const deployment = usePonsDeployment();
  const [phase, setPhase] = useState<LaunchPhase>("idle");
  const [errors, setErrors] = useState<LaunchErrors>({});
  const [actionError, setActionError] = useState<string>();
  const [result, setResult] = useState<VerifiedLaunchDisplay>();
  const [recovery, setRecovery] = useState<RobinhoodRecoveryIntent>();
  const [isRecoveryChecking, setIsRecoveryChecking] = useState(false);
  const [isRecoveryBlocked, setIsRecoveryBlocked] = useState(false);
  const [pendingTransactionHash, setPendingTransactionHash] = useState<Hash>();

  const applyRecovery = useCallback((intent: RobinhoodRecoveryIntent | null) => {
    setRecovery(intent ?? undefined);
    setPendingTransactionHash(intent?.transactionHash ?? undefined);
    setIsRecoveryBlocked(false);
    if (!intent) {
      setPhase("idle");
      return;
    }
    if (intent.status === "prepared") setPhase("prepared");
    if (intent.status === "submitted") {
      setActionError(undefined); setPhase("confirming");
    }
    if (intent.status === "ambiguous") {
      setPhase("error");
      setIsRecoveryBlocked(true);
      setActionError("Wallet submission outcome is ambiguous. New wallet requests are blocked for this intent.");
    }
    if (intent.status === "failed") {
      setPhase("error");
      setActionError(intent.error ?? "The recovered transaction failed onchain.");
    }
    if (intent.status === "verified") {
      if (!intent.transactionHash || !intent.tokenAddress) {
        throw new Error("Verified recovery is missing transaction results.");
      }
      setResult({
        transactionHash: intent.transactionHash,
        tokenAddress: intent.tokenAddress,
        poolAddress: intent.poolAddress ?? undefined,
      });
      setActionError(undefined);
      setPhase("verified");
    }
    if (intent.status === "verified" || intent.status === "failed") {
      clearLocalPendingLaunch(intent.walletAddress);
    }
  }, []);

  const reconcileRecovery = useCallback(async (
    walletAddress: Address,
    fallback?: RobinhoodRecoveryIntent,
  ) => {
    let intent = await getRobinhoodRecovery(walletAddress);
    const localMarker = loadLocalRecoveryMarker(walletAddress);
    if (fallback?.status === "submitted" && fallback.transactionHash) {
      intent = await reconcileFallbackIntent(walletAddress, intent, fallback);
    } else if (localMarker) {
      intent = await reconcileLocalPendingLaunch(walletAddress, intent, localMarker);
    } else if (fallback && isActiveRecovery(fallback)) {
      intent = await reconcileFallbackIntent(walletAddress, intent, fallback);
    } else if (intent?.status === "submitted" || intent?.status === "ambiguous") {
      intent = await reconcileRobinhoodRecovery(walletAddress, intent.salt);
    }
    if (currentAccount.current?.toLowerCase() === walletAddress.toLowerCase()) applyRecovery(intent);
    return intent;
  }, [applyRecovery]);

  const settleSubmitted = useCallback(async (intent: RobinhoodRecoveryIntent) => {
    if (!publicClient || !intent.transactionHash) throw new Error("Submitted recovery is missing a transaction hash.");
    const initialBuyWei = parseEther(intent.config.initialBuyEth || "0");
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: intent.transactionHash,
      confirmations: 20,
    });
    const decoded = decodePonsLaunchReceipt(receipt.logs);
    await verifyPonsLaunchReceipt(publicClient, decoded, {
      deployer: intent.walletAddress,
      feeWallet: intent.config.feeWallet as Address,
      initialBuyWei,
    });
    const isCurrentWallet = currentAccount.current?.toLowerCase() === intent.walletAddress.toLowerCase();
    const reconciled = await reconcileRobinhoodRecovery(intent.walletAddress, intent.salt);
    if (!reconciled || reconciled.salt.toLowerCase() !== intent.salt.toLowerCase()) {
      throw new Error("Server reconciliation did not return the submitted launch intent.");
    }
    if (isCurrentWallet) applyRecovery(reconciled);
    return reconciled;
  }, [applyRecovery, publicClient]);

  const retryRecovery = useCallback(async () => {
    if (!acquireSingleFlight(retryInFlight)) return;
    const intent = recovery;
    try {
      if (!account || !intent || (intent.status !== "ambiguous" && intent.status !== "submitted")) return;
      setIsRecoveryChecking(true);
      setIsRecoveryBlocked(true);
      setActionError(undefined);
      const reconciled = await reconcileRobinhoodRecovery(account, intent.salt);
      if (!reconciled || reconciled.salt.toLowerCase() !== intent.salt.toLowerCase()
        || reconciled.walletAddress.toLowerCase() !== account.toLowerCase()) {
        throw new Error("Server reconciliation did not return the active launch intent.");
      }
      if (currentAccount.current?.toLowerCase() === account.toLowerCase()) applyRecovery(reconciled);
      if (reconciled.status === "submitted") await settleSubmitted(reconciled);
    } catch (error) {
      if (currentAccount.current?.toLowerCase() === account?.toLowerCase()) {
        setIsRecoveryBlocked(true);
        setActionError(getPonsActionError(error));
        setPhase("error");
      }
    } finally {
      retryInFlight.current = false;
      if (currentAccount.current?.toLowerCase() === account?.toLowerCase()) setIsRecoveryChecking(false);
    }
  }, [account, applyRecovery, recovery, settleSubmitted]);

  useEffect(() => {
    if (!MAINNET_ENABLED || !account || !publicClient) {
      setRecovery(undefined);
      setIsRecoveryChecking(false);
      setIsRecoveryBlocked(false);
      return;
    }
    let isCancelled = false;
    setRecovery(undefined);
    setResult(undefined);
    setPendingTransactionHash(undefined);
    setIsRecoveryChecking(true);
    setIsRecoveryBlocked(true);
    setActionError(undefined);
    setPhase("recovery-checking");
    void reconcileRecovery(account)
      .then(async (intent) => {
        if (!isCancelled && intent?.status === "submitted") await settleSubmitted(intent);
      })
      .catch((error) => {
        if (isCancelled) return;
        setIsRecoveryBlocked(true);
        setActionError(getPonsActionError(error));
        setPhase("error");
      })
      .finally(() => {
        if (!isCancelled) setIsRecoveryChecking(false);
      });
    return () => { isCancelled = true; };
  }, [account, publicClient, reconcileRecovery, settleSubmitted]);

  const submit = useCallback(async (requestedForm: RobinhoodLaunchFormData) => {
    if (!acquireSingleFlight(submitInFlight)) return;
    try {
    setActionError(undefined);
    setResult(undefined);
    const active = recovery && isActiveRecovery(recovery) ? recovery : undefined;
    if (active?.status === "submitted" || active?.status === "ambiguous") {
      setActionError("This launch is still being reconciled. Do not send another transaction.");
      return;
    }
    const form = active?.config ?? canonicalizeRecoveryForm(requestedForm);
    const nextErrors = validateRobinhoodLaunch(form, MAINNET_ENABLED);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0 || !publicClient || !account) return;

    let checkpoint = active;
    try {
      setPhase("simulating");
      await assertPonsDeployment(publicClient);
      const salt = active?.salt ?? toHex(crypto.getRandomValues(new Uint8Array(32)));
      const request = buildRecoveredLaunchRequest(form, salt);
      const simulation = await publicClient.simulateContract({ ...request, account });
      if (!MAINNET_ENABLED) {
        setPhase("simulated");
        return;
      }
      if (!walletClient) throw new Error("Robinhood wallet client is unavailable.");

      if (!checkpoint) {
        checkpoint = assertPreparedRecovery(await prepareRobinhoodRecovery(account, salt, form), account, salt, form);
        applyRecovery(checkpoint);
      }
      await assertPonsDeployment(publicClient);
      if (currentAccount.current?.toLowerCase() !== account.toLowerCase()
        || walletClient.account.address.toLowerCase() !== account.toLowerCase()) {
        throw new Error("The connected EVM account changed. Recovery remains prepared for the original wallet.");
      }
      setPhase("awaiting-wallet");
      saveLocalAmbiguousLaunch(account, salt);
      let transactionHash: Hash;
      try {
        transactionHash = await walletClient.writeContract(simulation.request);
      } catch (walletError) {
        if (isUserRejectedWalletRequest(walletError)) {
          clearLocalPendingLaunch(account);
          applyRecovery(checkpoint);
          setActionError("Wallet request rejected. The prepared launch can be resumed with the same salt.");
          return;
        }
        const ambiguous = await markRobinhoodRecoveryAmbiguous(account, salt);
        if (!ambiguous || ambiguous.status !== "ambiguous") {
          throw new Error("Ambiguous wallet outcome was not durably checkpointed.");
        }
        applyRecovery(ambiguous);
        setActionError(`${getPonsActionError(walletError)} The wallet outcome is ambiguous and further requests are blocked.`);
        return;
      }
      const submittedFallback = { ...checkpoint, status: "submitted" as const, transactionHash };
      checkpoint = submittedFallback;
      setPendingTransactionHash(transactionHash);
      setPhase("confirming");
      try {
        saveLocalPendingLaunch({ kind: "candidate", walletAddress: account, salt, transactionHash });
      } catch {
        // The ambiguous marker remains conservative while the server validates this candidate.
      }
      const submitted = assertSubmittedRecovery(
        await submitRobinhoodRecovery(account, salt, transactionHash),
        submittedFallback,
      );
      setRecovery(submitted);
      await settleSubmitted(submitted);
    } catch (error) {
      setActionError(getPonsActionError(error));
      try {
        const restored = await reconcileRecovery(account, checkpoint);
        if (restored?.status === "submitted") await settleSubmitted(restored);
        else if (!restored) setPhase("error");
      } catch (recoveryError) {
        setIsRecoveryBlocked(true);
        setPhase("error");
        setActionError(`${getPonsActionError(error)} Recovery check: ${getPonsActionError(recoveryError)}`);
      }
    }
    } finally {
      submitInFlight.current = false;
    }
  }, [account, applyRecovery, publicClient, reconcileRecovery, recovery, settleSubmitted, walletClient]);

  const resetTerminal = useCallback(() => {
    if (recovery && recovery.status !== "verified" && recovery.status !== "failed") return;
    setRecovery(undefined);
    setResult(undefined);
    setPendingTransactionHash(undefined);
    setActionError(undefined);
    setErrors({});
    setIsRecoveryBlocked(false);
    setPhase("idle");
  }, [recovery]);

  return {
    deployment,
    phase,
    errors,
    actionError,
    result,
    recovery,
    recoveryForm: recovery?.config,
    isRecoveryChecking,
    isRecoveryBlocked,
    pendingTransactionHash,
    mainnetEnabled: MAINNET_ENABLED,
    submit,
    retryRecovery,
    resetTerminal,
  };
}
