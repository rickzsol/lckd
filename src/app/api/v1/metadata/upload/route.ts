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

    // Convert to a fresh File with explicit bytes — Node.js FormData
    // re-serialization can lose content from the original request File.
    const bytes = new Uint8Array(await file.arrayBuffer());
    const freshFile = new File([bytes], file.name, { type: file.type });

    const metadataUri = await uploadToIPFS(freshFile, {
      name: name.trim(),
      symbol: symbol.trim(),
      description,
      twitter: twitter ?? undefined,
      telegram: telegram ?? undefined,
      website: website ?? undefined,
    });

    // Resolve actual image URL from the metadata JSON
    let imageUri = metadataUri;
    try {
      const metaRes = await fetch(metadataUri);
      if (metaRes.ok) {
        const meta = await metaRes.json();
        if (meta.image) imageUri = meta.image;
      }
    } catch {
      // Fall back to metadataUri if resolution fails
    }

    return apiResponse({ metadataUri, imageUri }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upload failed";
    console.error("[metadata/upload] Error:", message, err);
    return apiError(message, 500);
  }
}
