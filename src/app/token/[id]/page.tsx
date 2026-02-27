import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTokenByIdOrMint } from "@/lib/queries";
import TokenDetailClient from "./TokenDetailClient";

export const revalidate = 60;

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const token = await getTokenByIdOrMint(id);

  if (!token) {
    return { title: "Token Not Found — LCKD" };
  }

  const title = `${token.name} (${token.ticker}) — LCKD`;
  const description = `${token.name} — ${token.tierLabel} tier. ${token.lock.amount} tokens locked for ${token.lock.duration}. Built on pump.fun with Streamflow token lock.`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      siteName: "LCKD",
      type: "website",
      images: token.image.startsWith("http")
        ? [{ url: token.image, width: 256, height: 256 }]
        : [{ url: "/og.png", width: 1200, height: 630, alt: "LCKD" }],
    },
    twitter: {
      card: "summary_large_image",
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

  return <TokenDetailClient t={token} />;
}
