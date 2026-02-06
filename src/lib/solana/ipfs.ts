import { PUMPFUN_IPFS_URL } from "./constants";

export interface TokenMetadataInput {
  name: string;
  symbol: string;
  description: string;
  twitter?: string;
  telegram?: string;
  website?: string;
}

interface IPFSResponse {
  metadataUri: string;
}

/**
 * Uploads token image and metadata to pump.fun's IPFS endpoint.
 * Returns the metadata URI to be used in the create instruction.
 */
export async function uploadToIPFS(
  image: File,
  metadata: TokenMetadataInput,
): Promise<string> {
  if (!image) {
    throw new Error("Token image is required for IPFS upload");
  }

  if (!metadata.name || !metadata.symbol) {
    throw new Error("Token name and symbol are required");
  }

  const formData = new FormData();
  formData.append("file", image);
  formData.append("name", metadata.name);
  formData.append("symbol", metadata.symbol);
  formData.append("description", metadata.description || "");
  formData.append("showName", "true");

  if (metadata.twitter) formData.append("twitter", metadata.twitter);
  if (metadata.telegram) formData.append("telegram", metadata.telegram);
  if (metadata.website) formData.append("website", metadata.website);

  const response = await fetch(PUMPFUN_IPFS_URL, {
    method: "POST",
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "Unknown error");
    throw new Error(
      `IPFS upload failed (${response.status}): ${errorText}`,
    );
  }

  const data = (await response.json()) as IPFSResponse;

  if (!data.metadataUri) {
    throw new Error("IPFS upload succeeded but no metadataUri was returned");
  }

  return data.metadataUri;
}
