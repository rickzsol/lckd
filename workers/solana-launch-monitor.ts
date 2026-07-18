import WebSocket from "ws";
import { randomUUID } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import {
  OFFICIAL_DEV_WALLET,
  type OfficialLaunchEvent,
  type OfficialLockEvent,
} from "../src/lib/launchMonitor";
import { isMintCandidateAllowed, mergeLaunchState, mergeLockState } from "../src/lib/launchMonitorState";
import { STREAMFLOW_PROGRAM_ID } from "../src/lib/solana/constants";
import { normalizeHeliusTransactionPayload } from "../src/lib/solana/heliusTransactionPayload";
import { detectPumpLaunch, hasPumpCreateLogs } from "../src/lib/solana/pumpLaunchDetection";
import { detectStreamflowLock } from "../src/lib/solana/streamflowLockDetection";
import { startLaunchMonitorHttpServer } from "./launch-monitor-http";
import { loadLaunchMonitorState, saveLaunchMonitorState } from "./launch-monitor-state-store";

const PORT = Number(process.env.PORT ?? process.env.LAUNCH_MONITOR_PORT ?? 8787);
const ALLOWED_ORIGIN = process.env.LAUNCH_MONITOR_ALLOWED_ORIGIN ?? "https://lckd.tech";
const LAUNCH_START_SLOT = Number(process.env.OFFICIAL_LAUNCH_START_SLOT ?? 433_501_410);
const CONFIGURED_TOKEN_MINT = process.env.OFFICIAL_TOKEN_MINT?.trim() || null;
const STATE_PATH = process.env.LAUNCH_MONITOR_STATE_PATH?.trim() || null;
const BACKFILL_PAGE_SIZE = 100;
const STATE_EPOCH = randomUUID();
const CONFIRM_DELAYS_MS = [250, 500, 1_000, 2_000, 4_000, 8_000, 15_000];

interface RpcEnvelope<T> {
  error?: { code: number; message: string };
  result?: T;
}

interface SignatureRow {
  err: unknown;
  signature: string;
  slot: number;
}

let latestLaunch: OfficialLaunchEvent | null;
let officialMintAddress: string | null;
let stateVersion: number;
let stream: WebSocket | null = null;
let pingTimer: NodeJS.Timeout | null = null;
let reconnectTimer: NodeJS.Timeout | null = null;
let backfillTimer: NodeJS.Timeout | null = null;
let subscriptionAckTimer: NodeJS.Timeout | null = null;
let reconnectDelayMs = 1_000;
let isShuttingDown = false;
let isSubscriptionActive = false;
let isBackfillComplete = false;
let subscriptionMode: "transaction" | "logs" = "transaction";
const checkedSignatures = new Set<string>();
const finalizedSignatures = new Set<string>();
const trackingFinality = new Set<string>();
let backfillPromise: Promise<void> | null = null;
let isStreamAlive = false;

