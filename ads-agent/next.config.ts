import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Monorepo has a root package-lock.json; without this, Next loads the parent
  // .env.local (listings DATABASE_URL) and ads-agent hits the wrong Postgres.
  outputFileTracingRoot: path.join(__dirname),
  // Lint is a separate `npm run lint` step; unrelated pre-existing lint errors
  // (e.g. WIP inbound route, test files) shouldn't block a production build.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
