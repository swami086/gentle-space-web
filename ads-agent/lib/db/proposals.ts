import type { PoolClient } from "pg";
import type { NewProposal, Proposal, ProposalKind, ProposalStatus } from "../types";
import { withCrossTenantRead } from "./cross-tenant";
import { scopeClause, type Scope } from "./scope-sql";
import { withTenantTransaction } from "./tx";

type ProposalRow = {
  id: string;
  kind: ProposalKind;
  campaign_id: string | null;
  payload: Record<string, unknown>;
  triggered_rule: string;
  rationale: string | null;
  status: ProposalStatus;
  error: string | null;
  created_at: Date;
  decided_at: Date | null;
  executed_at: Date | null;
  scheduled_for: Date | null;
  undo_until: Date | null;
  batch_id: string | null;
};

function rowToProposal(row: ProposalRow): Proposal {
  return {
    id: row.id,
    kind: row.kind,
    campaignId: row.campaign_id,
    payload: row.payload,
    triggeredRule: row.triggered_rule,
    rationale: row.rationale,
    status: row.status,
    error: row.error,
    createdAt: row.created_at.toISOString(),
    decidedAt: row.decided_at?.toISOString() ?? null,
    executedAt: row.executed_at?.toISOString() ?? null,
    scheduledFor: row.scheduled_for?.toISOString() ?? null,
    undoUntil: row.undo_until?.toISOString() ?? null,
    batchId: row.batch_id,
  };
}

export async function createProposal(scope: Scope, input: NewProposal): Promise<Proposal> {
  const s = scopeClause(scope);
  return withTenantTransaction(scope, async (client) => {
    const { rows } = await client.query<ProposalRow>(
      `INSERT INTO adsagent.proposals
         (org_id, kind, campaign_id, payload, triggered_rule, rationale)
       VALUES ($1::uuid, $2, $3, $4::jsonb, $5, $6)
       RETURNING *`,
      [
        ...s.params,
        input.kind,
        input.campaignId,
        JSON.stringify(input.payload),
        input.triggeredRule,
        input.rationale ?? null,
      ],
    );
    return rowToProposal(rows[0]);
  });
}

export async function listProposals(scope: Scope, status?: ProposalStatus): Promise<Proposal[]> {
  const s = scopeClause(scope);
  return withTenantTransaction(scope, async (client) => {
    const { rows } = status
      ? await client.query<ProposalRow>(
          `SELECT * FROM adsagent.proposals
            WHERE ${s.sql} AND status = $2
            ORDER BY created_at DESC`,
          [...s.params, status],
        )
      : await client.query<ProposalRow>(
          `SELECT * FROM adsagent.proposals WHERE ${s.sql} ORDER BY created_at DESC`,
          [...s.params],
        );
    return rows.map(rowToProposal);
  });
}

export async function getProposalById(scope: Scope, id: string): Promise<Proposal | null> {
  const s = scopeClause(scope);
  return withTenantTransaction(scope, async (client) => {
    const { rows } = await client.query<ProposalRow>(
      `SELECT * FROM adsagent.proposals WHERE ${s.sql} AND id = $2`,
      [...s.params, id],
    );
    return rows[0] ? rowToProposal(rows[0]) : null;
  });
}

export async function decideProposal(
  scope: Scope,
  id: string,
  status: "approved" | "rejected",
  decidedBy: string,
  decidedVia: "ui" | "bulk" | "api" | "system" = "ui",
): Promise<void> {
  const s = scopeClause(scope);
  await withTenantTransaction(scope, (client) =>
    client.query(
      `UPDATE adsagent.proposals
          SET status = $3, decided_at = NOW(), decided_by = $4, decided_via = $5
        WHERE ${s.sql} AND id = $2`,
      [...s.params, id, status, decidedBy, decidedVia],
    ),
  );
}

export async function markProposalExecuted(scope: Scope, id: string): Promise<void> {
  const s = scopeClause(scope);
  await withTenantTransaction(scope, (client) =>
    client.query(
      `UPDATE adsagent.proposals
          SET status = 'executed', executed_at = NOW()
        WHERE ${s.sql} AND id = $2`,
      [...s.params, id],
    ),
  );
}

export async function markProposalFailed(scope: Scope, id: string, error: string): Promise<void> {
  const s = scopeClause(scope);
  await withTenantTransaction(scope, (client) =>
    client.query(
      `UPDATE adsagent.proposals SET status = 'failed', error = $3 WHERE ${s.sql} AND id = $2`,
      [...s.params, id, error],
    ),
  );
}

