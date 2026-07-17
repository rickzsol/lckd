import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTokenByIdOrMint } from "@/lib/queries";
import { getPendingManualLaunch } from "@/lib/pendingLaunches";
import TokenDetailClient from "./TokenDetailClient";
import PendingLaunchDetail from "./PendingLaunchDetail";

export const revalidate = 60;

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const pendingLaunch = getPendingManualLaunch(id);

  if (pendingLaunch) {
    return {
      title: `${pendingLaunch.name} (${pendingLaunch.ticker})`,
      description: pendingLaunch.description,
      alternates: { canonical: `/token/${pendingLaunch.id}` },
      openGraph: {
        title: `${pendingLaunch.name} (${pendingLaunch.ticker})`,
        description: pendingLaunch.description,
        siteName: "LCKD",
        type: "website",
        url: `/token/${pendingLaunch.id}`,
        images: [{ url: pendingLaunch.image, width: 400, height: 400, alt: pendingLaunch.name }],
      },
    };
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
  const pendingLaunch = getPendingManualLaunch(id);

  if (pendingLaunch) {
    return <PendingLaunchDetail launch={pendingLaunch} />;
  }

  const token = await getTokenByIdOrMint(id);

  if (!token) {
    notFound();
  }

  return <TokenDetailClient t={token} />;
}
