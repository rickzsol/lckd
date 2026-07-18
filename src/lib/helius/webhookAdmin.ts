import "server-only";

import { getServerClient } from "@/lib/supabase";

// The Helius webhook address list is derived state. The active rows in
// allocation_wallets are the source of truth; sync always re-asserts the
// full set so concurrent declarations cannot drop each other's wallets
// and the daily cron self-heals any drift or manual dashboard edits.

const WEBHOOKS_BASE_URL = "https://mainnet.helius-rpc.com/v0/webhooks";
const WEBHOOK_TRANSACTION_TYPES = ["ANY"];
const REQUEST_TIMEOUT_MS = 10_000;

export interface WebhookSyncResult {
  webhookId: string;
  addressCount: number;
}

interface HeliusWebhook {
  webhookID: string;
  webhookURL: string;
  accountAddresses: string[];
  active?: boolean;
}

export class WebhookAdminError extends Error {}

function getWebhookEnv(): { apiKey: string; receiverUrl: string; authSecret: string } {
  const apiKey = process.env.HELIUS_API_KEY;
  const receiverUrl = process.env.HELIUS_WEBHOOK_URL;
  const authSecret = process.env.HELIUS_WEBHOOK_SECRET;
  if (!apiKey || !receiverUrl || !authSecret) {
    throw new WebhookAdminError(
      "Missing HELIUS_API_KEY, HELIUS_WEBHOOK_URL, or HELIUS_WEBHOOK_SECRET",
    );
  }
  return { apiKey, receiverUrl, authSecret };
}

async function heliusRequest<T>(
  apiKey: string,
  path: string,
  init: Omit<RequestInit, "signal">,
): Promise<T> {
  const response = await fetch(`${WEBHOOKS_BASE_URL}${path}?api-key=${apiKey}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init.headers },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new WebhookAdminError(
      `Helius webhook API ${init.method ?? "GET"} ${path || "/"} failed: ${response.status} ${body.slice(0, 200)}`,
    );
  }
  return response.json() as Promise<T>;
}

function assertWebhookShape(value: unknown): HeliusWebhook {
  const webhookId = value && typeof value === "object"
    ? Reflect.get(value, "webhookID")
    : null;
  const addresses = value && typeof value === "object"
    ? Reflect.get(value, "accountAddresses")
    : null;
  if (
    typeof webhookId !== "string" ||
    !Array.isArray(addresses) ||
    addresses.some((address) => typeof address !== "string")
  ) {
    throw new WebhookAdminError("Helius webhook response has an invalid shape");
  }
  return value as unknown as HeliusWebhook;
}

async function loadTrackedAddresses(): Promise<string[]> {
  const { data, error } = await getServerClient()
    .from("allocation_wallets")
    .select("wallet_address")
    .eq("status", "active");
  if (error) {
    throw new WebhookAdminError(`Tracked wallet query failed: ${error.message}`);
  }
  const unique = new Set<string>();
  for (const row of data ?? []) unique.add(row.wallet_address);
  return [...unique].sort();
}

async function loadWebhookState(): Promise<string | null> {
  const { data, error } = await getServerClient()
    .from("helius_webhook_state")
    .select("webhook_id")
    .maybeSingle();
  if (error) {
    throw new WebhookAdminError(`Webhook state query failed: ${error.message}`);
  }
  return data?.webhook_id ?? null;
}

async function saveWebhookState(
  webhookId: string,
  addressCount: number,
  isVerified: boolean,
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await getServerClient()
    .from("helius_webhook_state")
    .upsert({
      id: true,
      webhook_id: webhookId,
      address_count: addressCount,
      last_verified_at: isVerified ? now : null,
      updated_at: now,
    });
  if (error) {
    throw new WebhookAdminError(`Webhook state persist failed: ${error.message}`);
  }
}

function sameAddressSet(current: string[], expected: string[]): boolean {
  if (current.length !== expected.length) return false;
  const currentSet = new Set(current);
  return expected.every((address) => currentSet.has(address));
}

/**
 * Ensure the shared Helius enhanced webhook exists and carries exactly the
 * active allocation wallets. Called after a declaration commits and from
 * the reconciliation cron; safe to call concurrently because it always
 * writes the full set read from the database.
 */
export async function syncTrackedWallets(): Promise<WebhookSyncResult> {
  const { apiKey, receiverUrl, authSecret } = getWebhookEnv();
  const addresses = await loadTrackedAddresses();
  const webhookId = await loadWebhookState();

  const body = JSON.stringify({
    webhookURL: receiverUrl,
    transactionTypes: WEBHOOK_TRANSACTION_TYPES,
    accountAddresses: addresses,
    webhookType: "enhanced",
    authHeader: authSecret,
    txnStatus: "success",
  });

  if (!webhookId) {
    if (addresses.length === 0) return { webhookId: "", addressCount: 0 };
    const created = assertWebhookShape(
      await heliusRequest(apiKey, "", { method: "POST", body }),
    );
    await saveWebhookState(created.webhookID, addresses.length, true);
    return { webhookId: created.webhookID, addressCount: addresses.length };
  }

  const existing = assertWebhookShape(
    await heliusRequest(apiKey, `/${webhookId}`, { method: "GET" }),
  );
  const needsUpdate =
    !sameAddressSet(existing.accountAddresses, addresses) ||
    existing.webhookURL !== receiverUrl;
  if (needsUpdate) {
    assertWebhookShape(
      await heliusRequest(apiKey, `/${webhookId}`, { method: "PUT", body }),
    );
  }
  if (existing.active === false) {
    await heliusRequest(apiKey, `/${webhookId}`, {
      method: "PATCH",
      body: JSON.stringify({ active: true }),
    });
  }
  await saveWebhookState(webhookId, addresses.length, true);
  return { webhookId, addressCount: addresses.length };
}
