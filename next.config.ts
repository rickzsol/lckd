import type { NextConfig } from "next";

function getLaunchMonitorOrigin(): string | null {
  const configured = process.env.NEXT_PUBLIC_LAUNCH_MONITOR_URL;
  if (!configured) return null;
  try {
    const url = new URL(configured);
    const isLocal =
      process.env.NODE_ENV !== "production" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1");
    return url.protocol === "https:" || (isLocal && url.protocol === "http:")
      ? url.origin
      : null;
  } catch {
    return null;
  }
}

const LAUNCH_MONITOR_ORIGIN = getLaunchMonitorOrigin();

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
  `connect-src 'self' https://*.helius-rpc.com https://api.mainnet-beta.solana.com https://rpc.mainnet.chain.robinhood.com https://*.supabase.co https://api.dexscreener.com wss:${LAUNCH_MONITOR_ORIGIN ? ` ${LAUNCH_MONITOR_ORIGIN}` : ""}`,
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
  async redirects() {
    return [
      {
        destination: "/token/lckd",
        permanent: true,
        source: "/token/lckd-manual-launch",
      },
      {
        destination: "/token/lckd",
        permanent: true,
        source: "/token/7UTubJ3W6JWwLUj82B9LgHFDmc8wFWtSNLis6u8epump",
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
