import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  getAccount,
  NATIVE_MINT,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { PUMP_AMM_PROGRAM_ID, PUMP_AMM_SDK, userVolumeAccumulatorPda } from "@pump-fun/pump-swap-sdk";
import {
  AddressLookupTableAccount,
  AddressLookupTableProgram,
  ComputeBudgetProgram,
  Connection,
  Keypair,
  PublicKey,
  TransactionMessage,
  type TransactionInstruction,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  BUYBACK_BURN_PROGRAM_ID,
  LCKD_MINT,
  deriveBuybackBurnAtas,
  deriveBuybackBurnAuthority,
} from "../../../src/lib/solana/buybackBurn";
import { buildBuybackBurnInstruction } from "../../../src/lib/solana/buybackBurn.server";
import {
  canonicalLookupAddresses,
  hashLookupAddresses,
  validateProtocolLookupTable,
} from "../../../src/lib/solana/lookupTable";

const MAINNET_GENESIS_HASH = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const EXPECTED_VECTOR_HASH = "cd15f424c5f4e4737b648e84b1849db06e1a74f9126a7c1af3ceb0c636898f3a";
const EXPECTED_PROGRAM_HASH = "2d2126842fbf7ce3db71fd0494ea5c8e2803cc471c18865c3622d0bb5bfc4796";
const UPGRADEABLE_LOADER = new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111");
const USER_VOLUME_DISCRIMINATOR = Buffer.from([86, 255, 112, 14, 102, 53, 154, 250]);
const USER_VOLUME_LEN = 137;
const COMPUTE_UNIT_PRICE = 100_000;

const isSend = process.argv.includes("--send");
const lookupTableArgument = process.argv.find((argument) => argument.startsWith("--lookup-table="));
const configuredLookupTable = lookupTableArgument?.slice("--lookup-table=".length)
  ?? process.env.BUYBACK_BURN_LOOKUP_TABLE;
const rpcUrl = process.env.NEXT_PUBLIC_HELIUS_RPC_URL;
if (!rpcUrl) throw new Error("NEXT_PUBLIC_HELIUS_RPC_URL is required");

const payerPath = process.env.SOLANA_DEPLOYER_KEYPAIR ?? join(homedir(), ".config", "solana", "id.json");
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(payerPath, "utf8"))));
const connection = new Connection(rpcUrl, "confirmed");
const authority = deriveBuybackBurnAuthority(BUYBACK_BURN_PROGRAM_ID);
const atas = deriveBuybackBurnAtas(authority);
const userVolume = userVolumeAccumulatorPda(authority);

await assertMainnetProgram();
const setupSignature = await initializeProtocolAccounts();
const lookupTable = await createProtocolLookupTable();

console.log(JSON.stringify({
  mode: isSend ? "sent" : "simulated",
  payer: payer.publicKey.toBase58(),
  programId: BUYBACK_BURN_PROGRAM_ID.toBase58(),
  authority: authority.toBase58(),
  lckdAta: atas.lckd.toBase58(),
  wsolAta: atas.wsol.toBase58(),
  userVolume: userVolume.toBase58(),
  setupSignature,
  lookupTable: lookupTable.address.toBase58(),
  lookupTableSignature: lookupTable.signature,
  vectorHash: lookupTable.vectorHash,
}, null, 2));

async function assertMainnetProgram(): Promise<void> {
  if (await connection.getGenesisHash() !== MAINNET_GENESIS_HASH) throw new Error("RPC is not Solana mainnet");
  const program = await connection.getAccountInfo(BUYBACK_BURN_PROGRAM_ID, "confirmed");
  if (
    !program?.executable ||
    !program.owner.equals(UPGRADEABLE_LOADER) ||
    program.data.length !== 36 ||
    program.data.readUInt32LE(0) !== 2
  ) {
    throw new Error("Buyback program is not a canonical upgradeable program");
  }
  const programDataAddress = new PublicKey(program.data.subarray(4, 36));
  const programData = await connection.getAccountInfo(programDataAddress, "confirmed");
  if (
    !programData?.owner.equals(UPGRADEABLE_LOADER) ||
    programData.data.length < 45 ||
    programData.data.readUInt32LE(0) !== 3
  ) {
    throw new Error("Buyback ProgramData account is invalid");
  }
  const executableHash = createHash("sha256").update(programData.data.subarray(45)).digest("hex");
  if (executableHash !== EXPECTED_PROGRAM_HASH) {
    throw new Error(`Buyback program hash mismatch: ${executableHash}`);
  }
}

async function initializeProtocolAccounts(): Promise<string | null> {
  const [lckdInfo, wsolInfo, userVolumeInfo] = await connection.getMultipleAccountsInfo(
    [atas.lckd, atas.wsol, userVolume],
    "confirmed",
  );
  const instructions = [];
  if (!lckdInfo) {
    instructions.push(createAssociatedTokenAccountIdempotentInstruction(
      payer.publicKey,
      atas.lckd,
      authority,
      LCKD_MINT,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    ));
  } else {
    await assertTokenAccount(atas.lckd, LCKD_MINT, authority, TOKEN_2022_PROGRAM_ID, 170);
  }
  if (!wsolInfo) {
    instructions.push(createAssociatedTokenAccountIdempotentInstruction(
      payer.publicKey,
      atas.wsol,
      authority,
      NATIVE_MINT,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    ));
  } else {
    await assertTokenAccount(atas.wsol, NATIVE_MINT, authority, TOKEN_PROGRAM_ID, 165);
  }
  if (!userVolumeInfo) {
    instructions.push(await PUMP_AMM_SDK.initUserVolumeAccumulator({ payer: payer.publicKey, user: authority }));
  } else {
    assertUserVolume(userVolumeInfo.owner, userVolumeInfo.data);
  }
  if (instructions.length === 0) return null;
  return simulateOrSend(instructions, "protocol account initialization");
}

