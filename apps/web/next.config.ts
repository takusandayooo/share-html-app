import type { NextConfig } from "next";

const apiOrigin = process.env.API_ORIGIN || "http://127.0.0.1:8787";
const nextConfig: NextConfig = {
  transpilePackages: ["@share/contracts"],
  env: { API_ORIGIN: apiOrigin },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value:
              "frame-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'",
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
        ],
      },
    ];
  },
};
export default nextConfig;
