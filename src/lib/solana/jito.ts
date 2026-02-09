import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import bs58 from "bs58";

// ─── Jito Tip Accounts ──────────────────────────────────────────────────────
// These are the official Jito tip accounts. Pick one at random to reduce contention.
const JITO_TIP_ACCOUNTS = [
  "96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5",
  "HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe",
  "Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY",
  "ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49",
  "DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh",
  "ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt",
  "DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL",
  "3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT",
];

// ─── Regional Endpoints ─────────────────────────────────────────────────────
// Rotate across regions to avoid per-region rate limits (1 req/s/IP/region).
const JITO_ENDPOINTS = [
  "https://mainnet.block-engine.jito.wtf",
  "https://ny.mainnet.block-engine.jito.wtf",
  "https://amsterdam.mainnet.block-engine.jito.wtf",
  "https://frankfurt.mainnet.block-engine.jito.wtf",
  "https://tokyo.mainnet.block-engine.jito.wtf",
];

// Default tip: 50,000 lamports (0.00005 SOL) — above the 75th percentile floor.
const DEFAULT_TIP_LAMPORTS = 50_000;

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1200; // slightly over 1s to respect rate limits

// ─── Helpers ────────────────────────────────────────────────────────────────

function getRandomTipAccount(): PublicKey {
  const idx = Math.floor(Math.random() * JITO_TIP_ACCOUNTS.length);
  return new PublicKey(JITO_TIP_ACCOUNTS[idx]);
}

function getRandomEndpoint(): string {
  const idx = Math.floor(Math.random() * JITO_ENDPOINTS.length);
  return JITO_ENDPOINTS[idx];
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Creates a Jito tip instruction (SOL transfer to a random tip account).
 * Add this as the LAST instruction in the LAST transaction of a bundle.
 */
export function createJitoTipInstruction(
  payer: PublicKey,
  lamports: number = DEFAULT_TIP_LAMPORTS,
): TransactionInstruction {
  return SystemProgram.transfer({
    fromPubkey: payer,
    toPubkey: getRandomTipAccount(),
    lamports,
  });
}

// ─── Send Single Transaction via Jito ───────────────────────────────────────

export interface JitoSendResult {
  signature: string;
  bundleId: string | null;
}

/**
 * Sends a single serialized transaction via Jito's sendTransaction endpoint.
 * Provides MEV protection and faster landing via Jito validators (~95% stake).
 *
 * Includes retry logic across multiple regional endpoints to handle rate limits.
 * Falls back to null if all attempts fail (caller should fall back to regular RPC).
 */
export async function sendViaJito(
  serializedTx: Uint8Array | Buffer,
): Promise<JitoSendResult | null> {
  const encoded = bs58.encode(
    serializedTx instanceof Buffer ? new Uint8Array(serializedTx) : serializedTx,
  );

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const endpoint = attempt === 0 ? JITO_ENDPOINTS[0] : getRandomEndpoint();

    try {
      const res = await fetch(`${endpoint}/api/v1/transactions?bundleOnly=true`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "sendTransaction",
          params: [encoded],
        }),
      });

      if (res.status === 429) {
        // Rate limited — wait and try a different region
        await sleep(RETRY_DELAY_MS * (attempt + 1));
        continue;
      }

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        console.warn(`Jito sendTransaction ${res.status}: ${text}`);
        await sleep(RETRY_DELAY_MS);
        continue;
      }

      const json = await res.json();
      if (json.error) {
        console.warn("Jito sendTransaction error:", json.error.message);
        // Don't retry on application-level errors (bad TX)
        return null;
      }

      const bundleId = res.headers.get("x-bundle-id");
      return { signature: json.result, bundleId };
    } catch (err) {
      console.warn(`Jito attempt ${attempt + 1} failed:`, err);
      if (attempt < MAX_RETRIES - 1) {
        await sleep(RETRY_DELAY_MS * (attempt + 1));
      }
    }
  }

  return null; // All Jito attempts failed — caller should fall back
}

