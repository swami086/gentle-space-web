import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Keep env/file tracing rooted on auth-service (sibling lockfile at repo root).
  outputFileTracingRoot: path.join(__dirname),
  async rewrites() {
    // JWKS must be reachable at the RFC 5785 well-known path; the real route lives at
    // /api/jwks (Task 7) since Next.js route folders starting with "." are unreliable.
    return [{ source: "/.well-known/jwks.json", destination: "/api/jwks" }];
  },
};

export default nextConfig;
