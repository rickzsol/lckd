import { isAddress, type Address } from "viem";
import { PONS_FACTORY_ABI } from "./abi";
import {
  PONS_DEX_ID,
  PONS_FACTORY_ADDRESS,
  PONS_LAUNCH_CONFIG_ID,
  PONS_LAUNCH_FEE_WEI,
  ZERO_ADDRESS,
} from "./constants";
import type { PonsLaunchParams } from "./types";

const BYTES_32_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const MAX_URL_LENGTH = 2_048;

function validateText(label: string, value: string, maxLength: number): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`Pons launch ${label} is required`);
  if (normalized.length > maxLength) {
    throw new Error(`Pons launch ${label} exceeds ${maxLength} characters`);
  }
  return normalized;
}

function validateUrl(label: string, value: string, protocols: string[]): string {
  const normalized = value.trim();
  if (!normalized) return "";
  if (normalized.length > MAX_URL_LENGTH) throw new Error(`Pons launch ${label} URL is too long`);
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error(`Pons launch ${label} must be a valid URL`);
  }
  if (!protocols.includes(parsed.protocol)) {
    throw new Error(`Pons launch ${label} uses an unsupported URL protocol`);
  }
  return normalized;
}

function validateAddress(address: Address): Address {
  if (!isAddress(address, { strict: true }) || address.toLowerCase() === ZERO_ADDRESS) {
    throw new Error("Pons launch fee and buy recipient is invalid");
  }
  return address;
}

export function buildPonsLaunchRequest(params: PonsLaunchParams) {
  if (params.initialBuyWei < BigInt(0)) throw new Error("Pons launch initial buy cannot be negative");
  if (!BYTES_32_PATTERN.test(params.salt)) throw new Error("Pons launch salt must be bytes32");

  const socials = params.socials ?? {};
  const tokenParams = {
    name: validateText("name", params.name, 64),
    symbol: validateText("symbol", params.symbol, 32),
    logo: validateUrl("logo", params.logo, ["https:", "http:", "ipfs:"]),
    description: validateText("description", params.description, 1_000),
    socials: {
      twitter: validateUrl("Twitter", socials.twitter ?? "", ["https:", "http:"]),
      telegram: validateUrl("Telegram", socials.telegram ?? "", ["https:", "http:"]),
      discord: validateUrl("Discord", socials.discord ?? "", ["https:", "http:"]),
      website: validateUrl("website", socials.website ?? "", ["https:", "http:"]),
      farcaster: validateUrl("Farcaster", socials.farcaster ?? "", ["https:", "http:"]),
    },
    feeWallet: validateAddress(params.feeWallet),
  } as const;

  return {
    address: PONS_FACTORY_ADDRESS,
    abi: PONS_FACTORY_ABI,
    functionName: "launchToken" as const,
    args: [tokenParams, PONS_LAUNCH_CONFIG_ID, PONS_DEX_ID, params.salt] as const,
    value: PONS_LAUNCH_FEE_WEI + params.initialBuyWei,
  };
}
