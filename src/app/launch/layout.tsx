import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Launch a Solana token",
  description:
    "Prepare a lookup table, then atomically create, buy, and lock a token on pump.fun with Streamflow.",
  alternates: { canonical: "/launch" },
  openGraph: {
    title: "Launch a Solana token | LCKD",
    description:
      "An authenticated atomic create, buy, and lock workflow with explicit wallet approvals.",
    url: "/launch",
    siteName: "LCKD",
    type: "website",
  },
};

export default function LaunchLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
