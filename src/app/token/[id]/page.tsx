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
    return { title: "Token Not Found — Lockpad" };
  }

  const title = `${token.name} (${token.ticker}) — Lockpad`;
  const description = `${token.name} — ${token.tierLabel} tier. ${token.lock.amount} tokens locked for ${token.lock.duration}. Built on pump.fun with Streamflow token lock.`;

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      siteName: "Lockpad",
      type: "website",
      ...(token.image.startsWith("http") && {
        images: [{ url: token.image, width: 256, height: 256 }],
      }),
    },
    twitter: {
      card: "summary",
      title,
      description,
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
