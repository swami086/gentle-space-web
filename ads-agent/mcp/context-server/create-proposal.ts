// ads-agent/mcp/context-server/create-proposal.ts
import { z } from "zod";
import { withAgentTenantTx, withAgentTenantWriteTx } from "./db";
import type { TaskTokenClaims } from "./task-token";

/**
 * Agents propose, humans dispose (agent spec AG1). Every action an agent wants
 * to take in the world becomes a row in proposals, which is the human-gated
 * approval mechanism the admin screens already render. There is no second write
 * tool, and no send tool of any kind.
 */
export const AGENT_PROPOSAL_KINDS = [
  "campaign.create",
  "campaign.budget_change",
  "campaign.pause",
  "enquiry.requirement_update",
  "content.page_update",
  "listing.update",
  "message.draft",
] as const;

export type AgentProposalKind = (typeof AGENT_PROPOSAL_KINDS)[number];

/** Kinds that move money. Refused outright on stale data (datastore §12.1). */
export const SPEND_CHANGING_KINDS = ["campaign.create", "campaign.budget_change"] as const;

export const STALE_LAG_SECONDS = 900;
const MAX_RATIONALE_CHARS = 2000;
const MAX_EVIDENCE_ITEMS = 50;

export type CreateProposalErrorCode =
  | "evidence_empty"
  | "evidence_not_identifier"
  | "invalid_kind"
  | "invalid_payload"
  | "stale_data_refusal";

export class CreateProposalError extends Error {
  constructor(readonly code: CreateProposalErrorCode) {
    super(code);
    this.name = "CreateProposalError";
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NODE_RE = /^node:[0-9a-f-]{36}$/i;
const ARTIFACT_KEY_RE = /^artifacts\/[0-9a-f-]{36}\/[a-z_]+\/[0-9a-f-]{36}$/i;

/**
 * `evidence` holds identifiers only, never prose (dataflow review A-4). Row ids,
 * artifact keys, node ids — things that point at facts. An agent's narrative
 * belongs in `rationale`; allowing prose here would put the same reasoning in
 * three stores with no rule about which is authoritative.
 */
function isIdentifier(value: string): boolean {
  return UUID_RE.test(value) || NODE_RE.test(value) || ARTIFACT_KEY_RE.test(value);
}

const inputSchema = z.strictObject({
  kind: z.string(),
  payload: z.record(z.string(), z.unknown()),
  rationale: z.string().min(1).max(MAX_RATIONALE_CHARS),
  evidence: z.array(z.string()).max(MAX_EVIDENCE_ITEMS),
});

async function currentCdcLagSeconds(orgId: string): Promise<number> {
  return withAgentTenantTx(orgId, async (tx) => {
    const { rows } = await tx.query<{ cdc_lag_seconds: number | null }>(
      `SELECT cdc_lag_seconds FROM context.v_agent_graph_manifest`,
    );
    // No manifest means nothing is known about freshness. Unknown is treated as
    // maximally stale, so the refusal fails closed.
    if (!rows[0] || rows[0].cdc_lag_seconds === null) return Number.MAX_SAFE_INTEGER;
    return Number(rows[0].cdc_lag_seconds);
  });
}

export async function createAgentProposal(
  claims: TaskTokenClaims,
  input: {
    kind: string;
    payload: Record<string, unknown>;
    rationale: string;
    evidence: string[];
  },
): Promise<{ proposalId: string }> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) throw new CreateProposalError("invalid_payload");
  const { kind, payload, rationale, evidence } = parsed.data;

  if (!(AGENT_PROPOSAL_KINDS as readonly string[]).includes(kind)) {
    throw new CreateProposalError("invalid_kind");
  }
  if (evidence.length === 0) throw new CreateProposalError("evidence_empty");
  if (!evidence.every(isIdentifier)) throw new CreateProposalError("evidence_not_identifier");

  const lag = await currentCdcLagSeconds(claims.orgId);
  const changesSpend = (SPEND_CHANGING_KINDS as readonly string[]).includes(kind);
  // Refusing is correct behaviour, not a failure: a budget change justified by
  // three-day-old spend looks exactly like a correct one.
  if (changesSpend && lag > STALE_LAG_SECONDS) throw new CreateProposalError("stale_data_refusal");

  const storedLag = lag === Number.MAX_SAFE_INTEGER ? null : lag;

  return withAgentTenantWriteTx(claims.orgId, async (tx) => {
    const { rows } = await tx.query<{ proposal_id: string }>(
      `SELECT adsagent.agent_create_proposal($1, $2::jsonb, $3, $4::text[], $5, $6) AS proposal_id`,
      [kind, JSON.stringify(payload), rationale, evidence, claims.profile, storedLag],
    );
    return { proposalId: rows[0].proposal_id };
  });
}
