import "server-only";

import { readFileSync } from "node:fs";
import {
  AddressLookupTableAccount,
  AddressLookupTableProgram,
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  sendAndConfirmTransaction,
  Transaction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { resolveLaunchFeeTerms } from "@/lib/api/launchFee.server";
import {
  buildAtomicLaunchInstructionsFromSnapshot,
  buildAtomicLookupPreparation,
  buybackProtocolLookupAddresses,
  freezeAtomicLaunchConfig,
  validateAtomicLaunchTransaction,
} from "@/lib/solana/atomicLaunchBuilder.server";

const MAINNET_GENESIS_HASH = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const WALLET = new PublicKey("8A4i2yk8R9ivCGdtQeyo71JYyB6CjfSsMnWcYthisPwT");
const EXPECTED_PAYER = new PublicKey("2BUx2mkRUxRg6izd2se7QWNUYRqELykKEMKFCjJ8p7Un");
const LOCK_DURATION_DAYS = 7;

function requiredArgument(prefix: string): string {
  const value = process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
  if (!value) throw new Error(`Missing ${prefix}<value>`);
  return value;
}

function loadKeypair(path: string): Keypair {
  const bytes = JSON.parse(readFileSync(path, "utf8")) as number[];
  if (!Array.isArray(bytes) || bytes.length !== 64) throw new Error("Payer keypair is invalid");
  return Keypair.fromSecretKey(Uint8Array.from(bytes));
}

async function waitUntilLookupTableIsUsable(
  connection: Connection,
  lookupTable: PublicKey,
): Promise<AddressLookupTableAccount> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const [slot, response] = await Promise.all([
      connection.getSlot("confirmed"),
      connection.getAddressLookupTable(lookupTable, { commitment: "confirmed" }),
    ]);
    if (response.value && slot > response.value.state.lastExtendedSlot) return response.value;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Temporary lookup table did not become usable");
}

async function sendLookupInstruction(
  connection: Connection,
  payer: Keypair,
  instruction: ReturnType<typeof AddressLookupTableProgram.deactivateLookupTable>,
): Promise<string> {
  return sendAndConfirmTransaction(
    connection,
    new Transaction().add(
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000 }),
      instruction,
    ),
    [payer],
    { commitment: "finalized", maxRetries: 10 },
  );
}

