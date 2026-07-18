import { BaseError, UserRejectedRequestError, parseEther, type Address, type Hex } from "viem";
import { buildPonsLaunchRequest } from "@/lib/evm/pons";
import type { RobinhoodLaunchFormData } from "./launchTypes";

export function buildRecoveredLaunchRequest(form: RobinhoodLaunchFormData, salt: Hex) {
  return buildPonsLaunchRequest({
    name: form.name.trim(),
    symbol: form.symbol.trim().toUpperCase(),
    logo: form.logo.trim(),
    description: form.description.trim(),
    socials: Object.fromEntries((["twitter", "telegram", "website"] as const)
      .filter((key) => form[key].trim()).map((key) => [key, form[key].trim()])),
    feeWallet: form.feeWallet as Address,
    initialBuyWei: parseEther(form.initialBuyEth || "0"),
    salt,
  });
}

export function isUserRejectedWalletRequest(error: unknown) {
  let current = error;
  for (let depth = 0; depth < 6 && current; depth += 1) {
    if (current instanceof UserRejectedRequestError) return true;
    if (typeof current !== "object") return false;
    const value = current as { code?: unknown; name?: unknown; cause?: unknown };
    if (value.code === 4001 || value.name === "UserRejectedRequestError") return true;
    current = value.cause;
  }
  return false;
}

export function acquireSingleFlight(latch: { current: boolean }) {
  if (latch.current) return false;
  latch.current = true;
  return true;
}

export function getPonsActionError(error: unknown) {
  if (error instanceof BaseError) return error.shortMessage;
  if (error instanceof Error) return error.message;
  return "The launch request failed. Verify the wallet, chain, and contract state.";
}
