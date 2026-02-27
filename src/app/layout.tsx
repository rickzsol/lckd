import type { Metadata } from "next";
import { JetBrains_Mono, Space_Grotesk } from "next/font/google";
import WalletProvider from "@/components/providers/WalletProvider";
import AuthProvider from "@/components/providers/AuthProvider";
import Navbar from "@/components/layout/Navbar";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "LCKD — Builders who ship. Tokens that lock.",
    template: "%s",
  },
  description:
    "Launch Solana tokens with enforced token locks. Ship code, lock tokens, prove it. Built on pump.fun + Streamflow.",
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL || "https://www.lckd.tech",
  ),
  icons: {
    icon: [
      { url: "/icon.png", type: "image/png" },
    ],
    shortcut: "/icon.png",
    apple: "/icon.png",
  },
  openGraph: {
    title: "LCKD — Builders who ship. Tokens that lock.",
    description:
      "Launch Solana tokens with enforced token locks. Ship code, lock tokens, prove it on-chain.",
    siteName: "LCKD",
    type: "website",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "LCKD" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "LCKD — Builders who ship. Tokens that lock.",
    description:
      "Launch Solana tokens with enforced token locks. Ship code, lock tokens, prove it.",
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${spaceGrotesk.variable} ${jetbrainsMono.variable} bg-dark-bg text-text-primary antialiased`}
      >
        <AuthProvider>
          <WalletProvider>
            <Navbar />
            <main className="relative z-[1]">{children}</main>
          </WalletProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
