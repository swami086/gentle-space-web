export type DeskItemKind =
  | "campaign_proposal"
  | "spend_change"
  | "crm_stage"
  | "outreach_send"
  | "agent_blocker";

export type DeskUrgency = "now" | "today" | "later";

export type DeskItemStatus = "needs_approval" | "running" | "done" | "failed";

/** Mission-control inbox row — composed from proposals (v1). Spec §9. */
export type DeskItem = {
  id: string;
  kind: DeskItemKind;
  title: string;
  summary: string;
  urgency: DeskUrgency;
  agent?: string;
  createdAt: string;
  hrefSurface?: string;
  status: DeskItemStatus;
  /** Source proposal id (same as id for proposal-backed rows). */
  proposalId: string;
  proposalKind: string;
};
