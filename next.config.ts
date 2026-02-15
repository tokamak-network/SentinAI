import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || "",
  // Note: instrumentation.ts is supported by default in Next.js 16+
  // No experimental config needed
};

export default nextConfig;
