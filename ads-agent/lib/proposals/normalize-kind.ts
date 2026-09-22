/**
 * Agent proposals use dotted kinds (`campaign.pause`); decision-cycle / legacy
 * rows use snake_case (`pause`). Executor switch is snake_case — normalize first.
 */
const AGENT_TO_EXECUTABLE: Record<string, string> = {
  "campaign.create": "create_campaign",
  "campaign.pause": "pause",
  "campaign.budget_change": "budget_change",
};

export function executableProposalKind(kind: string): string {
  return AGENT_TO_EXECUTABLE[kind] ?? kind;
}

export function isSpendChangeKind(kind: string): boolean {
  const exec = executableProposalKind(kind);
  return exec === "budget_change" || kind === "campaign.budget_change";
}
