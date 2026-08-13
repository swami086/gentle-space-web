import type { GenerativeGroundingPack } from "./grounding-pack";

const PACK_ENTITIES = ["enquiry", "proposal", "campaign", "space"] as const;
export type GenerativeSubjectType = (typeof PACK_ENTITIES)[number];

export function isGenerativeSubjectType(value: string): value is GenerativeSubjectType {
  return (PACK_ENTITIES as readonly string[]).includes(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Positional OpenUI Lang for WhyCard (root = first). */
export function formatWhyOpenUiLang(
  body: string,
  citationIds: string[],
  followUps: string[] = [],
): string {
  const ids = citationIds.map((id) => JSON.stringify(id)).join(", ");
  if (followUps.length > 0) {
    const follow = followUps.map((q) => JSON.stringify(q)).join(", ");
    return `root = WhyCard(${JSON.stringify(body)}, [${ids}], [${follow}])`;
  }
  return `root = WhyCard(${JSON.stringify(body)}, [${ids}])`;
}

/** Deterministic Why copy from a proposal grounding pack — no invented numbers (v1). */
export function templateWhyFromProposalPack(pack: GenerativeGroundingPack): {
  body: string;
  citationIds: string[];
  followUps: string[];
} {
  const proposal = asRecord(pack.facts.proposal);
  const kind = typeof proposal?.kind === "string" ? proposal.kind : "change";
  const status = typeof proposal?.status === "string" ? proposal.status : "pending";
  const triggeredRule =
    typeof proposal?.triggeredRule === "string" ? proposal.triggeredRule : null;
  const rationale =
    typeof proposal?.rationale === "string" && proposal.rationale.trim()
      ? proposal.rationale.trim()
      : null;

  let body = `This ${kind} proposal is ${status}.`;
  if (triggeredRule) body += ` It was triggered by rule "${triggeredRule}".`;
  if (rationale) body += ` Rationale: ${rationale}`;

  const citationIds = [pack.id];
  const campaign = asRecord(pack.facts.campaign);
  if (typeof campaign?.id === "string") citationIds.push(campaign.id);

  return {
    body,
    citationIds: [...new Set(citationIds)],
    followUps: ["What metrics drove this?", "What happens if I reject it?"],
  };
}

function subjectSummary(pack: GenerativeGroundingPack): string {
  if (pack.entity === "proposal") {
    const proposal = asRecord(pack.facts.proposal);
    const kind = typeof proposal?.kind === "string" ? proposal.kind : "change";
    const status = typeof proposal?.status === "string" ? proposal.status : "unknown";
    return `${kind} proposal (${status})`;
  }
  if (pack.entity === "enquiry") {
    const enquiry = asRecord(pack.facts.enquiry);
    const replyState =
      typeof enquiry?.replyState === "string" ? enquiry.replyState : "unknown";
    return `enquiry with reply state ${replyState}`;
  }
  if (pack.entity === "campaign") {
    const campaign = asRecord(pack.facts.campaign);
    const name = typeof campaign?.name === "string" ? campaign.name : "campaign";
    return `campaign "${name}"`;
  }
  const space = asRecord(pack.facts.space);
  const name = typeof space?.name === "string" ? space.name : "space";
  return `listing "${name}"`;
}

/** Deterministic Ask answer — WhyCard when grounded, plain Card-style prose otherwise. */
export function draftAskAnswer(
  question: string,
  pack?: GenerativeGroundingPack,
): { body: string; citationIds: string[]; followUps: string[]; openuiLang: string } {
  const trimmed = question.trim();
  if (!pack) {
    const body = `No subject was attached. For "${trimmed}", open Copilot or pick a proposal, enquiry, or campaign first.`;
    return { body, citationIds: [], followUps: [], openuiLang: formatWhyOpenUiLang(body, []) };
  }

  const body = `About this ${subjectSummary(pack)}: ${trimmed} — answer from grounded records only (see citations).`;
  const citationIds =
    pack.rowIds.length > 0
      ? pack.rowIds.slice(0, Math.min(3, pack.rowIds.length))
      : [pack.id];
  return {
    body,
    citationIds,
    followUps: [],
    openuiLang: formatWhyOpenUiLang(body, citationIds),
  };
}
