import type { ProposalListItem } from "@/lib/db/proposals";
import { listProposals } from "@/lib/db/proposals";
import type { Scope } from "@/lib/db/scope-sql";
import { executableProposalKind, isSpendChangeKind } from "@/lib/proposals/normalize-kind";
import type { ProposalStatus } from "@/lib/types";
import type { DeskItem, DeskItemKind, DeskItemStatus, DeskUrgency } from "./types";

const TITLE_BY_PROPOSAL_KIND: Record<string, string> = {
  create_campaign: "Create campaign",
  "campaign.create": "Create campaign",
  pause: "Pause campaign",
  "campaign.pause": "Pause campaign",
  budget_change: "Change budget",
  "campaign.budget_change": "Change budget",
  add_negative_keyword: "Add negative keyword",
  campaign_strategy: "Campaign strategy",
};

/** Active Desk queue: needs decision or already approved and in flight. */
const INBOX_STATUSES: ProposalStatus[] = ["pending", "scheduled", "executing"];

export function deskKindFromProposal(proposalKind: string): DeskItemKind {
  return isSpendChangeKind(proposalKind) ? "spend_change" : "campaign_proposal";
}

export function deskStatusFromProposal(status: ProposalStatus): DeskItemStatus | null {
  switch (status) {
    case "pending":
      return "needs_approval";
    case "scheduled":
    case "executing":
    case "approved":
      return "running";
    case "executed":
    case "rejected":
      return "done";
    case "failed":
      return "failed";
    default:
      return null;
  }
}

export function deskUrgency(createdAtIso: string, nowMs = Date.now()): DeskUrgency {
  const ageMs = nowMs - new Date(createdAtIso).getTime();
  if (ageMs < 2 * 60 * 60 * 1000) return "now";
  if (ageMs < 24 * 60 * 60 * 1000) return "today";
  return "later";
}

export function mapProposalToDeskItem(
  proposal: ProposalListItem,
  nowMs = Date.now(),
): DeskItem | null {
  const status = deskStatusFromProposal(proposal.status);
  if (status === null) return null;
  if (!INBOX_STATUSES.includes(proposal.status)) return null;

  const execKind = executableProposalKind(proposal.kind);
  const title =
    TITLE_BY_PROPOSAL_KIND[proposal.kind] ??
    TITLE_BY_PROPOSAL_KIND[execKind] ??
    proposal.kind.replaceAll(/[._]/g, " ");

  return {
    id: proposal.id,
    kind: deskKindFromProposal(proposal.kind),
    title,
    summary: proposal.rationale?.trim() || proposal.triggeredRule,
    urgency: deskUrgency(proposal.createdAt, nowMs),
    agent: "performance",
    createdAt: proposal.createdAt,
    hrefSurface: `/proposals/${proposal.id}`,
    status,
    proposalId: proposal.id,
    proposalKind: proposal.kind,
  };
}

export async function listDeskItems(scope: Scope, nowMs = Date.now()): Promise<DeskItem[]> {
  const [pending, scheduled, executing] = await Promise.all([
    listProposals(scope, "pending"),
    listProposals(scope, "scheduled"),
    listProposals(scope, "executing"),
  ]);
  return [...pending, ...scheduled, ...executing]
    .map((p) => mapProposalToDeskItem(p, nowMs))
    .filter((item): item is DeskItem => item !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
