import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Launch a Solana token",
  description:
    "Create and buy a token on pump.fun, then approve a separate Streamflow lock transaction and verify both receipts.",
  alternates: { canonical: "/launch" },
  openGraph: {
    title: "Launch a Solana token | LCKD",
    description:
      "An authenticated two-transaction create-then-lock workflow with explicit wallet approvals.",
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
