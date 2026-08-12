// ads-agent/mcp/context-server/read-proposals.ts
import { z } from "zod";
import { withAgentTenantTx } from "./db";
import type { TaskTokenClaims } from "./task-token";

export const AGENT_VISIBLE_PROPOSAL_STATUSES = [
  "pending",
  "scheduled",
  "approved",
  "rejected",
] as const;

export type AgentProposalView = {
  id: string;
  kind: string;
  status: string;
  rationale: string | null;
  evidence: string[];
  createdAt: string;
  decidedAt: string | null;
};

const inputSchema = z.strictObject({
  status: z.enum(AGENT_VISIBLE_PROPOSAL_STATUSES).optional(),
  limit: z.number().int().min(1).max(100).default(25),
});

export async function listProposals(
  claims: TaskTokenClaims,
  input: z.input<typeof inputSchema>,
): Promise<AgentProposalView[]> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) throw new Error("invalid_status");
  const { status, limit } = parsed.data;
  return withAgentTenantTx(claims.orgId, async (tx) => {
    const { rows } = await tx.query<{
      id: string;
      kind: string;
      status: string;
      rationale: string | null;
      evidence: unknown;
      created_at: Date;
      decided_at: Date | null;
    }>(
      `SELECT id, kind, status, rationale, evidence, created_at, decided_at
         FROM context.v_agent_proposals
        WHERE ($1::text IS NULL OR status = $1)
        ORDER BY created_at DESC
        LIMIT $2`,
      [status ?? null, limit],
    );
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      status: row.status,
      rationale: row.rationale,
      evidence: Array.isArray(row.evidence) ? row.evidence.map(String) : [],
      createdAt: row.created_at.toISOString(),
      decidedAt: row.decided_at?.toISOString() ?? null,
    }));
  });
}
