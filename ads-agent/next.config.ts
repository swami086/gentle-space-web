import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Monorepo has a root package-lock.json; without this, Next loads the parent
  // .env.local (listings DATABASE_URL) and ads-agent hits the wrong Postgres.
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
