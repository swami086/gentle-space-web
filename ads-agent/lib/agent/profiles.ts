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

export type AgentProfile = "leads" | "orchestrator";

export function isAgentProfile(p: string): p is AgentProfile {
  return p === "leads" || p === "orchestrator";
}

export function allowlistFor(profile: AgentProfile): readonly string[] {
  return profile === "leads" ? LEADS_TOOL_ALLOWLIST : ORCHESTRATOR_TOOL_ALLOWLIST;
}

export function clampTtlFor(profile: AgentProfile, seconds: number | undefined): number {
  return profile === "leads" ? clampLeadsTtl(seconds) : clampOrchestratorTtl(seconds);
}

export {
  LEADS_TOKEN_TTL_DEFAULT,
  LEADS_TOKEN_TTL_MAX,
  ORCHESTRATOR_TOKEN_TTL_DEFAULT,
  ORCHESTRATOR_TOKEN_TTL_MAX,
};
