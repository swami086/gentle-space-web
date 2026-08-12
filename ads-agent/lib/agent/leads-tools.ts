export const LEADS_PROFILE = "leads" as const;

export const LEADS_TOOL_ALLOWLIST = [
  "list_enquiries",
  "get_enquiry",
  "get_context_pack",
  "search_spaces",
  "get_space",
  "list_proposals",
  "graph_query",
  "create_proposal",
] as const satisfies readonly string[];

export const LEADS_TOKEN_TTL_DEFAULT = 900;
export const LEADS_TOKEN_TTL_MAX = 3600;

export function clampLeadsTtl(seconds: number | undefined): number {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) {
    return LEADS_TOKEN_TTL_DEFAULT;
  }
  return Math.min(Math.floor(seconds), LEADS_TOKEN_TTL_MAX);
}

export function assertLeadsProfile(profile: string): void {
  if (profile !== LEADS_PROFILE) throw new Error("forbidden_profile");
}
