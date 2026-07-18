import "server-only";

import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  buyQuoteInput,
  coinCreatorVaultAtaPda,
  coinCreatorVaultAuthorityPda,
  GLOBAL_CONFIG_PDA,
  GLOBAL_VOLUME_ACCUMULATOR_PDA,
  OnlinePumpAmmSdk,
  PUMP_AMM_EVENT_AUTHORITY_PDA,
  PUMP_AMM_FEE_CONFIG_PDA,
  PUMP_AMM_PROGRAM_ID,
  PUMP_FEE_PROGRAM_ID,
  poolV2Pda,
  userVolumeAccumulatorPda,
  type SwapSolanaState,
} from "@pump-fun/pump-swap-sdk";
import { Connection, PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import BN from "bn.js";
import {
  BUYBACK_BURN_LAMPORTS,
  DEFAULT_BUYBACK_SLIPPAGE_BPS,
  LCKD_CANONICAL_PUMP_POOL,
  LCKD_MINT,
  deriveBuybackBurnAtas,
  deriveBuybackBurnAuthority,
  minimumOutputForSlippage,
  wrapBuybackBurnInstruction,
  type BuybackBurnQuoteSnapshot,
} from "./buybackBurn";

const BUY_EXACT_QUOTE_IN_DISCRIMINATOR = Buffer.from([
  198, 46, 21, 82, 180, 217, 232, 112,
]);

export interface BuiltBuybackBurn {
  instruction: TransactionInstruction;
  pumpInstruction: TransactionInstruction;
  snapshot: BuybackBurnQuoteSnapshot;
}

export async function buildBuybackBurnInstruction(params: {
  connection: Connection;
  programId: PublicKey;
  launcher: PublicKey;
  authority?: PublicKey;
  slippageBps?: number;
}): Promise<BuiltBuybackBurn> {
  const authority = params.authority ?? deriveBuybackBurnAuthority(params.programId);
  const sdk = new OnlinePumpAmmSdk(params.connection);
  const state = await sdk.swapSolanaState(LCKD_CANONICAL_PUMP_POOL, authority);
  const observedSlot = await params.connection.getSlot("confirmed");
  return buildBuybackBurnFromState({
    state,
    observedSlot,
    programId: params.programId,
    launcher: params.launcher,
    authority,
    slippageBps: params.slippageBps,
  });
}

export function buildBuybackBurnFromState(params: {
  state: SwapSolanaState;
  observedSlot: number;
  programId: PublicKey;
  launcher: PublicKey;
  authority: PublicKey;
  slippageBps?: number;
}): BuiltBuybackBurn {
  assertCanonicalState(params.state, params.authority);
  if (!Number.isSafeInteger(params.observedSlot) || params.observedSlot < 0) {
    throw new Error("Buyback quote slot is invalid");
  }

  const slippageBps = params.slippageBps ?? DEFAULT_BUYBACK_SLIPPAGE_BPS;
  const quote = buyQuoteInput({
    quote: new BN(BUYBACK_BURN_LAMPORTS),
    slippage: 0,
    baseReserve: params.state.poolBaseAmount,
    quoteReserve: params.state.poolQuoteAmount,
    virtualQuoteReserves: params.state.pool.virtualQuoteReserves,
    globalConfig: params.state.globalConfig,
    baseMintAccount: params.state.baseMintAccount,
    baseMint: params.state.baseMint,
    coinCreator: params.state.pool.coinCreator,
    creator: params.state.pool.creator,
    feeConfig: params.state.feeConfig,
  });
  const expectedBaseAmountOut = BigInt(quote.base.toString());
  const minimumBaseAmountOut = minimumOutputForSlippage(expectedBaseAmountOut, slippageBps);
  const pumpInstruction = buildDirectPumpInstruction(
    params.state,
    params.authority,
    minimumBaseAmountOut,
  );
  const instruction = wrapBuybackBurnInstruction({
    programId: params.programId,
    launcher: params.launcher,
    authority: params.authority,
    pumpInstruction,
    minimumBaseAmountOut,
  });

  return {
    instruction,
    pumpInstruction,
    snapshot: {
      version: 1,
      observedSlot: params.observedSlot,
      authority: params.authority.toBase58(),
      pool: LCKD_CANONICAL_PUMP_POOL.toBase58(),
      spendableQuoteIn: "100000000",
      expectedBaseAmountOut: expectedBaseAmountOut.toString(),
      minimumBaseAmountOut: minimumBaseAmountOut.toString(),
      slippageBps,
      poolBaseReserve: params.state.poolBaseAmount.toString(),
      poolQuoteReserve: params.state.poolQuoteAmount.toString(),
      virtualQuoteReserve: params.state.pool.virtualQuoteReserves.toString(),
      buybackFeeRecipient: getBuybackFeeRecipient(params.state).toBase58(),
    },
  };
}

function buildDirectPumpInstruction(
  state: SwapSolanaState,
  authority: PublicKey,
  minimumBaseAmountOut: bigint,
): TransactionInstruction {
  const protocolFeeRecipient = state.pool.isMayhemMode
    ? state.globalConfig.reservedFeeRecipient
    : state.globalConfig.protocolFeeRecipients[0];
  if (!protocolFeeRecipient) throw new Error("Pump protocol fee recipient is unavailable");

  const coinCreatorVaultAuthority = coinCreatorVaultAuthorityPda(state.pool.coinCreator);
  const buybackFeeRecipient = getBuybackFeeRecipient(state);
  const keys = [
    meta(state.poolKey, false, true),
    meta(authority, true, true),
    meta(GLOBAL_CONFIG_PDA),
    meta(LCKD_MINT),
    meta(NATIVE_MINT),
    meta(state.userBaseTokenAccount, false, true),
    meta(state.userQuoteTokenAccount, false, true),
    meta(state.pool.poolBaseTokenAccount, false, true),
    meta(state.pool.poolQuoteTokenAccount, false, true),
    meta(protocolFeeRecipient),
    meta(getAssociatedTokenAddressSync(NATIVE_MINT, protocolFeeRecipient, true), false, true),
    meta(state.baseTokenProgram),
    meta(state.quoteTokenProgram),
    meta(SystemProgram.programId),
    meta(ASSOCIATED_TOKEN_PROGRAM_ID),
    meta(PUMP_AMM_EVENT_AUTHORITY_PDA),
    meta(PUMP_AMM_PROGRAM_ID),
    meta(coinCreatorVaultAtaPda(coinCreatorVaultAuthority, NATIVE_MINT, TOKEN_PROGRAM_ID), false, true),
    meta(coinCreatorVaultAuthority),
    meta(GLOBAL_VOLUME_ACCUMULATOR_PDA),
    meta(userVolumeAccumulatorPda(authority), false, true),
    meta(PUMP_AMM_FEE_CONFIG_PDA),
    meta(PUMP_FEE_PROGRAM_ID),
    meta(poolV2Pda(LCKD_MINT)),
    meta(buybackFeeRecipient),
    meta(getAssociatedTokenAddressSync(NATIVE_MINT, buybackFeeRecipient, true), false, true),
  ];
  return new TransactionInstruction({
    programId: PUMP_AMM_PROGRAM_ID,
    keys,
    data: encodePumpData(minimumBaseAmountOut),
  });
}

function assertCanonicalState(state: SwapSolanaState, authority: PublicKey): void {
  const atas = deriveBuybackBurnAtas(authority);
  if (!state.poolKey.equals(LCKD_CANONICAL_PUMP_POOL)) throw new Error("LCKD pool is not canonical");
  if (!state.user.equals(authority)) throw new Error("Pump user is not the buyback authority PDA");
  if (!state.baseMint.equals(LCKD_MINT) || !state.pool.baseMint.equals(LCKD_MINT)) {
    throw new Error("Pump base mint is not LCKD");
  }
  if (!state.pool.quoteMint.equals(NATIVE_MINT)) throw new Error("Pump quote mint is not WSOL");
  if (!state.baseTokenProgram.equals(TOKEN_2022_PROGRAM_ID) ||
      !state.quoteTokenProgram.equals(TOKEN_PROGRAM_ID)) {
    throw new Error("Pump token programs are not canonical");
  }
  if (!state.userBaseTokenAccount.equals(atas.lckd) || !state.userQuoteTokenAccount.equals(atas.wsol)) {
    throw new Error("Buyback authority token accounts are not deterministic ATAs");
  }
  const expectedPoolBase = getAssociatedTokenAddressSync(
    LCKD_MINT,
    state.poolKey,
    true,
    TOKEN_2022_PROGRAM_ID,
  );
  const expectedPoolQuote = getAssociatedTokenAddressSync(NATIVE_MINT, state.poolKey, true);
  if (!state.pool.poolBaseTokenAccount.equals(expectedPoolBase) ||
      !state.pool.poolQuoteTokenAccount.equals(expectedPoolQuote)) {
    throw new Error("Pump pool token accounts are not canonical ATAs");
  }
  if (state.pool.isCashbackCoin) throw new Error("LCKD cashback pool layout is unsupported");
}

function getBuybackFeeRecipient(state: SwapSolanaState): PublicKey {
  const recipient = state.globalConfig.buybackFeeRecipients[0];
  if (!recipient) throw new Error("Pump buyback fee recipient is unavailable");
  return recipient;
}

function encodePumpData(minimumBaseAmountOut: bigint): Buffer {
  const data = Buffer.alloc(25);
  BUY_EXACT_QUOTE_IN_DISCRIMINATOR.copy(data, 0);
  data.writeBigUInt64LE(BigInt(BUYBACK_BURN_LAMPORTS), 8);
  data.writeBigUInt64LE(minimumBaseAmountOut, 16);
  data[24] = 0;
  return data;
}

function meta(pubkey: PublicKey, isSigner = false, isWritable = false) {
  return { pubkey, isSigner, isWritable };
}