async function main(): Promise<void> {
  const rpcUrl = process.env.HELIUS_RPC_URL ?? process.env.NEXT_PUBLIC_HELIUS_RPC_URL;
  if (!rpcUrl) throw new Error("HELIUS_RPC_URL is required");
  if (process.env.LAUNCH_FEE_LAMPORTS !== "100000000") {
    throw new Error("LAUNCH_FEE_LAMPORTS must equal 100000000");
  }
  const protocolLookupAddress = new PublicKey(
    process.env.BUYBACK_BURN_LOOKUP_TABLE ?? "",
  );
  const payer = loadKeypair(requiredArgument("--payer-keypair="));
  if (!payer.publicKey.equals(EXPECTED_PAYER)) {
    throw new Error("Temporary lookup table payer is not the isolated deployer");
  }
  const connection = new Connection(rpcUrl, "confirmed");
  if (await connection.getGenesisHash() !== MAINNET_GENESIS_HASH) {
    throw new Error("Preview simulation requires mainnet-beta");
  }

  const mint = Keypair.generate().publicKey;
  const metadata = Keypair.generate().publicKey;
  const feeTerms = await resolveLaunchFeeTerms(WALLET, "sol");
  const config = freezeAtomicLaunchConfig({
    name: "LCKD Preview",
    ticker: "LCKDP",
    buyAmountSol: 0.01,
    lockDurationDays: LOCK_DURATION_DAYS,
    lockPercentage: 99,
    ...feeTerms,
  });
  const identity = {
    config,
    walletPublicKey: WALLET,
    mintPublicKey: mint,
    metadataPublicKey: metadata,
    metadataUri: "https://lckd.tech/lckd-preview.json",
  };
  const preparation = await buildAtomicLookupPreparation(identity);
  const recentSlot = (await connection.getSlot("finalized")) - 5;
  const [createInstruction, lookupTableAddress] = AddressLookupTableProgram.createLookupTable({
    authority: payer.publicKey,
    payer: payer.publicKey,
    recentSlot,
  });
  const extendInstruction = AddressLookupTableProgram.extendLookupTable({
    authority: payer.publicKey,
    payer: payer.publicKey,
    lookupTable: lookupTableAddress,
    addresses: [...preparation.addresses],
  });

  let setupSignature: string | null = null;
  let deactivationSignature: string | null = null;
  let result: Record<string, unknown> | null = null;
  let primaryError: unknown;
  let cleanupError: unknown;
  try {
    setupSignature = await sendAndConfirmTransaction(
      connection,
      new Transaction().add(
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100_000 }),
        createInstruction,
        extendInstruction,
      ),
      [payer],
      { commitment: "finalized", maxRetries: 10 },
    );
    const lookupTable = await waitUntilLookupTableIsUsable(connection, lookupTableAddress);
    const protocolLookup = (
      await connection.getAddressLookupTable(protocolLookupAddress, { commitment: "confirmed" })
    ).value;
    if (!protocolLookup) throw new Error("Protocol lookup table is unavailable");
    const snapshot = {
      quotedTokenAmount: preparation.quotedTokenAmount,
      maxQuoteAmount: preparation.maxQuoteAmount,
      lockAmount: preparation.lockAmount,
      unlockTimestamp: preparation.unlockTimestamp,
      streamflowFeePercent: preparation.streamflowFeePercent,
    };
    const plan = await buildAtomicLaunchInstructionsFromSnapshot(identity, snapshot);
    const protocolAddresses = buybackProtocolLookupAddresses(plan, WALLET);
    const latestBlockhash = await connection.getLatestBlockhash("confirmed");
    const transaction = new VersionedTransaction(new TransactionMessage({
      payerKey: WALLET,
      recentBlockhash: latestBlockhash.blockhash,
      instructions: [...plan.instructions],
    }).compileToV0Message([lookupTable, protocolLookup]));
    const syntheticWalletLookup = new AddressLookupTableAccount({
      key: lookupTable.key,
      state: { ...lookupTable.state, authority: WALLET },
    });
    validateAtomicLaunchTransaction(transaction.serialize(), {
      ...identity,
      lookupTable: syntheticWalletLookup,
      lookupAddresses: preparation.addresses,
      protocolLookupTable: protocolLookup,
      protocolLookupAddresses: protocolAddresses,
      instructions: plan.instructions,
      quotedTokenAmount: plan.quotedTokenAmount,
      maxQuoteAmount: plan.maxQuoteAmount,
      lockAmount: plan.lockAmount,
      unlockTimestamp: plan.unlockTimestamp,
      blockhash: latestBlockhash.blockhash,
    });

    const simulation = await connection.simulateTransaction(transaction, {
      commitment: "confirmed",
      sigVerify: false,
    });
    if (simulation.value.err) {
      throw new Error(`Atomic preview simulation failed: ${JSON.stringify({
        err: simulation.value.err,
        logs: simulation.value.logs,
      })}`);
    }
    result = {
      status: "ok",
      wallet: WALLET.toBase58(),
      setupSignature,
      lookupTable: lookupTableAddress.toBase58(),
      protocolLookupTable: protocolLookupAddress.toBase58(),
      lookupAddressCount: preparation.addresses.length,
      protocolAddressCount: protocolAddresses.length,
      lockDurationDays: LOCK_DURATION_DAYS,
      unlockTimestamp: plan.unlockTimestamp,
      feeLamports: config.feeLamports,
      minimumLckdOutRaw: config.feeLckdRaw,
      transactionBytes: transaction.serialize().length,
      unitsConsumed: simulation.value.unitsConsumed ?? null,
    };
  } catch (error) {
    primaryError = error;
  } finally {
    try {
      const landedLookup = (
        await connection.getAddressLookupTable(lookupTableAddress, { commitment: "confirmed" })
      ).value;
      if (landedLookup?.isActive()) {
        if (!landedLookup.state.authority?.equals(payer.publicKey)) {
          throw new Error("Temporary lookup table authority changed before cleanup");
        }
        deactivationSignature = await sendLookupInstruction(
          connection,
          payer,
          AddressLookupTableProgram.deactivateLookupTable({
            authority: payer.publicKey,
            lookupTable: lookupTableAddress,
          }),
        );
      }
    } catch (error) {
      cleanupError = error;
    }
  }

  console.log(JSON.stringify({
    ...result,
    temporaryLookupTable: lookupTableAddress.toBase58(),
    deactivationSignature,
    closeAfterSlotHashesCooldown: true,
  }, null, 2));
  if (primaryError && cleanupError) {
    throw new AggregateError([primaryError, cleanupError], "Simulation and ALT cleanup both failed");
  }
  if (primaryError) throw primaryError;
  if (cleanupError) throw cleanupError;
}

await main();
