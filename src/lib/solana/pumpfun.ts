import {
  PublicKey,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  PUMPFUN_PROGRAM_ID,
  PUMPFUN_FEE_RECIPIENT,
  PUMPFUN_GLOBAL_SEED,
  PUMPFUN_BONDING_CURVE_SEED,
  PUMPFUN_MINT_AUTHORITY_SEED,
  PUMPFUN_EVENT_AUTHORITY,
  PUMPFUN_TOKEN_DECIMALS,
  MPL_TOKEN_METADATA_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  SYSTEM_PROGRAM_ID,
  RENT_PROGRAM_ID,
  CREATE_DISCRIMINATOR,
  BUY_DISCRIMINATOR,
  PUMPPORTAL_TRADE_URL,
  DEFAULT_SLIPPAGE_BPS,
  DEFAULT_PRIORITY_FEE_SOL,
} from "./constants";

// ─── PDA Derivation ─────────────────────────────────────────────────────────

export function derivePumpfunGlobalPDA(): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from(PUMPFUN_GLOBAL_SEED)],
    PUMPFUN_PROGRAM_ID,
  );
  return pda;
}

export function deriveBondingCurvePDA(mint: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from(PUMPFUN_BONDING_CURVE_SEED), mint.toBuffer()],
    PUMPFUN_PROGRAM_ID,
  );
  return pda;
}

export function deriveMintAuthorityPDA(): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from(PUMPFUN_MINT_AUTHORITY_SEED)],
    PUMPFUN_PROGRAM_ID,
  );
  return pda;
}

export function deriveMetadataPDA(mint: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata"),
      MPL_TOKEN_METADATA_PROGRAM_ID.toBuffer(),
      mint.toBuffer(),
    ],
    MPL_TOKEN_METADATA_PROGRAM_ID,
  );
  return pda;
}

export function deriveAssociatedTokenAddress(
  owner: PublicKey,
  mint: PublicKey,
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  return pda;
}

// ─── Direct Instruction Builders ─────────────────────────────────────────────
// These build raw pump.fun instructions. The account layout is reverse-engineered
// from on-chain data and may need adjustment as the protocol evolves.
// TODO: Validate account ordering against latest pump.fun deployments

export interface CreateIxParams {
  creator: PublicKey;
  mint: PublicKey;
  name: string;
  symbol: string;
  uri: string;
}

/**
 * Builds the pump.fun create token instruction.
 *
 * Account layout (order matters):
 *  0. mint (signer, writable) - the new token mint keypair
 *  1. mintAuthority (PDA)
 *  2. bondingCurve (PDA, writable)
 *  3. bondingCurveAta (writable) - bonding curve's associated token account
 *  4. global (PDA)
 *  5. mplTokenMetadata program
 *  6. metadata (PDA, writable) - token metadata account
 *  7. user/creator (signer, writable)
 *  8. systemProgram
 *  9. tokenProgram
 * 10. associatedTokenProgram
 * 11. rent
 * 12. eventAuthority (PDA)
 * 13. program (self-reference)
 *
 * TODO: Verify discriminator and data layout against current on-chain program
 */
