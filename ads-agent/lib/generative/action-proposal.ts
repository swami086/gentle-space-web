import { z } from "zod";

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

const actionProposalPayloadSchema = z.object({
  v: z.literal(1),
  kind: z.string(),
  title: z.string(),
  summary: z.string(),
  href: z.string().optional(),
  proposalId: z.string().optional(),
  citationIds: z.array(z.string()),
});

/** Parses untrusted OpenUI action payload into the typed F2 contract. */
export function parseActionProposalPayload(raw: unknown): ActionProposalPayload {
  return actionProposalPayloadSchema.parse(raw);
}

function isSafeRelativePath(path: string): boolean {
  if (!path.startsWith("/")) return false;
  if (path.startsWith("//")) return false;
  // Reject scheme URLs that may slip through without a leading slash check (e.g. javascript:).
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
