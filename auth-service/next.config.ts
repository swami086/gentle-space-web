import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    // JWKS must be reachable at the RFC 5785 well-known path; the real route lives at
    // /api/jwks (Task 7) since Next.js route folders starting with "." are unreliable.
    return [{ source: "/.well-known/jwks.json", destination: "/api/jwks" }];
  },
};

export default nextConfig;
