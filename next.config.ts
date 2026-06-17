import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Gmail message bodies and AI responses can be large; allow generous payloads
  // on server actions / route handlers.
  experimental: {
    serverActions: {
      bodySizeLimit: "4mb",
    },
  },
};

export default nextConfig;
