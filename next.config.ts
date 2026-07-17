import type { NextConfig } from "next";

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "font-src 'self' data: https://fonts.gstatic.com",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "frame-src https://dexscreener.com",
  "img-src 'self' blob: data: https:",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "connect-src 'self' https://*.helius-rpc.com https://api.mainnet-beta.solana.com https://*.supabase.co https://api.dexscreener.com wss:",
  "upgrade-insecure-requests",
].join("; ");

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: CONTENT_SECURITY_POLICY },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  turbopack: {
    root: process.cwd(),
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.ipfs.w3s.link" },
      { protocol: "https", hostname: "ipfs.io" },
      { protocol: "https", hostname: "cf-ipfs.com" },
      { protocol: "https", hostname: "**.nftstorage.link" },
      { protocol: "https", hostname: "nftstorage.link" },
      { protocol: "https", hostname: "gateway.pinata.cloud" },
      { protocol: "https", hostname: "**.pinata.cloud" },
      { protocol: "https", hostname: "pump.fun" },
      { protocol: "https", hostname: "**.pump.fun" },
      { protocol: "https", hostname: "arweave.net" },
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
      { protocol: "https", hostname: "i.imgur.com" },
    ],
  },
};

export default nextConfig;
