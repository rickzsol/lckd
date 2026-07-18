import { isAddress, parseEther, zeroAddress } from "viem";
import type { RobinhoodLaunchFormData } from "./launchTypes";

export type LaunchErrors = Partial<Record<keyof RobinhoodLaunchFormData, string>>;

export function validateRobinhoodLaunch(
  form: RobinhoodLaunchFormData,
  isMainnetEnabled: boolean,
): LaunchErrors {
  const errors: LaunchErrors = {};
  const name = form.name.trim();
  const symbol = form.symbol.trim();

  if (!name || name.length > 64) errors.name = "Use 1 to 64 characters.";
  if (!/^[A-Za-z0-9]{1,10}$/.test(symbol)) errors.symbol = "Use 1 to 10 letters or numbers.";
  if (!form.description.trim() || form.description.trim().length > 500) {
    errors.description = "Use 1 to 500 characters.";
  }
  if (!isPublicUri(form.logo)) errors.logo = "Use a public HTTPS or IPFS URI.";

  for (const field of ["twitter", "telegram", "website"] as const) {
    if (form[field] && !isHttpsUrl(form[field])) errors[field] = "Use a valid HTTPS URL.";
  }

  try {
    if (!/^(0|[1-9]\d*)(\.\d{1,18})?$/.test(form.initialBuyEth || "0")) {
      throw new Error("Non-canonical ETH amount");
    }
    const initialBuyWei = parseEther(form.initialBuyEth || "0");
    if (initialBuyWei < BigInt(0)) errors.initialBuyEth = "Initial buy cannot be negative.";
  } catch {
    errors.initialBuyEth = "Enter a valid ETH amount.";
  }

  if (!isAddress(form.feeWallet) || form.feeWallet.toLowerCase() === zeroAddress) {
    errors.feeWallet = "Enter a nonzero EVM address.";
  }
  if (isMainnetEnabled && !form.hasAcceptedPermanentLock) {
    errors.hasAcceptedPermanentLock = "Required before a mainnet launch.";
  }
  return errors;
}

function isPublicUri(value: string) {
  return /^ipfs:\/\/[^\s/]+/.test(value) || isHttpsUrl(value);
}

function isHttpsUrl(value: string) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}
