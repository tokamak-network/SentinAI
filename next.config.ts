import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Note: instrumentation.ts is supported by default in Next.js 16+
  // No experimental config needed
};

export default nextConfig;