// ─── Send Bundle via Jito ───────────────────────────────────────────────────

/**
 * Sends a bundle of serialized transactions via Jito's sendBundle endpoint.
 * Transactions execute atomically — all succeed or all fail.
 * Max 5 transactions per bundle. The last TX must include a Jito tip.
 *
 * Returns the bundle ID for status polling, or null if all attempts fail.
 */
export async function sendJitoBundle(
  serializedTxs: (Uint8Array | Buffer)[],
): Promise<string | null> {
  const encoded = serializedTxs.map((tx) =>
    bs58.encode(tx instanceof Buffer ? new Uint8Array(tx) : tx),
  );

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const endpoint = attempt === 0 ? JITO_ENDPOINTS[0] : getRandomEndpoint();

    try {
      const res = await fetch(`${endpoint}/api/v1/bundles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "sendBundle",
          params: [encoded],
        }),
      });

      if (res.status === 429) {
        await sleep(RETRY_DELAY_MS * (attempt + 1));
        continue;
      }

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        console.warn(`Jito sendBundle ${res.status}: ${text}`);
        await sleep(RETRY_DELAY_MS);
        continue;
      }

      const json = await res.json();
      if (json.error) {
        console.warn("Jito sendBundle error:", json.error.message);
        return null;
      }

      return json.result as string; // bundle ID
    } catch (err) {
      console.warn(`Jito bundle attempt ${attempt + 1} failed:`, err);
      if (attempt < MAX_RETRIES - 1) {
        await sleep(RETRY_DELAY_MS * (attempt + 1));
      }
    }
  }

  return null;
}

// ─── Poll Bundle Status ─────────────────────────────────────────────────────

export type BundleLandingStatus = "Landed" | "Failed" | "Pending" | "Unknown";

/**
 * Polls Jito for bundle landing status. Returns when landed, failed, or timeout.
 *
 * @param bundleId - Bundle ID from sendBundle or x-bundle-id header
 * @param timeoutMs - Max polling time (default 60s)
 * @param pollIntervalMs - Time between polls (default 3s)
 */
export async function pollJitoBundleStatus(
  bundleId: string,
  timeoutMs = 60_000,
  pollIntervalMs = 3_000,
): Promise<BundleLandingStatus> {
  // Wait a bit before first poll — bundles take at least a slot to process
  await sleep(5_000);

  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    try {
      const endpoint = getRandomEndpoint();
      const res = await fetch(`${endpoint}/api/v1/bundles`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getInflightBundleStatuses",
          params: [[bundleId]],
        }),
      });

      if (res.status === 429) {
        await sleep(RETRY_DELAY_MS);
        continue;
      }

      if (res.ok) {
        const json = await res.json();
        const statuses = json?.result?.value;
        if (statuses && statuses.length > 0) {
          const status = statuses[0]?.status;
          if (status === "Landed") return "Landed";
          if (status === "Failed") return "Failed";
        }
      }
    } catch {
      // Ignore polling errors — just retry
    }

    await sleep(pollIntervalMs);
  }

  return "Unknown";
}

/**
 * Fetches the current Jito tip floor (50th percentile) in lamports.
 * Returns DEFAULT_TIP_LAMPORTS on failure.
 */
export async function getJitoTipFloor(): Promise<number> {
  try {
    const res = await fetch("https://bundles.jito.wtf/api/v1/bundles/tip_floor", {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return DEFAULT_TIP_LAMPORTS;

    const data = await res.json();
    // 75th percentile in SOL — convert to lamports
    const tipSol = data?.[0]?.landed_tips_75th_percentile ?? 0.00005;
    const tipLamports = Math.ceil(tipSol * 1_000_000_000);
    // Floor at 10,000 lamports, cap at 1M lamports (0.001 SOL)
    return Math.max(10_000, Math.min(tipLamports, 1_000_000));
  } catch {
    return DEFAULT_TIP_LAMPORTS;
  }
}
