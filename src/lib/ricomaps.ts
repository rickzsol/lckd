import "server-only";

import { z } from "zod";
import { isValidSolanaAddress } from "@/lib/api/validation";
import { getRicomapsFixture } from "@/lib/ricomaps.fixtures";
import { summarySchema, type RicomapsResult, type RicomapsSummary } from "@/lib/ricomaps.types";

export type { RicomapsHolder, RicomapsSummary, RicomapsStatus, RicomapsResult } from "@/lib/ricomaps.types";
export { riskLevelColor, truncateAddress } from "@/lib/ricomaps.types";

const FETCH_TIMEOUT_MS = 3_000;
const MAX_RESPONSE_BYTES = 256 * 1_024;
const MAX_HOLDER_ADDRESS_LENGTH = 64;

function unavailable(): RicomapsResult {
  return { status: "unavailable", scannedAt: null, expiresAt: null, retryAfterSeconds: null, data: null };
}

function isFixtureModeEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.RICOMAPS_FIXTURES === "1";
}

async function readBodyWithCap(response: Response, signal: AbortSignal): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return response.text();

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  const decoder = new TextDecoder();

  try {
    while (true) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        totalBytes += value.byteLength;
        if (totalBytes > MAX_RESPONSE_BYTES) {
          throw new Error("Response exceeded size cap");
        }
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock();
  }

  return chunks.map((chunk) => decoder.decode(chunk, { stream: true })).join("") + decoder.decode();
}

async function fetchIntelBody(url: string, apiKey: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`upstream returned ${response.status}`);
    }
    return await readBodyWithCap(response, controller.signal);
  } finally {
    clearTimeout(timeout);
  }
}

function dedupeValidHolders(holders: RicomapsSummary["topHolders"]): RicomapsSummary["topHolders"] {
  const seen = new Set<string>();
  const result: RicomapsSummary["topHolders"] = [];
  for (const holder of holders) {
    if (holder.address.length === 0 || holder.address.length > MAX_HOLDER_ADDRESS_LENGTH) continue;
    if (!isValidSolanaAddress(holder.address)) continue;
    if (seen.has(holder.address)) continue;
    seen.add(holder.address);
    result.push(holder);
  }
  return result;
}

/**
 * Fetches holder intelligence for a mint from the ricomaps API.
 * Never fabricates data on failure: returns { status: "unavailable", data: null }.
 */
export async function fetchHolderIntel(mintAddress: string): Promise<RicomapsResult> {
  if (!isValidSolanaAddress(mintAddress)) return unavailable();

  if (isFixtureModeEnabled()) {
    const fixture = getRicomapsFixture(mintAddress);
    if (fixture) return fixture;
  }

  const baseUrl = process.env.RICOMAPS_API_URL;
  const apiKey = process.env.RICOMAPS_API_KEY;
  if (!baseUrl || !apiKey) return unavailable();

  let rawBody: string;
  try {
    const url = new URL(`/api/v1/intel/token/${encodeURIComponent(mintAddress)}/summary`, baseUrl);
    rawBody = await fetchIntelBody(url.toString(), apiKey);
  } catch (error) {
    console.error("[ricomaps] fetch failed:", error instanceof Error ? error.message : "Unknown error");
    return unavailable();
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
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
      retryAfterSeconds: z.number().int().min(0).optional(),
    })
    .passthrough()
    .safeParse(json);
  if (!envelope.success || !envelope.data.success) return unavailable();

  if (envelope.data.pending) {
    return {
      status: "pending",
      scannedAt: null,
      expiresAt: null,
      retryAfterSeconds: envelope.data.retryAfterSeconds ?? 5,
      data: null,
    };
  }

  const parsed = summarySchema.safeParse(json);
  if (!parsed.success) {
    console.error("[ricomaps] summary schema mismatch");
    return unavailable();
  }

  return {
    status: envelope.data.stale ? "stale" : "fresh",
    scannedAt: envelope.data.scannedAt ?? null,
    expiresAt: envelope.data.expiresAt ?? null,
    retryAfterSeconds: null,
    data: { ...parsed.data, topHolders: dedupeValidHolders(parsed.data.topHolders) },
  };
}
