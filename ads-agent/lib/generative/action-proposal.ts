export type ActionProposalPayload = {
  v: 1;
  kind: string;
  title: string;
  summary: string;
  href?: string;
  proposalId?: string;
  citationIds: string[];
};

export type ActionProposalClickResult =
  | { kind: "navigate"; path: string }
  | { kind: "noop" };

/** Parses untrusted OpenUI action payload into the typed F2 contract. No zod — keep portable in worktrees. */
export function parseActionProposalPayload(raw: unknown): ActionProposalPayload {
  if (!raw || typeof raw !== "object") throw new Error("invalid_action_proposal");
  const o = raw as Record<string, unknown>;
  if (o.v !== 1) throw new Error("invalid_action_proposal");
  if (typeof o.kind !== "string" || typeof o.title !== "string" || typeof o.summary !== "string") {
    throw new Error("invalid_action_proposal");
  }
  if (!Array.isArray(o.citationIds) || !o.citationIds.every((x) => typeof x === "string")) {
    throw new Error("invalid_action_proposal");
  }
  const out: ActionProposalPayload = {
    v: 1,
    kind: o.kind,
    title: o.title,
    summary: o.summary,
    citationIds: o.citationIds as string[],
  };
  if (o.href !== undefined) {
    if (typeof o.href !== "string") throw new Error("invalid_action_proposal");
    out.href = o.href;
  }
  if (o.proposalId !== undefined) {
    if (typeof o.proposalId !== "string") throw new Error("invalid_action_proposal");
    out.proposalId = o.proposalId;
  }
  return out;
}

function isSafeRelativePath(path: string): boolean {
  if (!path.startsWith("/")) return false;
  if (path.startsWith("//")) return false;
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(path)) return false;
  return true;
}

/** Resolves a confirmed ActionProposal click to in-app navigation only — never off-origin. */
export function resolveActionProposalClick(payload: ActionProposalPayload): ActionProposalClickResult {
  if (payload.href !== undefined) {
    return isSafeRelativePath(payload.href) ? { kind: "navigate", path: payload.href } : { kind: "noop" };
  }
  if (payload.proposalId) {
    return { kind: "navigate", path: `/proposals/${payload.proposalId}` };
  }
  return { kind: "noop" };
}