function validateConfig() {
  if (!Number.isSafeInteger(PORT) || PORT < 1 || PORT > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  if (!Number.isSafeInteger(LAUNCH_START_SLOT) || LAUNCH_START_SLOT < 1) {
    throw new Error("OFFICIAL_LAUNCH_START_SLOT must be a positive integer");
  }
  if (CONFIGURED_TOKEN_MINT) new PublicKey(CONFIGURED_TOKEN_MINT);
  const origin = new URL(ALLOWED_ORIGIN);
  const isLocal = origin.hostname === "localhost" || origin.hostname === "127.0.0.1";
  if (origin.origin !== ALLOWED_ORIGIN || (origin.protocol !== "https:" && !isLocal)) {
    throw new Error("LAUNCH_MONITOR_ALLOWED_ORIGIN must be an HTTPS origin");
  }
}

validateConfig();

const storedState = loadLaunchMonitorState(STATE_PATH);
if (CONFIGURED_TOKEN_MINT && storedState?.launch &&
  storedState.launch.mintAddress !== CONFIGURED_TOKEN_MINT) {
  throw new Error("OFFICIAL_TOKEN_MINT does not match persisted launch state");
}
latestLaunch = storedState?.launch ?? null;
officialMintAddress = CONFIGURED_TOKEN_MINT ?? storedState?.officialMintAddress ?? null;
stateVersion = storedState?.version ?? 0;

function endpoints(): { rpc: string; websocket: string } {
  const configured = process.env.HELIUS_RPC_URL?.trim();
  const apiKey = process.env.HELIUS_API_KEY?.trim();
  const rpc = configured || (apiKey
    ? `https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(apiKey)}`
    : "");
  if (!rpc) throw new Error("HELIUS_RPC_URL or HELIUS_API_KEY is required");
  const url = new URL(rpc);
  if (url.protocol !== "https:" || url.hostname !== "mainnet.helius-rpc.com") {
    throw new Error("Launch monitor requires the Helius mainnet RPC endpoint");
  }
  url.protocol = "wss:";
  return { rpc, websocket: url.toString() };
}

const HELIUS = endpoints();

function log(level: "info" | "error", event: string, detail?: Record<string, unknown>) {
  const entry = { level, event, timestamp: new Date().toISOString(), ...detail };
  (level === "error" ? console.error : console.log)(JSON.stringify(entry));
}

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const response = await fetch(HELIUS.rpc, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Helius RPC ${method} returned ${response.status}`);
  const body = await response.json() as RpcEnvelope<T>;
  if (body.error) throw new Error(`Helius RPC ${method} failed with ${body.error.code}`);
  if (body.result === undefined) throw new Error(`Helius RPC ${method} returned no result`);
  return body.result;
}

function broadcastState() {
  stateVersion += 1;
  try {
    saveLaunchMonitorState(STATE_PATH, {
      launch: latestLaunch,
      officialMintAddress,
      version: stateVersion,
    });
  } catch (error) {
    log("error", "state_persist_failed", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
    setImmediate(shutdown);
    return;
  }
  monitorHttp.broadcast(latestLaunch);
}

function publish(event: OfficialLaunchEvent) {
  const next = mergeLaunchState(latestLaunch, event);
  if (next === latestLaunch) return;
  if (event.status === "retracted" && next === null) {
    if (!CONFIGURED_TOKEN_MINT && officialMintAddress === event.mintAddress) {
      officialMintAddress = null;
    }
  }
  latestLaunch = next;
  broadcastState();
  log("info", "launch_status", {
    mintAddress: event.mintAddress,
    signature: event.signature,
    slot: event.slot,
    status: event.status,
  });
}

function publishLock(lock: OfficialLockEvent) {
  const next = mergeLockState(latestLaunch, lock);
  if (next === latestLaunch) return;
  latestLaunch = next;
  broadcastState();
  log("info", "lock_status", {
    amountRaw: lock.amountRaw,
    signature: lock.signature,
    slot: lock.slot,
    status: lock.status,
  });
}

function launchFromTransaction(
  transaction: unknown,
  signature: string,
  slot: number,
  status: "processed" | "confirmed",
): OfficialLaunchEvent | null {
  const detected = detectPumpLaunch(transaction, OFFICIAL_DEV_WALLET);
  if (!detected || !isMintCandidateAllowed(
    CONFIGURED_TOKEN_MINT,
    officialMintAddress,
    latestLaunch,
    detected.mintAddress,
  )) return null;
  if (status === "confirmed") officialMintAddress = detected.mintAddress;
  return {
    ...detected,
    detectedAt: new Date().toISOString(),
    lock: null,
    signature,
    slot,
    status,
  };
}

function lockFromTransaction(
  transaction: unknown,
  signature: string,
  slot: number,
  status: "processed" | "confirmed",
): OfficialLockEvent | null {
  const mintAddress = latestLaunch?.mintAddress ?? officialMintAddress;
  if (!mintAddress) return null;
  const detected = detectStreamflowLock(transaction, OFFICIAL_DEV_WALLET, mintAddress);
  return detected ? {
    ...detected,
    detectedAt: new Date().toISOString(),
    signature,
    slot,
    status,
  } : null;
}

async function getTransaction(signature: string): Promise<unknown | null> {
  return rpc<unknown | null>("getTransaction", [
    signature,
    { commitment: "confirmed", encoding: "jsonParsed", maxSupportedTransactionVersion: 0 },
  ]);
}

async function getBackfillSignatures(): Promise<SignatureRow[]> {
  const rows: SignatureRow[] = [];
  const floorSlot = latestLaunch?.lock?.slot ?? latestLaunch?.slot ?? LAUNCH_START_SLOT;
  let before: string | undefined;
  while (true) {
    const options: { before?: string; commitment: string; limit: number } = {
      commitment: "confirmed",
      limit: BACKFILL_PAGE_SIZE,
    };
    if (before) options.before = before;
    const pageRows = await rpc<SignatureRow[]>("getSignaturesForAddress", [
      OFFICIAL_DEV_WALLET,
      options,
    ]);
    const inRange = pageRows.filter((row) => row.slot >= floorSlot);
    rows.push(...inRange);
    if (pageRows.length < BACKFILL_PAGE_SIZE || inRange.length < pageRows.length) break;
    before = pageRows.at(-1)?.signature;
    if (!before) break;
  }
  return rows;
}

async function runBackfill() {
  let didFail = false;
  try {
    const signatures = await getBackfillSignatures();
    const transactionCache = new Map<string, unknown | null>();
    if (!latestLaunch) {
      for (const row of signatures) {
        if (row.err) continue;
        const transaction = await getTransaction(row.signature);
        transactionCache.set(row.signature, transaction);
        const launch = launchFromTransaction(transaction, row.signature, row.slot, "confirmed");
        if (!launch) continue;
        publish(launch);
        break;
      }
    }
    if (!latestLaunch) return;
    for (const row of signatures) {
      if (row.err || checkedSignatures.has(row.signature)) continue;
      if (latestLaunch.lock?.signature === row.signature && latestLaunch.lock.status === "confirmed") return;
      if (row.slot < latestLaunch.slot) return;
      if (latestLaunch.signature === row.signature) continue;
      const transaction = transactionCache.has(row.signature)
        ? transactionCache.get(row.signature)
        : await getTransaction(row.signature);
      const lock = lockFromTransaction(transaction, row.signature, row.slot, "confirmed");
      if (!lock) {
        checkedSignatures.add(row.signature);
        if (checkedSignatures.size > 500) checkedSignatures.delete(checkedSignatures.values().next().value!);
        continue;
      }
      publishLock(lock);
      return;
    }
  } catch (error) {
    didFail = true;
    log("error", "backfill_failed", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
  } finally {
    if (!didFail) isBackfillComplete = true;
  }
}

function backfill(): Promise<void> {
  if (backfillPromise) return backfillPromise;
  backfillPromise = runBackfill().finally(() => {
    backfillPromise = null;
  });
  return backfillPromise;
}

async function isSafelyAbsent(slot: number, successfulChecks: number): Promise<boolean> {
  if (successfulChecks < 2) return false;
  const finalizedSlot = await rpc<number>("getSlot", [{ commitment: "finalized" }]);
  return finalizedSlot >= slot + 32;
}

async function trackFinality(
  event: OfficialLaunchEvent | OfficialLockEvent,
  retract: () => void,
) {
  if (trackingFinality.has(event.signature) || finalizedSignatures.has(event.signature)) return;
  trackingFinality.add(event.signature);
  let absentChecks = 0;
  try {
    while (!isShuttingDown) {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      try {
        const result = await rpc<{ value: Array<{ confirmationStatus?: string; err: unknown } | null> }>(
          "getSignatureStatuses",
          [[event.signature], { searchTransactionHistory: true }],
        );
        const status = result.value[0];
        if (status?.err) {
          retract();
          return;
        }
        if (status?.confirmationStatus === "finalized") {
          finalizedSignatures.add(event.signature);
          return;
        }
        absentChecks = status === null ? absentChecks + 1 : 0;
        if (
          await isSafelyAbsent(event.slot, absentChecks) &&
          await getTransaction(event.signature) === null
        ) {
          retract();
          return;
        }
      } catch (error) {
        log("error", "finality_check_failed", {
          message: error instanceof Error ? error.message : "Unknown error",
          signature: event.signature,
        });
      }
    }
  } finally {
    trackingFinality.delete(event.signature);
  }
}

function trackLaunchFinality(event: OfficialLaunchEvent) {
  void trackFinality(event, () => {
    if (latestLaunch?.signature === event.signature) publish({ ...event, status: "retracted" });
  });
}

function trackLockFinality(event: OfficialLockEvent) {
  void trackFinality(event, () => {
    if (latestLaunch?.lock?.signature === event.signature) publishLock({ ...event, status: "retracted" });
  });
}

async function confirmLaunch(event: OfficialLaunchEvent) {
  let successfulChecks = 0;
  for (const delay of CONFIRM_DELAYS_MS) {
    await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      const result = await rpc<{ value: Array<{ confirmationStatus?: string; err: unknown } | null> }>(
        "getSignatureStatuses",
        [[event.signature], { searchTransactionHistory: true }],
      );
      successfulChecks += 1;
      const status = result.value[0];
      if (status?.err) {
        publish({ ...event, status: "retracted" });
        return;
      }
      if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
        officialMintAddress = event.mintAddress;
        publish({ ...event, status: "confirmed" });
        if (status.confirmationStatus === "finalized") finalizedSignatures.add(event.signature);
        else trackLaunchFinality(event);
        return;
      }
    } catch (error) {
      log("error", "confirmation_check_failed", {
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
  try {
    if (
      latestLaunch?.signature === event.signature &&
      latestLaunch.status === "processed" &&
      await isSafelyAbsent(event.slot, successfulChecks) &&
      await getTransaction(event.signature) === null
    ) publish({ ...event, status: "retracted" });
  } catch (error) {
    log("error", "launch_retraction_check_failed", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

async function confirmLock(event: OfficialLockEvent) {
  let successfulChecks = 0;
  for (const delay of CONFIRM_DELAYS_MS) {
    await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      const result = await rpc<{ value: Array<{ confirmationStatus?: string; err: unknown } | null> }>(
        "getSignatureStatuses",
        [[event.signature], { searchTransactionHistory: true }],
      );
      successfulChecks += 1;
      const status = result.value[0];
      if (status?.err) {
        publishLock({ ...event, status: "retracted" });
        return;
      }
      if (status?.confirmationStatus === "confirmed" || status?.confirmationStatus === "finalized") {
        publishLock({ ...event, status: "confirmed" });
        if (status.confirmationStatus === "finalized") finalizedSignatures.add(event.signature);
        else trackLockFinality(event);
        return;
      }
    } catch (error) {
      log("error", "lock_confirmation_check_failed", {
        message: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }
  try {
    if (
      latestLaunch?.lock?.signature === event.signature &&
      latestLaunch.lock.status === "processed" &&
      await isSafelyAbsent(event.slot, successfulChecks) &&
      await getTransaction(event.signature) === null
    ) publishLock({ ...event, status: "retracted" });
  } catch (error) {
    log("error", "lock_retraction_check_failed", {
      message: error instanceof Error ? error.message : "Unknown error",
    });
  }
}

function processTransaction(
  transaction: unknown,
  signature: string,
  slot: number,
  status: "processed" | "confirmed",
) {
  const launch = launchFromTransaction(transaction, signature, slot, status);
  if (launch) {
    publish(launch);
    if (status === "processed") void confirmLaunch(launch);
    else trackLaunchFinality(launch);
  }
  const lock = lockFromTransaction(transaction, signature, slot, status);
  if (lock) {
    publishLock(lock);
    if (status === "processed") void confirmLock(lock);
    else trackLockFinality(lock);
  }
}

async function discoverFromLogs(signature: string, slot: number) {
  for (const delay of CONFIRM_DELAYS_MS) {
    await new Promise((resolve) => setTimeout(resolve, delay));
    try {
      const transaction = await getTransaction(signature);
      if (!transaction) continue;
      processTransaction(transaction, signature, slot, "confirmed");
      return;
    } catch {
      continue;
    }
  }
  void backfill();
}

function handleNotification(message: unknown) {
  if (!message || typeof message !== "object") return;
  const method = Reflect.get(message, "method");
  const params = Reflect.get(message, "params");
  const result = params && typeof params === "object" ? Reflect.get(params, "result") : null;
  if (!result || typeof result !== "object") return;

  if (method === "logsNotification") {
    const value = Reflect.get(result, "value");
    const slotContext = Reflect.get(result, "context");
    if (!value || typeof value !== "object" || !slotContext || typeof slotContext !== "object") return;
    const signature = Reflect.get(value, "signature");
    const logs = Reflect.get(value, "logs");
    const slot = Reflect.get(slotContext, "slot");
    if (
      typeof signature === "string" &&
      typeof slot === "number" &&
      Array.isArray(logs) &&
      logs.every((log) => typeof log === "string") &&
      (hasPumpCreateLogs(logs) ||
        logs.some((log) => log.includes(`Program ${STREAMFLOW_PROGRAM_ID.toBase58()} invoke`)))
    ) void discoverFromLogs(signature, slot);
    return;
  }
  if (method !== "transactionNotification") return;
  const signature = Reflect.get(result, "signature");
  const slot = Reflect.get(result, "slot");
  const transaction = Reflect.get(result, "transaction");
  if (typeof signature !== "string" || typeof slot !== "number" || !transaction) return;
  const parsedTransaction = normalizeHeliusTransactionPayload(transaction);
  if (!parsedTransaction) return;
  processTransaction(parsedTransaction, signature, slot, "processed");
}

function scheduleReconnect() {
  if (isShuttingDown || reconnectTimer) return;
  const jitter = Math.floor(Math.random() * Math.min(reconnectDelayMs / 4, 1_000));
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectStream();
  }, reconnectDelayMs + jitter);
  reconnectDelayMs = Math.min(reconnectDelayMs * 2, 30_000);
}

function connectStream() {
  stream = new WebSocket(HELIUS.websocket);
  stream.on("open", () => {
    isSubscriptionActive = false;
    subscriptionMode = "transaction";
    isStreamAlive = true;
    stream?.send(JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "transactionSubscribe",
      params: [
        {
          accountInclude: [OFFICIAL_DEV_WALLET],
          failed: false,
          vote: false,
        },
        {
          commitment: "processed",
          encoding: "jsonParsed",
          maxSupportedTransactionVersion: 0,
          showRewards: false,
          transactionDetails: "full",
        },
      ],
    }));
    subscriptionAckTimer = setTimeout(() => {
      if (!isSubscriptionActive) stream?.terminate();
    }, 10_000);
    pingTimer = setInterval(() => {
      if (!stream) return;
      if (!isStreamAlive) {
        stream.terminate();
        return;
      }
      isStreamAlive = false;
      stream.ping();
    }, 30_000);
    log("info", "stream_connected");
    void backfill();
  });
  stream.on("pong", () => {
    isStreamAlive = true;
  });
  stream.on("message", (data) => {
    try {
      const message = JSON.parse(data.toString()) as unknown;
      if (message && typeof message === "object" && Reflect.get(message, "error")) {
        const error = Reflect.get(message, "error");
        log("error", "subscription_error", {
          code: error && typeof error === "object" ? Reflect.get(error, "code") : "unknown",
        });
        if (subscriptionMode === "transaction") {
          if (subscriptionAckTimer) clearTimeout(subscriptionAckTimer);
          subscriptionMode = "logs";
          stream?.send(JSON.stringify({
            jsonrpc: "2.0",
            id: 2,
            method: "logsSubscribe",
            params: [
              { mentions: [OFFICIAL_DEV_WALLET] },
              { commitment: "processed" },
            ],
          }));
          subscriptionAckTimer = setTimeout(() => {
            if (!isSubscriptionActive) stream?.terminate();
          }, 10_000);
        } else {
          stream?.close();
        }
        return;
      }
      if (
        message &&
        typeof message === "object" &&
        typeof Reflect.get(message, "result") === "number"
      ) {
        isSubscriptionActive = true;
        reconnectDelayMs = 1_000;
        if (subscriptionAckTimer) clearTimeout(subscriptionAckTimer);
        subscriptionAckTimer = null;
      }
      handleNotification(message);
    } catch {
      log("error", "invalid_stream_message");
    }
  });
  stream.on("error", () => log("error", "stream_error"));
  stream.on("close", () => {
    if (pingTimer) clearInterval(pingTimer);
    if (subscriptionAckTimer) clearTimeout(subscriptionAckTimer);
    pingTimer = null;
    subscriptionAckTimer = null;
    stream = null;
    isStreamAlive = false;
    isSubscriptionActive = false;
    log("error", "stream_closed");
    scheduleReconnect();
  });
}

const monitorHttp = startLaunchMonitorHttpServer({
  allowedOrigin: ALLOWED_ORIGIN,
  epoch: STATE_EPOCH,
  getHealth: () => ({
    connected: stream?.readyState === WebSocket.OPEN,
    ready: isBackfillComplete && isSubscriptionActive,
    subscribed: isSubscriptionActive,
    subscriptionMode,
  }),
  getLatest: () => latestLaunch,
  getVersion: () => stateVersion,
  monitoredWallet: OFFICIAL_DEV_WALLET,
  onListening: () => {
    log("info", "server_listening", { port: PORT });
    if (latestLaunch?.status === "processed") void confirmLaunch(latestLaunch);
    else if (latestLaunch?.status === "confirmed") trackLaunchFinality(latestLaunch);
    if (latestLaunch?.lock?.status === "processed") void confirmLock(latestLaunch.lock);
    else if (latestLaunch?.lock?.status === "confirmed") trackLockFinality(latestLaunch.lock);
    connectStream();
    backfillTimer = setInterval(backfill, 10_000);
  },
  port: PORT,
});

function shutdown() {
  isShuttingDown = true;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (pingTimer) clearInterval(pingTimer);
  if (backfillTimer) clearInterval(backfillTimer);
  if (subscriptionAckTimer) clearTimeout(subscriptionAckTimer);
  stream?.close();
  monitorHttp.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