export function buildPumpfunCreateIx(params: CreateIxParams): TransactionInstruction {
  const { creator, mint, name, symbol, uri } = params;

  const bondingCurve = deriveBondingCurvePDA(mint);
  const bondingCurveAta = deriveAssociatedTokenAddress(bondingCurve, mint);
  const mintAuthority = deriveMintAuthorityPDA();
  const global = derivePumpfunGlobalPDA();
  const metadata = deriveMetadataPDA(mint);

  // Instruction data: discriminator + borsh-serialized CreateParams
  // CreateParams { name: String, symbol: String, uri: String }
  const nameBytes = Buffer.from(name, "utf-8");
  const symbolBytes = Buffer.from(symbol, "utf-8");
  const uriBytes = Buffer.from(uri, "utf-8");

  // Borsh string encoding: 4-byte LE length prefix + data
  const dataLength =
    CREATE_DISCRIMINATOR.length +
    4 + nameBytes.length +
    4 + symbolBytes.length +
    4 + uriBytes.length;

  const data = Buffer.alloc(dataLength);
  let offset = 0;

  CREATE_DISCRIMINATOR.copy(data, offset);
  offset += CREATE_DISCRIMINATOR.length;

  data.writeUInt32LE(nameBytes.length, offset);
  offset += 4;
  nameBytes.copy(data, offset);
  offset += nameBytes.length;

  data.writeUInt32LE(symbolBytes.length, offset);
  offset += 4;
  symbolBytes.copy(data, offset);
  offset += symbolBytes.length;

  data.writeUInt32LE(uriBytes.length, offset);
  offset += 4;
  uriBytes.copy(data, offset);

  return new TransactionInstruction({
    programId: PUMPFUN_PROGRAM_ID,
    keys: [
      { pubkey: mint, isSigner: true, isWritable: true },
      { pubkey: mintAuthority, isSigner: false, isWritable: false },
      { pubkey: bondingCurve, isSigner: false, isWritable: true },
      { pubkey: bondingCurveAta, isSigner: false, isWritable: true },
      { pubkey: global, isSigner: false, isWritable: false },
      { pubkey: MPL_TOKEN_METADATA_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: metadata, isSigner: false, isWritable: true },
      { pubkey: creator, isSigner: true, isWritable: true },
      { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: RENT_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: PUMPFUN_EVENT_AUTHORITY, isSigner: false, isWritable: false },
      { pubkey: PUMPFUN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  });
}

export interface BuyIxParams {
  buyer: PublicKey;
  mint: PublicKey;
  /** Amount of SOL to spend (in lamports) */
  solAmountLamports: bigint;
  /** Maximum token amount expected (slippage protection), in raw token units (6 decimals) */
  maxTokenAmount: bigint;
}

/**
 * Builds the pump.fun buy instruction.
 *
 * Account layout:
 *  0. global (PDA)
 *  1. feeRecipient (writable)
 *  2. mint
 *  3. bondingCurve (PDA, writable)
 *  4. bondingCurveAta (writable)
 *  5. userAta (writable) - buyer's associated token account
 *  6. user (signer, writable)
 *  7. systemProgram
 *  8. tokenProgram
 *  9. rent
 * 10. eventAuthority
 * 11. program (self-reference)
 *
 * Instruction data: discriminator + amount (u64 LE) + max_sol_cost (u64 LE)
 *
 * TODO: Verify buy data layout - some versions use (token_amount, max_sol) vs (sol_amount, min_tokens)
 */
export function buildPumpfunBuyIx(params: BuyIxParams): TransactionInstruction {
  const { buyer, mint, solAmountLamports, maxTokenAmount } = params;

  const bondingCurve = deriveBondingCurvePDA(mint);
  const bondingCurveAta = deriveAssociatedTokenAddress(bondingCurve, mint);
  const userAta = deriveAssociatedTokenAddress(buyer, mint);
  const global = derivePumpfunGlobalPDA();

  // Data layout: discriminator (8) + token_amount (u64) + max_sol_cost (u64)
  const data = Buffer.alloc(8 + 8 + 8);
  let offset = 0;

  BUY_DISCRIMINATOR.copy(data, offset);
  offset += 8;

  // token amount (u64 LE) - how many tokens to buy
  data.writeBigUInt64LE(maxTokenAmount, offset);
  offset += 8;

  // max SOL cost (u64 LE) - maximum lamports willing to spend
  data.writeBigUInt64LE(solAmountLamports, offset);

  return new TransactionInstruction({
    programId: PUMPFUN_PROGRAM_ID,
    keys: [
      { pubkey: global, isSigner: false, isWritable: false },
      { pubkey: PUMPFUN_FEE_RECIPIENT, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: bondingCurve, isSigner: false, isWritable: true },
      { pubkey: bondingCurveAta, isSigner: false, isWritable: true },
      { pubkey: userAta, isSigner: false, isWritable: true },
      { pubkey: buyer, isSigner: true, isWritable: true },
      { pubkey: SYSTEM_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: RENT_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: PUMPFUN_EVENT_AUTHORITY, isSigner: false, isWritable: false },
      { pubkey: PUMPFUN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data,
  });
}

// ─── PumpPortal API Approach (Recommended for MVP) ───────────────────────────
// The direct instruction builders above are useful for understanding the protocol,
// but the account layout can change. PumpPortal's trade-local API handles the
// instruction building server-side and returns a pre-built transaction.

export interface PumpPortalCreateParams {
  creatorPublicKey: string;
  mintPublicKey: string;
  name: string;
  symbol: string;
  metadataUri: string;
  /** Initial buy amount in SOL */
  buyAmountSol: number;
  slippagePercent?: number;
  priorityFeeSol?: number;
}

/**
 * Fetches a pre-built create+buy transaction from PumpPortal's trade-local API.
 * Returns raw transaction bytes that need to be signed by [mintKeypair, creatorKeypair].
 */
export async function fetchPumpPortalCreateTx(
  params: PumpPortalCreateParams,
): Promise<Uint8Array> {
  const {
    creatorPublicKey,
    mintPublicKey,
    name,
    symbol,
    metadataUri,
    buyAmountSol,
    slippagePercent = DEFAULT_SLIPPAGE_BPS / 100,
    priorityFeeSol = DEFAULT_PRIORITY_FEE_SOL,
  } = params;

  if (buyAmountSol <= 0) {
    throw new Error("Buy amount must be greater than 0 SOL");
  }

  const payload = {
    publicKey: creatorPublicKey,
    action: "create",
    tokenMetadata: { name, symbol, uri: metadataUri },
    mint: mintPublicKey,
    denominatedInSol: "true",
    amount: buyAmountSol,
    slippage: slippagePercent,
    priorityFee: priorityFeeSol,
    pool: "pump",
  };

  const response = await fetch(PUMPPORTAL_TRADE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    throw new Error(
      `PumpPortal create tx failed (${response.status}): ${errorText}`,
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}

/**
 * Converts SOL amount to the expected raw token quantity at the bonding curve launch price.
 * pump.fun initial virtual reserves: ~1.073B tokens (human-readable) / 30 SOL.
 * Linear approximation — accurate for small buys, overestimates for large ones.
 */
export function estimateTokensFromSol(solAmount: number): bigint {
  const INITIAL_VIRTUAL_SOL_RESERVES = 30;
  const INITIAL_VIRTUAL_TOKEN_RESERVES = 1_073_000_000; // ~1.073B human-readable tokens
  const tokensPerSol = INITIAL_VIRTUAL_TOKEN_RESERVES / INITIAL_VIRTUAL_SOL_RESERVES;
  const rawTokens = Math.floor(solAmount * tokensPerSol * 10 ** PUMPFUN_TOKEN_DECIMALS);
  return BigInt(rawTokens);
}
