import type { Metadata } from "next";
import { JetBrains_Mono, Space_Grotesk } from "next/font/google";
import WalletProvider from "@/components/providers/WalletProvider";
import AuthProvider from "@/components/providers/AuthProvider";
import Navbar from "@/components/layout/Navbar";
import SiteFooter from "@/components/layout/SiteFooter";
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
  applicationName: "LCKD",
  title: {
    default: "LCKD | Solana token launches with visible lock records",
    template: "%s | LCKD",
  },
  description:
    "Create a Solana token, then place eligible creator tokens in a separate Streamflow lock transaction with public on-chain receipts.",
  metadataBase: new URL("https://lckd.tech"),
  alternates: { canonical: "/" },
  openGraph: {
    title: "LCKD | Builders who ship",
    description:
      "Create on pump.fun, then submit a separate Streamflow token lock with explicit wallet approval.",
    url: "/",
    siteName: "LCKD",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    site: "@launchlckd",
    creator: "@launchlckd",
    title: "LCKD | Builders who ship",
    description:
      "Create on pump.fun, then submit a separate Streamflow token lock with explicit wallet approval.",
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
        className={`${spaceGrotesk.variable} ${jetbrainsMono.variable} bg-bg text-text-1 antialiased`}
      >
        <a className="skip-link" href="#main-content">
          Skip to main content
        </a>
        <AuthProvider>
          <WalletProvider>
            <Navbar />
            <main id="main-content" className="relative z-[1]" tabIndex={-1}>
              {children}
            </main>
            <SiteFooter />
          </WalletProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
