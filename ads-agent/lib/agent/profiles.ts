import {
  LEADS_TOOL_ALLOWLIST,
  LEADS_TOKEN_TTL_DEFAULT,
  LEADS_TOKEN_TTL_MAX,
  clampLeadsTtl,
} from "./leads-tools";
import {
  ORCHESTRATOR_TOOL_ALLOWLIST,
  ORCHESTRATOR_TOKEN_TTL_DEFAULT,
  ORCHESTRATOR_TOKEN_TTL_MAX,
  clampOrchestratorTtl,
} from "./orchestrator-tools";
import {
  PERFORMANCE_TOOL_ALLOWLIST,
  PERFORMANCE_TOKEN_TTL_DEFAULT,
  PERFORMANCE_TOKEN_TTL_MAX,
  clampPerformanceTtl,
} from "./performance-tools";
import {
  CAMPAIGN_TOOL_ALLOWLIST,
  CAMPAIGN_TOKEN_TTL_DEFAULT,
  CAMPAIGN_TOKEN_TTL_MAX,
  clampCampaignTtl,
} from "./campaign-tools";

export type AgentProfile = "leads" | "orchestrator" | "performance" | "campaign";

const PROFILES: Record<AgentProfile, true> = {
  leads: true,
  orchestrator: true,
  performance: true,
  campaign: true,
};

export function isAgentProfile(p: string): p is AgentProfile {
  return p in PROFILES;
}

export function allowlistFor(profile: AgentProfile): readonly string[] {
  switch (profile) {
    case "leads":
      return LEADS_TOOL_ALLOWLIST;
    case "orchestrator":
      return ORCHESTRATOR_TOOL_ALLOWLIST;
    case "performance":
      return PERFORMANCE_TOOL_ALLOWLIST;
    case "campaign":
      return CAMPAIGN_TOOL_ALLOWLIST;
  }
}

export function clampTtlFor(profile: AgentProfile, seconds: number | undefined): number {
  switch (profile) {
    case "leads":
      return clampLeadsTtl(seconds);
    case "orchestrator":
      return clampOrchestratorTtl(seconds);
    case "performance":
      return clampPerformanceTtl(seconds);
    case "campaign":
      return clampCampaignTtl(seconds);
  }
}

export {
  LEADS_TOKEN_TTL_DEFAULT,
  LEADS_TOKEN_TTL_MAX,
  ORCHESTRATOR_TOKEN_TTL_DEFAULT,
  ORCHESTRATOR_TOKEN_TTL_MAX,
  PERFORMANCE_TOKEN_TTL_DEFAULT,
  PERFORMANCE_TOKEN_TTL_MAX,
  CAMPAIGN_TOKEN_TTL_DEFAULT,
  CAMPAIGN_TOKEN_TTL_MAX,
};
