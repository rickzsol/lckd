import type { Address, Hex, Log } from "viem";

export interface PonsSocials {
  twitter?: string;
  telegram?: string;
  discord?: string;
  website?: string;
  farcaster?: string;
}

export interface PonsLaunchParams {
  name: string;
  symbol: string;
  logo: string;
  description: string;
  socials?: PonsSocials;
  feeWallet: Address;
  initialBuyWei: bigint;
  salt: Hex;
}

export interface PonsLaunchReceipt {
  token: Address;
  deployer: Address;
  dexFactory: Address;
  pairToken: Address;
  pool: Address;
  dexId: bigint;
  launchConfigId: bigint;
  positionId: bigint;
  restrictionsEndBlock: bigint;
  initialBuyAmount: bigint;
}

export interface PonsDeploymentSnapshot {
  factoryOwner: Address;
  lockerOwner: Address;
  protocolFeeRecipient: Address;
  launchFee: bigint;
  protocolFeeShare: bigint;
  launchEnabled: boolean;
  dexName: string;
}

export interface PonsReceiptExpectation {
  deployer: Address;
  feeWallet: Address;
  initialBuyWei: bigint;
}

export type PonsReceiptLog = Pick<Log, "address" | "data" | "topics">;
