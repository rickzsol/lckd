import "server-only";

import { PinataSDK } from "pinata";

export interface TokenMetadataInput {
  name: string;
  symbol: string;
  description: string;
  twitter?: string;
  telegram?: string;
  website?: string;
}

export interface IPFSUploadResult {
  metadataUri: string;
  imageUri: string;
  metadataCid: string;
  imageCid: string;
}

function createPublicGatewayUrl(cid: string): string {
  const configuredGateway = process.env.PINATA_GATEWAY?.trim();
  if (!configuredGateway) return `https://gateway.pinata.cloud/ipfs/${cid}`;

  const gatewayUrl = configuredGateway.startsWith("http")
    ? configuredGateway
    : `https://${configuredGateway}`;
  return `${gatewayUrl.replace(/\/$/, "")}/ipfs/${cid}`;
}

export async function uploadToIPFS(
  image: File,
  metadata: TokenMetadataInput,
): Promise<IPFSUploadResult> {
  const pinataJwt = process.env.PINATA_JWT;
  if (!pinataJwt) throw new Error("PINATA_JWT is not configured");
  if (!image || image.size === 0) throw new Error("Token image is required");
  if (!metadata.name.trim() || !metadata.symbol.trim()) {
    throw new Error("Token name and symbol are required");
  }

  const pinata = new PinataSDK({
    pinataJwt,
    pinataGateway: process.env.PINATA_GATEWAY,
  });
  const imageUpload = await pinata.upload.public
    .file(image)
    .name(`${metadata.symbol.toLowerCase()}-${image.name}`);
  const imageUri = createPublicGatewayUrl(imageUpload.cid);
  const metadataUpload = await pinata.upload.public
    .json({
      name: metadata.name,
      symbol: metadata.symbol,
      description: metadata.description || "",
      image: imageUri,
      ...(metadata.twitter ? { twitter: metadata.twitter } : {}),
      ...(metadata.telegram ? { telegram: metadata.telegram } : {}),
      ...(metadata.website ? { website: metadata.website } : {}),
    })
    .name(`${metadata.symbol.toLowerCase()}-metadata.json`);

  return {
    metadataUri: createPublicGatewayUrl(metadataUpload.cid),
    imageUri,
    metadataCid: metadataUpload.cid,
    imageCid: imageUpload.cid,
  };
}
