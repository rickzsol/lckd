import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.ipfs.w3s.link" },
      { protocol: "https", hostname: "ipfs.io" },
      { protocol: "https", hostname: "cf-ipfs.com" },
      { protocol: "https", hostname: "pump.fun" },
      { protocol: "https", hostname: "**.pump.fun" },
      { protocol: "https", hostname: "arweave.net" },
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
    ],
  },
};

export default nextConfig;
