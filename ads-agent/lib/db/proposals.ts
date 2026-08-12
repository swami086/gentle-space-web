import type { NewProposal, Proposal, ProposalKind, ProposalStatus } from "../types";
import { getPool } from "./client";

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
  };
}

export async function createProposal(input: NewProposal): Promise<Proposal> {
  const { rows } = await getPool().query<ProposalRow>(
    `INSERT INTO proposals (kind, campaign_id, payload, triggered_rule, rationale)
     VALUES ($1, $2, $3::jsonb, $4, $5)
     RETURNING *`,
    [
      input.kind,
      input.campaignId,
      JSON.stringify(input.payload),
      input.triggeredRule,
      input.rationale ?? null,
    ],
  );
  return rowToProposal(rows[0]);
}

export async function listProposals(status?: ProposalStatus): Promise<Proposal[]> {
  const { rows } = status
    ? await getPool().query<ProposalRow>(
        `SELECT * FROM proposals WHERE status = $1 ORDER BY created_at DESC`,
        [status],
      )
    : await getPool().query<ProposalRow>(`SELECT * FROM proposals ORDER BY created_at DESC`, []);
  return rows.map(rowToProposal);
}

export async function getProposalById(id: string): Promise<Proposal | null> {
  const { rows } = await getPool().query<ProposalRow>(
    `SELECT * FROM proposals WHERE id = $1`,
    [id],
  );
  return rows[0] ? rowToProposal(rows[0]) : null;
}

export async function decideProposal(
  id: string,
  status: "approved" | "rejected",
  decidedBy: string,
  decidedVia: "ui" | "bulk" | "api" | "system" = "ui",
): Promise<void> {
  await getPool().query(
    `UPDATE proposals
        SET status = $2, decided_at = NOW(), decided_by = $3, decided_via = $4
      WHERE id = $1`,
    [id, status, decidedBy, decidedVia],
  );
}

export async function markProposalExecuted(id: string): Promise<void> {
  await getPool().query(
    `UPDATE proposals SET status = 'executed', executed_at = NOW() WHERE id = $1`,
    [id],
  );
}

export async function markProposalFailed(id: string, error: string): Promise<void> {
  await getPool().query(`UPDATE proposals SET status = 'failed', error = $2 WHERE id = $1`, [
    id,
    error,
  ]);
}

export async function updateProposalPayload(
  id: string,
  payload: Record<string, unknown>,
): Promise<Proposal> {
  const { rows } = await getPool().query<ProposalRow>(
    `UPDATE proposals SET payload = $2::jsonb WHERE id = $1 RETURNING *`,
    [id, JSON.stringify(payload)],
  );
  return rowToProposal(rows[0]);
}
