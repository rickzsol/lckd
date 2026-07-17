/**
 * Helius enhanced-webhook registration / edit helper for lock tracking.
 *
 * The webhook is scoped to TRACKED ADDRESSES (LCKD stream metadata accounts +
 * escrow ATAs), never a program-wide ANY subscription, so we are not billed for
 * every Streamflow event in the ecosystem. Each edit costs 100 credits, so edits
 * are batched: this tool reads all current tracked addresses from `locks`, dedups
 * them, and does a single create-or-edit.
 *
 * This is a TOOL, not a route, and is NEVER auto-run: registering/editing a
 * Helius webhook spends credits. Run manually once addresses change materially.
 *
 * Usage:
 *   HELIUS_API_KEY=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   HELIUS_WEBHOOK_URL=https://lckd.tech/api/v1/webhooks/helius \
 *   HELIUS_WEBHOOK_SECRET=... \
 *   npx tsx tools/register-helius-webhook.ts [--webhook-id ID] [--dry-run]
 *
 * Without --webhook-id it creates a new webhook and prints the id; with it, the
 * webhook is edited in place (address set replaced). The authHeader is set to the
 * bearer the receiver constant-time checks (HELIUS_WEBHOOK_SECRET).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const HELIUS_API = "https://api.helius.xyz/v0/webhooks";
export const MAX_ADDRESSES = 100_000; // Helius per-webhook address ceiling.

/**
 * Enforces the Helius per-webhook ceiling without silent truncation. A slice
 * would report success while leaving the remainder unmonitored (finding 14), so
 * an over-ceiling set throws with a shard instruction instead.
 */
export function enforceAddressCeiling(addresses: string[]): string[] {
  if (addresses.length > MAX_ADDRESSES) {
    throw new Error(
      `Tracked address count ${addresses.length} exceeds the Helius per-webhook ceiling ` +
        `of ${MAX_ADDRESSES}. Shard the addresses across multiple webhooks; refusing ` +
        `to register a partial set that would leave ${addresses.length - MAX_ADDRESSES} ` +
        `addresses unmonitored.`,
    );
  }
  return addresses;
}

interface CliArgs {
  webhookId: string | null;
  dryRun: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const idFlag = argv.indexOf("--webhook-id");
  return {
    webhookId: idFlag >= 0 ? (argv[idFlag + 1] ?? null) : null,
    dryRun: argv.includes("--dry-run"),
  };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name}`);
  return value;
}

/** Collects tracked stream + escrow addresses for all non-withdrawn locks. */
async function collectTrackedAddresses(
  supabase: SupabaseClient,
): Promise<string[]> {
  const addresses = new Set<string>();
  const pageSize = 1_000;
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("locks")
      .select("stream_id, escrow_ata")
      .neq("status", "withdrawn")
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`lock read failed: ${error.message}`);
    const rows = (data ?? []) as Array<{ stream_id: string | null; escrow_ata: string | null }>;
    for (const row of rows) {
      if (row.stream_id) addresses.add(row.stream_id);
      if (row.escrow_ata) addresses.add(row.escrow_ata);
    }
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return enforceAddressCeiling([...addresses]);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const apiKey = requireEnv("HELIUS_API_KEY");
  const supabaseUrl = requireEnv("SUPABASE_URL");
  const serviceKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const webhookUrl = requireEnv("HELIUS_WEBHOOK_URL");
  const authHeader = requireEnv("HELIUS_WEBHOOK_SECRET");

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const accountAddresses = await collectTrackedAddresses(supabase);
  console.log(`[helius-webhook] tracking ${accountAddresses.length} addresses`);

  const body = {
    webhookURL: webhookUrl,
    transactionTypes: ["ANY"],
    accountAddresses,
    webhookType: "enhanced",
    authHeader,
  };

  if (args.dryRun) {
    console.log("[helius-webhook] dry run, not sending. payload summary:", {
      webhookURL: webhookUrl,
      addressCount: accountAddresses.length,
      mode: args.webhookId ? `edit ${args.webhookId}` : "create",
    });
    return;
  }

  const endpoint = args.webhookId
    ? `${HELIUS_API}/${args.webhookId}?api-key=${apiKey}`
    : `${HELIUS_API}?api-key=${apiKey}`;
  const method = args.webhookId ? "PUT" : "POST";

  const response = await fetch(endpoint, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Helius ${method} failed (${response.status}): ${text}`);
  }
  const result = (await response.json()) as { webhookID?: string };
  console.log(`[helius-webhook] ${method} ok. webhookID=${result.webhookID ?? args.webhookId}`);
}

// Only auto-run when invoked directly (tsx tools/...), never when imported by a
// test that exercises the exported helpers.
const entry = process.argv[1] ?? "";
if (entry.includes("register-helius-webhook") && !entry.includes(".test")) {
  main().catch((error) => {
    console.error("[helius-webhook] fatal:", error);
    process.exit(1);
  });
}
