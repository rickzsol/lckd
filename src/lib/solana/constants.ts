import { PublicKey } from "@solana/web3.js";

// -- pump.fun program --
export const PUMPFUN_PROGRAM_ID = new PublicKey(
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",
);

export const PUMPFUN_FEE_RECIPIENT = new PublicKey(
  "CebN5WGQ4jvEPvsVU4EoHEpgzq1VV7AbicfhtW4xC9iM",
);

export const PUMPFUN_GLOBAL_SEED = "global";
export const PUMPFUN_BONDING_CURVE_SEED = "bonding-curve";
export const PUMPFUN_MINT_AUTHORITY_SEED = "mint-authority";

export const MPL_TOKEN_METADATA_PROGRAM_ID = new PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s",
);

export const PUMPFUN_EVENT_AUTHORITY = new PublicKey(
  "Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1",
);

// pump.fun tokens use 6 decimals (not 9)
export const PUMPFUN_TOKEN_DECIMALS = 6;

// Create instruction: sha256("global:create")[0..8]
export const CREATE_DISCRIMINATOR = Buffer.from([
  0x18, 0x1e, 0xc8, 0x28, 0x05, 0x1c, 0x07, 0x77,
]);

// Buy instruction: sha256("global:buy")[0..8]
export const BUY_DISCRIMINATOR = Buffer.from([
  0x66, 0x06, 0x3d, 0x12, 0x01, 0xda, 0xeb, 0xea,
]);

// -- PumpPortal API --
export const PUMPPORTAL_TRADE_URL = "https://pumpportal.fun/api/trade-local";
export const PUMPFUN_IPFS_URL = "https://pump.fun/api/ipfs";

// -- Transaction defaults --
export const DEFAULT_PRIORITY_FEE_MICROLAMPORTS = 100_000;
export const DEFAULT_SLIPPAGE_BPS = 1000; // 10%
export const DEFAULT_PRIORITY_FEE_SOL = 0.001;

// Estimated SOL overhead for the lock TX (Streamflow escrow rent + tx fee + Jito tip)
// Streamflow v11 charges ~0.16 SOL protocol fee + ~0.01 escrow rent + ~0.002 ATA rent
export const LOCK_TX_SOL_OVERHEAD = 0.2;
// Estimated SOL overhead for the create TX (priority fee + tx fee + mint/ATA/metadata rent + pump.fun fees)
export const CREATE_TX_SOL_OVERHEAD = 0.03;

// -- Solana --
export const LAMPORTS_PER_SOL = 1_000_000_000;
export const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
);
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);
export const SYSTEM_PROGRAM_ID = new PublicKey(
  "11111111111111111111111111111111",
);
export const RENT_PROGRAM_ID = new PublicKey(
  "SysvarRent111111111111111111111111111111111",
);
