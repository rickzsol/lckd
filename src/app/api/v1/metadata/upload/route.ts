import { type NextRequest } from "next/server";
import { apiResponse, apiError, OPTIONS } from "@/lib/api/helpers";

export { OPTIONS };

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();

    const file = formData.get("file") as File | null;
    const name = formData.get("name") as string | null;
    const symbol = formData.get("symbol") as string | null;
    const description = (formData.get("description") as string) ?? "";
    const twitter = formData.get("twitter") as string | null;
    const telegram = formData.get("telegram") as string | null;
    const website = formData.get("website") as string | null;

    if (!file) return apiError("file is required", 400);
    if (file.size > 4 * 1024 * 1024) return apiError("file must be under 4MB", 400);
    if (!name || name.trim().length === 0) return apiError("name is required", 400);
    if (!symbol || symbol.trim().length === 0) return apiError("symbol is required", 400);

    const { uploadToIPFS } = await import("@/lib/solana/ipfs");

    const metadataUri = await uploadToIPFS(file, {
      name: name.trim(),
      symbol: symbol.trim(),
      description,
      twitter: twitter ?? undefined,
      telegram: telegram ?? undefined,
      website: website ?? undefined,
    });

    return apiResponse({ metadataUri }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed";
    console.error("[metadata/upload] Error:", message, err);
    return apiError(message, 500);
  }
}
