import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTokenByIdOrMint } from "@/lib/queries";
import { loadAllocationData, type AllocationPageData } from "@/lib/allocations/loadSummary";
import TokenDetailClient from "./TokenDetailClient";

export const revalidate = 60;

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
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
  const token = await getTokenByIdOrMint(id);

  if (!token) {
    notFound();
  }

  let allocations: AllocationPageData | null = null;
  if (token.mintAddress) {
    try {
      allocations = await loadAllocationData(token.mintAddress);
    } catch (error) {
      // The token page must render even when allocation reads fail; the
      // panel simply stays hidden until the data source recovers.
      console.error("[token] Allocation load failed:", error);
    }
  }

  return <TokenDetailClient t={token} allocations={allocations} />;
}
