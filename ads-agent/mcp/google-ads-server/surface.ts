export type GoogleAdsMcpSurface = "read" | "write";

export function resolveGoogleAdsMcpSurface(env: NodeJS.ProcessEnv = process.env): GoogleAdsMcpSurface {
  return env.GOOGLE_ADS_MCP_SURFACE === "write" ? "write" : "read";
}

export function resolveGoogleAdsMcpPort(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.GOOGLE_ADS_MCP_PORT?.trim();
  if (!raw) return 8766;
  const port = Number(raw);
  return Number.isFinite(port) && port > 0 && port <= 65535 ? port : 8766;
}
