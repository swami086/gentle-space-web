export type GoogleAdsHealth = {
  configured: boolean;
  reachable: boolean;
  error?: string;
};

const DEFAULT_PROBE_TIMEOUT_MS = 5_000;

const GOOGLE_ADS_ENV_KEYS = [
  "GOOGLE_ADS_DEVELOPER_TOKEN",
  "GOOGLE_ADS_CLIENT_ID",
  "GOOGLE_ADS_CLIENT_SECRET",
  "GOOGLE_ADS_REFRESH_TOKEN",
  "GOOGLE_ADS_CUSTOMER_ID",
] as const;

function isGoogleAdsConfigured(): boolean {
  return GOOGLE_ADS_ENV_KEYS.every((name) => Boolean(process.env[name]?.trim()));
}

/** Cheap read-MCP health check against GOOGLE_ADS_MCP_URL (via listTools). */
export async function probeGoogleAdsReadMcp(opts?: { timeoutMs?: number }): Promise<GoogleAdsHealth> {
  const configured = isGoogleAdsConfigured();
  if (!configured) {
    return { configured: false, reachable: false };
  }

  const timeoutMs = opts?.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;

  try {
    const { listGoogleAdsTools } = await import("../bifrost/google-ads-mcp-client");
    await Promise.race([
      listGoogleAdsTools(),
      new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error(`google ads read mcp probe timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
    return { configured: true, reachable: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { configured: true, reachable: false, error };
  }
}
