import { type NextRequest } from "next/server";
import { apiResponse, apiError, OPTIONS } from "@/lib/api/helpers";
import { requireLaunchCreationAccess } from "@/lib/api/launchAccess";
import { checkRateLimit } from "@/lib/api/rateLimit";
import { requireSameOrigin } from "@/lib/api/origin";

export { OPTIONS };

const MAX_FILE_SIZE = 4 * 1024 * 1024;
const MAX_REQUEST_SIZE = MAX_FILE_SIZE + 64 * 1024;
const MAX_DESCRIPTION_LENGTH = 1_000;
const ALLOWED_IMAGE_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function formString(formData: FormData, key: string): string | null {
  const value = formData.get(key);
  return typeof value === "string" ? value : null;
}

function detectImageType(bytes: Uint8Array): string | null {
  if (
    bytes.length >= 8 &&
    Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from("89504e470d0a1a0a", "hex"))
  ) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  const header = Buffer.from(bytes.subarray(0, 12));
  if (header.subarray(0, 6).toString("ascii") === "GIF87a" || header.subarray(0, 6).toString("ascii") === "GIF89a") {
    return "image/gif";
  }
  if (header.subarray(0, 4).toString("ascii") === "RIFF" && header.subarray(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  return null;
}

function optionalHttpsUrl(value: string | null): string | undefined {
  if (!value) return undefined;
  if (value.length > 500) throw new Error("Metadata links must be 500 characters or fewer");
  const parsed = new URL(value);
  if (parsed.protocol !== "https:") throw new Error("Metadata links must use HTTPS");
  return parsed.toString();
}

export async function POST(request: NextRequest) {
  const originError = requireSameOrigin(request);
  if (originError) return originError;

  const limited = await checkRateLimit(request, "upload");
  if (limited) return limited;

  const { error: authErr } = await requireLaunchCreationAccess();
  if (authErr) return authErr;

  const contentLength = Number(request.headers.get("content-length"));
  if (!Number.isSafeInteger(contentLength) || contentLength <= 0) {
    return apiError("Content-Length is required", 411);
  }
  if (contentLength > MAX_REQUEST_SIZE) {
    return apiError("Upload request is too large", 413);
  }

  try {
    const formData = await request.formData();

    const fileValue = formData.get("file");
    const file = fileValue instanceof File ? fileValue : null;
    const name = formString(formData, "name");
    const symbol = formString(formData, "symbol");
    const description = formString(formData, "description") ?? "";
    const twitter = formString(formData, "twitter");
    const telegram = formString(formData, "telegram");
    const website = formString(formData, "website");

    if (!file) return apiError("file is required", 400);
    if (!process.env.PINATA_JWT) return apiError("Metadata storage is unavailable", 503);
    if (file.size === 0) return apiError("file must not be empty", 400);
    if (file.size > MAX_FILE_SIZE) return apiError("file must be under 4MB", 400);
    if (!name || name.trim().length === 0) return apiError("name is required", 400);
    if (name.trim().length > 32) return apiError("name must be 32 characters or fewer", 400);
    if (!symbol || symbol.trim().length === 0) return apiError("symbol is required", 400);
    if (symbol.trim().length > 13) return apiError("symbol must be 13 characters or fewer", 400);
    if (description.length > MAX_DESCRIPTION_LENGTH) {
      return apiError("description must be 1000 characters or fewer", 400);
    }

    let metadataLinks: {
      twitter?: string;
      telegram?: string;
      website?: string;
    };
    try {
      metadataLinks = {
        twitter: optionalHttpsUrl(twitter),
        telegram: optionalHttpsUrl(telegram),
        website: optionalHttpsUrl(website),
      };
    } catch (error) {
      return apiError(error instanceof Error ? error.message : "Invalid metadata URL", 400);
    }

    const { uploadToIPFS } = await import("@/lib/solana/ipfs");

    const bytes = new Uint8Array(await file.arrayBuffer());
    const detectedType = detectImageType(bytes);
    if (!detectedType || !ALLOWED_IMAGE_TYPES.has(detectedType) || detectedType !== file.type) {
      return apiError("file contents must match a PNG, JPEG, GIF, or WebP image", 400);
    }
    const freshFile = new File(
      [bytes],
      `token-image.${IMAGE_EXTENSIONS[detectedType]}`,
      { type: detectedType },
    );

    const upload = await uploadToIPFS(freshFile, {
      name: name.trim(),
      symbol: symbol.trim(),
      description,
      ...metadataLinks,
    });

    return apiResponse(upload, 201);
  } catch (err) {
    console.error("[metadata/upload] Error:", err instanceof Error ? err.message : err);
    return apiError("Upload failed", 500);
  }
}