export async function updateProposalPayload(
  scope: Scope,
  id: string,
  payload: Record<string, unknown>,
): Promise<Proposal> {
  const s = scopeClause(scope);
  return withTenantTransaction(scope, async (client) => {
    const { rows } = await client.query<ProposalRow>(
      `UPDATE adsagent.proposals SET payload = $3::jsonb
        WHERE ${s.sql} AND id = $2
        RETURNING *`,
      [...s.params, id, JSON.stringify(payload)],
    );
    // A scoped UPDATE that matched nothing is indistinguishable from a
    // cross-tenant attempt, and must not return a fabricated row.
    if (!rows[0]) throw new Error(`proposal ${id} not found`);
    return rowToProposal(rows[0]);
  });
}

export async function scheduleProposal(
  scope: Scope,
  id: string,
  opts: {
    decidedBy: string;
    decidedVia: "ui" | "bulk" | "api" | "system";
    undoWindowSeconds: number;
    batchId?: string | null;
  },
): Promise<Proposal | null> {
  const s = scopeClause(scope);
  const n = s.params.length;
  return withTenantTransaction(scope, async (client) => {
    const { rows } = await client.query<ProposalRow>(
      `UPDATE adsagent.proposals
          SET status = 'scheduled',
              decided_at = NOW(),
              decided_by = $${n + 2},
              decided_via = $${n + 3},
              scheduled_for = NOW(),
              undo_until = NOW() + ($${n + 4}::int * interval '1 second'),
              batch_id = $${n + 5}
        WHERE ${s.sql} AND id = $${n + 1}
        RETURNING *`,
      [
        ...s.params,
        id,
        opts.decidedBy,
        opts.decidedVia,
        opts.undoWindowSeconds || 0,
        opts.batchId ?? null,
      ],
    );
    return rows[0] ? rowToProposal(rows[0]) : null;
  });
}

export async function cancelScheduledProposal(scope: Scope, id: string): Promise<Proposal | null> {
  const s = scopeClause(scope);
  const n = s.params.length;
  return withTenantTransaction(scope, async (client) => {
    const { rows } = await client.query<ProposalRow>(
      `UPDATE adsagent.proposals
          SET status = 'pending',
              scheduled_for = NULL,
              undo_until = NULL,
              batch_id = NULL,
              decided_at = NULL,
              decided_by = NULL,
              decided_via = NULL
        WHERE ${s.sql}
          AND id = $${n + 1}
          AND status = 'scheduled'
          AND undo_until > now()
        RETURNING *`,
      [...s.params, id],
    );
    return rows[0] ? rowToProposal(rows[0]) : null;
  });
}

export async function cancelScheduledBatch(scope: Scope, batchId: string): Promise<number> {
  const s = scopeClause(scope);
  const n = s.params.length;
  return withTenantTransaction(scope, async (client) => {
    const { rowCount } = await client.query(
      `UPDATE adsagent.proposals
          SET status = 'pending',
              scheduled_for = NULL,
              undo_until = NULL,
              batch_id = NULL,
              decided_at = NULL,
              decided_by = NULL,
              decided_via = NULL
        WHERE ${s.sql}
          AND batch_id = $${n + 1}::uuid
          AND status = 'scheduled'
          AND undo_until > now()`,
      [...s.params, batchId],
    );
    return rowCount ?? 0;
  });
}

/** Cross-tenant read + per-org write: RLS blocks a cross-tenant UPDATE. */
export async function selectDueScheduledProposals(
  client: PoolClient,
  limit: number,
): Promise<Array<{ id: string; orgId: string }>> {
  const { rows } = await client.query<{ id: string; org_id: string }>(
    `SELECT id, org_id
       FROM adsagent.proposals
      WHERE status = 'scheduled'
        AND undo_until <= now()
      ORDER BY undo_until
      LIMIT $1
        FOR UPDATE SKIP LOCKED`,
    [limit],
  );
  return rows.map((row) => ({ id: row.id, orgId: row.org_id }));
}

/** Cross-tenant worker claim: FOR UPDATE SKIP LOCKED, set executing, return ids+org_id */
export async function claimDueScheduledProposals(
  limit: number,
): Promise<Array<{ id: string; orgId: string }>> {
  const due = await withCrossTenantRead("proposal-undo-worker", (client) =>
    selectDueScheduledProposals(client, limit),
  );

  const claimed: Array<{ id: string; orgId: string }> = [];
  for (const row of due) {
    const scope: Scope = { kind: "org", orgId: row.orgId };
    const updated = await withTenantTransaction(scope, async (client) => {
      const { rows } = await client.query<{ id: string; org_id: string }>(
        `UPDATE adsagent.proposals
            SET status = 'executing'
          WHERE org_id = $1::uuid
            AND id = $2::uuid
            AND status = 'scheduled'
            AND undo_until <= now()
          RETURNING id, org_id`,
        [row.orgId, row.id],
      );
      return rows[0];
    });
    if (updated) claimed.push({ id: updated.id, orgId: updated.org_id });
  }
  return claimed;
}
