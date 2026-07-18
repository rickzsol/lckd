import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";
import {
  isOfficialTokenMint,
  OFFICIAL_TOKEN_METADATA,
  OFFICIAL_TOKEN_PATH,
} from "@/lib/officialTokenRoute";
import { getTokenByIdOrMint } from "@/lib/queries";
import TokenDetailClient from "./TokenDetailClient";

export const revalidate = 60;

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  if (isOfficialTokenMint(id, null)) {
    return OFFICIAL_TOKEN_METADATA;
  }
  const token = await getTokenByIdOrMint(id);

  if (!token) {
    return { title: "Token not found", robots: { index: false, follow: false } };
  }

  const title = `${token.name} (${token.ticker})`;
  const description = `View the LCKD platform record for ${token.name}. Verify the mint, market data, developer links, and any token lock independently.`;
  const canonicalId = token.mintAddress ?? id;

  return {
    title,
    description,
    alternates: { canonical: `/token/${canonicalId}` },
    openGraph: {
      title,
      description,
      siteName: "LCKD",
      type: "website",
      url: `/token/${canonicalId}`,
      images: token.image.startsWith("http")
        ? [{ url: token.image, width: 256, height: 256 }]
        : [{ url: "/og.png", width: 1200, height: 630, alt: "LCKD" }],
    },
    twitter: {
      card: "summary_large_image",
      site: "@launchlckd",
      title,
      description,
      images: token.image.startsWith("http") ? [token.image] : ["/og.png"],
    },
  };
}

export default async function TokenDetailPage({ params }: Props) {
  const { id } = await params;
  if (isOfficialTokenMint(id, null)) {
    permanentRedirect(OFFICIAL_TOKEN_PATH);
  }
  const token = await getTokenByIdOrMint(id);

  if (!token) {
    notFound();
  }

  return <TokenDetailClient t={token} />;
}
