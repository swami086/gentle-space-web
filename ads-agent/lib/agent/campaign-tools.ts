export const CAMPAIGN_PROFILE = "campaign" as const;

export const CAMPAIGN_TOOL_ALLOWLIST = [
  "get_campaign_performance",
  "get_context_pack",
  "search_spaces",
  "get_space",
  "list_proposals",
  "graph_query",
  "create_proposal",
] as const satisfies readonly string[];

export const CAMPAIGN_TOKEN_TTL_DEFAULT = 900;
export const CAMPAIGN_TOKEN_TTL_MAX = 3600;

export function clampCampaignTtl(seconds: number | undefined): number {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) {
    return CAMPAIGN_TOKEN_TTL_DEFAULT;
  }
  return Math.min(Math.floor(seconds), CAMPAIGN_TOKEN_TTL_MAX);
}

export function assertCampaignProfile(profile: string): void {
  if (profile !== CAMPAIGN_PROFILE) throw new Error("forbidden_profile");
}
