import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produces a self-contained server bundle for the Docker image.
  output: "standalone",
  // Large binary streaming responses should not be compressed/buffered by
  // Next.js; reverse proxies in front can decide what to compress.
  compress: false,
  poweredByHeader: false,
  // Silence the cross-origin dev warning when accessing the dev server via
  // 127.0.0.1 instead of localhost (dev-only option).
  allowedDevOrigins: ["localhost", "127.0.0.1"],
};

export default nextConfig;
