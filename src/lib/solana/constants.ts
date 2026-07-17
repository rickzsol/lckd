import { PublicKey } from "@solana/web3.js";

export const PUMPFUN_PROGRAM_ID = new PublicKey(
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
);
export const PUMP_AMM_PROGRAM_ID = new PublicKey(
  "pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA",
);
export const STREAMFLOW_PROGRAM_ID = new PublicKey(
  "strmRqUCoQUgGUan5YhzUZa6KqdzwX5L6FpUxfmKg5m",
);
export const MPL_TOKEN_METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
);

export const PUMPFUN_TOKEN_DECIMALS = 6;

export const DEFAULT_PRIORITY_FEE_MICROLAMPORTS = 100_000;
export const LOOKUP_SETUP_COMPUTE_UNIT_LIMIT = 50_000;
export const DEFAULT_SLIPPAGE_BPS = 1_000;
export const DEFAULT_PRIORITY_FEE_SOL = 0.001;

// Includes Streamflow's 0.09 SOL creation fee, account rent, and network fees.
export const LOCK_TX_SOL_OVERHEAD = 0.2;
export const CREATE_TX_SOL_OVERHEAD = 0.03;
export const LAMPORTS_PER_SOL = 1_000_000_000;
