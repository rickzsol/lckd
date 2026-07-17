import "server-only";

import { z } from "zod";
import { OnChainVerificationError } from "./onchain";

const MAX_METADATA_BYTES = 16 * 1024;
const httpsUrl = z.string().url().max(500).refine(
  (value) => new URL(value).protocol === "https:",
  "URL must use HTTPS",
);
const nullableUrl = httpsUrl.nullable().default(null);
const metadataSchema = z.object({
  name: z.string().trim().min(1).max(32),
  symbol: z.string().trim().min(1).max(13),
  description: z.string().max(1000).default(""),
  image: httpsUrl,
  twitter: nullableUrl.optional(),
  telegram: nullableUrl.optional(),
  website: nullableUrl.optional(),
}).passthrough();

function pinataGatewayOrigin(): string {
  const configured = process.env.PINATA_GATEWAY?.trim();
  if (!configured) return "https://gateway.pinata.cloud";
  const gateway = new URL(configured.startsWith("http") ? configured : `https://${configured}`);
  const isApprovedHost = gateway.hostname === "gateway.pinata.cloud" ||
    gateway.hostname.endsWith(".mypinata.cloud");
  if (gateway.protocol !== "https:" || !isApprovedHost) {
    throw new OnChainVerificationError("PINATA_GATEWAY is not an approved Pinata host", 503);
  }
  return gateway.origin;
}

async function readLimitedBody(response: Response): Promise<string> {
  if (!response.body) throw new OnChainVerificationError("Launch metadata has no body", 422);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_METADATA_BYTES) {
      await reader.cancel();
      throw new OnChainVerificationError("Launch metadata is too large", 422);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function fetchApprovedMetadata(metadataUri: string) {
  const url = new URL(metadataUri);
  if (
    url.protocol !== "https:" ||
    url.origin !== pinataGatewayOrigin() ||
    !/^\/ipfs\/[A-Za-z0-9]+$/.test(url.pathname) ||
    url.search ||
    url.hash
  ) {
    throw new OnChainVerificationError("Launch metadata URI is not an approved IPFS gateway URL", 422);
  }

  const response = await fetch(url, {
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new OnChainVerificationError("Launch metadata is unavailable", 422);
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_METADATA_BYTES) {
    throw new OnChainVerificationError("Launch metadata is too large", 422);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(await readLimitedBody(response));
  } catch (error) {
    if (error instanceof OnChainVerificationError) throw error;
    throw new OnChainVerificationError("Launch metadata is invalid JSON", 422);
  }
  const parsed = metadataSchema.safeParse(raw);
  if (!parsed.success) throw new OnChainVerificationError("Launch metadata is invalid", 422);
  return parsed.data;
}
