export const PERFORMANCE_PROPOSAL_KINDS = ["campaign.pause"] as const;

export const CAMPAIGN_PROPOSAL_KINDS = [
  "campaign.create",
  "campaign.budget_change",
] as const;

export function isAllowedProposalKind(
  profile: "performance" | "campaign",
  kind: string,
): boolean {
  const allowlist =
    profile === "performance"
      ? PERFORMANCE_PROPOSAL_KINDS
      : CAMPAIGN_PROPOSAL_KINDS;
  return (allowlist as readonly string[]).includes(kind);
}
