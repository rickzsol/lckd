"use client";

import { useCallback, useEffect, useState } from "react";
import { usePublicClient } from "wagmi";
import { ROBINHOOD_CHAIN_ID, assertPonsDeployment } from "@/lib/evm/pons";
import type { DeploymentState } from "./RobinhoodLaunchReview";
import { getPonsActionError } from "./ponsLaunchClient";

export function usePonsDeployment() {
  const publicClient = usePublicClient({ chainId: ROBINHOOD_CHAIN_ID });
  const [deployment, setDeployment] = useState<DeploymentState>({
    status: "checking",
    message: "Checking pinned runtime code and protocol configuration...",
  });

  const checkDeployment = useCallback(async () => {
    if (!publicClient) return;
    try {
      const snapshot = await assertPonsDeployment(publicClient);
      setDeployment({
        status: "ready",
        message: `${snapshot.dexName} is enabled. Factory, locker, Uniswap links, fee split, and runtime code match the pinned deployment.`,
      });
    } catch (error) {
      setDeployment({ status: "drift", message: getPonsActionError(error) });
    }
  }, [publicClient]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => void checkDeployment(), 0);
    return () => window.clearTimeout(timeoutId);
  }, [checkDeployment]);

  return deployment;
}
