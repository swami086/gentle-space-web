export const PERFORMANCE_PROFILE = "performance" as const;

export const PERFORMANCE_TOOL_ALLOWLIST = [
  "get_campaign_performance",
  "get_context_pack",
  "list_proposals",
  "graph_query",
  "create_proposal",
] as const satisfies readonly string[];

export const PERFORMANCE_TOKEN_TTL_DEFAULT = 900;
export const PERFORMANCE_TOKEN_TTL_MAX = 3600;

export function clampPerformanceTtl(seconds: number | undefined): number {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) {
    return PERFORMANCE_TOKEN_TTL_DEFAULT;
  }
  return Math.min(Math.floor(seconds), PERFORMANCE_TOKEN_TTL_MAX);
}

export function assertPerformanceProfile(profile: string): void {
  if (profile !== PERFORMANCE_PROFILE) throw new Error("forbidden_profile");
}
