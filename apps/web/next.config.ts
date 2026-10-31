import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  agentRules: false,
  poweredByHeader: false,
  transpilePackages: ["@atlaspad/shared", "@atlaspad/db"],
  serverExternalPackages: ["postgres"],
  // Fonts read from disk by the generated PnL card images.
  outputFileTracingIncludes: { "/api/pnl/[tx]/image": ["./assets/fonts/**"] },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
