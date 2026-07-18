export interface RobinhoodLaunchFormData {
  name: string;
  symbol: string;
  description: string;
  logo: string;
  twitter: string;
  telegram: string;
  website: string;
  initialBuyEth: string;
  feeWallet: string;
  hasAcceptedPermanentLock: boolean;
}

export type LaunchPhase =
  | "idle"
  | "simulating"
  | "simulated"
  | "recovery-checking"
  | "prepared"
  | "awaiting-wallet"
  | "confirming"
  | "verified"
  | "error";

export const INITIAL_FORM: RobinhoodLaunchFormData = {
  name: "",
  symbol: "",
  description: "",
  logo: "",
  twitter: "",
  telegram: "",
  website: "",
  initialBuyEth: "0.005",
  feeWallet: "",
  hasAcceptedPermanentLock: false,
};
