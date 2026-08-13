export const ORCHESTRATOR_PROFILE = "orchestrator" as const;

export const ORCHESTRATOR_TOOL_ALLOWLIST = ["list_proposals"] as const satisfies readonly string[];

export const ORCHESTRATOR_TOKEN_TTL_DEFAULT = 900;
export const ORCHESTRATOR_TOKEN_TTL_MAX = 3600;

export function clampOrchestratorTtl(seconds: number | undefined): number {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) {
    return ORCHESTRATOR_TOKEN_TTL_DEFAULT;
  }
  return Math.min(Math.floor(seconds), ORCHESTRATOR_TOKEN_TTL_MAX);
}

export function assertOrchestratorProfile(profile: string): void {
  if (profile !== ORCHESTRATOR_PROFILE) throw new Error("forbidden_profile");
}