async function assertTokenAccount(
  address: PublicKey,
  mint: PublicKey,
  owner: PublicKey,
  tokenProgram: PublicKey,
  expectedLength: number,
): Promise<void> {
  const account = await getAccount(connection, address, "confirmed", tokenProgram);
  const info = await connection.getAccountInfo(address, "confirmed");
  if (!account.mint.equals(mint) || !account.owner.equals(owner) || info?.data.length !== expectedLength) {
    throw new Error(`Token account ${address.toBase58()} is not canonical`);
  }
}

function assertUserVolume(owner: PublicKey, data: Buffer): void {
  if (
    !owner.equals(PUMP_AMM_PROGRAM_ID) ||
    data.length !== USER_VOLUME_LEN ||
    !data.subarray(0, 8).equals(USER_VOLUME_DISCRIMINATOR) ||
    !new PublicKey(data.subarray(8, 40)).equals(authority)
  ) {
    throw new Error("Pump user-volume account is not canonical");
  }
}

async function createProtocolLookupTable(): Promise<{
  address: PublicKey;
  signature: string | null;
  vectorHash: string;
}> {
  const built = await buildBuybackBurnInstruction({
    connection,
    programId: BUYBACK_BURN_PROGRAM_ID,
    launcher: payer.publicKey,
    authority,
  });
  const addresses = canonicalLookupAddresses([built.instruction], [payer.publicKey]);
  const vectorHash = hashLookupAddresses(addresses);
  if (addresses.length !== 26 || vectorHash !== EXPECTED_VECTOR_HASH) {
    throw new Error(`Protocol ALT vector drifted: ${addresses.length} addresses, hash ${vectorHash}`);
  }
  if (configuredLookupTable) {
    const address = new PublicKey(configuredLookupTable);
    const response = await connection.getAddressLookupTable(address, { commitment: "confirmed" });
    if (!response.value) throw new Error("Configured protocol ALT does not exist");
    const currentSlot = await connection.getSlot("confirmed");
    validateProtocolLookupTable(response.value, address, addresses, currentSlot);
    return { address, signature: null, vectorHash };
  }
  const recentSlot = await connection.getSlot("finalized");
  const [createInstruction, address] = AddressLookupTableProgram.createLookupTable({
    authority: payer.publicKey,
    payer: payer.publicKey,
    recentSlot,
  });
  const extendInstruction = AddressLookupTableProgram.extendLookupTable({
    authority: payer.publicKey,
    payer: payer.publicKey,
    lookupTable: address,
    addresses: [...addresses],
  });
  const signature = await simulateOrSend([createInstruction, extendInstruction], "protocol ALT creation");
  if (isSend) {
    await waitForActiveLookupTable(address, addresses);
  }
  return { address, signature, vectorHash };
}

async function waitForActiveLookupTable(
  address: PublicKey,
  addresses: readonly PublicKey[],
): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = await connection.getAddressLookupTable(address, { commitment: "confirmed" });
    const currentSlot = await connection.getSlot("confirmed");
    if (response.value && currentSlot > response.value.state.lastExtendedSlot) {
      validateProtocolLookupTable(
        new AddressLookupTableAccount({ key: address, state: response.value.state }),
        address,
        addresses,
        currentSlot,
      );
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("Protocol ALT did not activate within 15 seconds");
}

async function simulateOrSend(
  instructions: readonly TransactionInstruction[],
  label: string,
): Promise<string | null> {
  const latest = await connection.getLatestBlockhash("confirmed");
  const transaction = new VersionedTransaction(new TransactionMessage({
    payerKey: payer.publicKey,
    recentBlockhash: latest.blockhash,
    instructions: [
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: COMPUTE_UNIT_PRICE }),
      ...instructions,
    ],
  }).compileToV0Message());
  transaction.sign([payer]);
  const simulation = await connection.simulateTransaction(transaction, {
    commitment: "confirmed",
    sigVerify: true,
  });
  if (simulation.value.err) {
    throw new Error(`${label} simulation failed: ${JSON.stringify(simulation.value.err)}\n${simulation.value.logs?.join("\n")}`);
  }
  console.log(`${label} simulation: ${simulation.value.unitsConsumed ?? "unknown"} CU`);
  if (!isSend) return null;
  const signature = await connection.sendRawTransaction(transaction.serialize(), {
    maxRetries: 5,
    preflightCommitment: "confirmed",
    skipPreflight: false,
  });
  const confirmation = await connection.confirmTransaction({ ...latest, signature }, "finalized");
  if (confirmation.value.err) throw new Error(`${label} failed: ${JSON.stringify(confirmation.value.err)}`);
  return signature;
}
