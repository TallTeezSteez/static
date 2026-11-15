import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // One client-rendered page plus API routes: nothing here benefits from prerender caching.
  cacheComponents: false,
  serverExternalPackages: ["pg"],
};

export default nextConfig;
