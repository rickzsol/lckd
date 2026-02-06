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
    default: "trudev.fun — Dev Bags Locked on Launch",
    template: "%s",
  },
  description:
    "Launch Solana tokens with enforced vesting locks. No more rugs — every launch is transparent and dev tokens are locked via Streamflow.",
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL || "https://www.trudev.fun",
  ),
  icons: {
    icon: [
      { url: "/icon-transparent.png", type: "image/png" },
    ],
    shortcut: "/icon-transparent.png",
    apple: "/icon-transparent.png",
  },
  openGraph: {
    title: "trudev.fun — Dev Bags Locked on Launch",
    description:
      "Launch Solana tokens with enforced vesting locks. Dev tokens locked via Streamflow — verifiable on-chain.",
    siteName: "trudev.fun",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "trudev.fun — Dev Bags Locked on Launch",
    description:
      "Launch Solana tokens with enforced vesting locks. Dev tokens locked via Streamflow.",
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
            <div className="dot-grid" aria-hidden="true" />
            <div className="page-glow" aria-hidden="true" />
            <Navbar />
            <main className="relative z-[1]">{children}</main>
          </WalletProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
