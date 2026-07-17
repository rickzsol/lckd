import "server-only";

import { z } from "zod";
import { isValidSolanaAddress } from "@/lib/api/validation";
import { getRicomapsFixture } from "@/lib/ricomaps.fixtures";
import { summarySchema, type RicomapsResult } from "@/lib/ricomaps.types";

export type { RicomapsHolder, RicomapsSummary, RicomapsStatus, RicomapsResult } from "@/lib/ricomaps.types";
export { riskLevelColor, truncateAddress } from "@/lib/ricomaps.types";

const FETCH_TIMEOUT_MS = 3_000;

function unavailable(): RicomapsResult {
  return { status: "unavailable", fetchedAt: new Date().toISOString(), expiresAt: null, data: null };
}

function isFixtureMode(): boolean {
  return process.env.RICOMAPS_FIXTURES === "1";
}

async function fetchWithTimeout(url: string, apiKey: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Fetches holder intelligence for a mint from the ricomaps API.
 * Never fabricates data on failure: returns { status: "unavailable", data: null }.
 */
export async function fetchHolderIntel(mintAddress: string): Promise<RicomapsResult> {
  if (isFixtureMode()) return getRicomapsFixture(mintAddress);

  if (!isValidSolanaAddress(mintAddress)) return unavailable();

  const baseUrl = process.env.RICOMAPS_API_URL;
  const apiKey = process.env.RICOMAPS_API_KEY;
  if (!baseUrl || !apiKey) return unavailable();

  let response: Response;
  try {
    const url = new URL(`/api/v1/intel/token/${encodeURIComponent(mintAddress)}/summary`, baseUrl);
    response = await fetchWithTimeout(url.toString(), apiKey);
  } catch {
    return unavailable();
  }

  if (!response.ok) {
    console.error(`[ricomaps] upstream returned ${response.status}`);
    return unavailable();
  }

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return unavailable();
  }

  const envelope = z
    .object({
      success: z.boolean(),
      pending: z.boolean().optional(),
      stale: z.boolean().optional(),
      scannedAt: z.string().optional(),
      expiresAt: z.string().optional(),
    })
    .passthrough()
    .safeParse(json);
  if (!envelope.success || !envelope.data.success) return unavailable();

  if (envelope.data.pending) {
    return { status: "pending", fetchedAt: new Date().toISOString(), expiresAt: null, data: null };
  }

  const parsed = summarySchema.safeParse(json);
  if (!parsed.success) {
    console.error("[ricomaps] summary schema mismatch");
    return unavailable();
  }

  return {
    status: envelope.data.stale ? "stale" : "fresh",
    fetchedAt: new Date().toISOString(),
    expiresAt: envelope.data.expiresAt ?? null,
    data: parsed.data,
  };
}
