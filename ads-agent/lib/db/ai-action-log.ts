import { getPool } from "./client";

export type AiActionDomain = "marketing" | "crm";

export type AiActionLogEntry = {
  id: string;
  domain: AiActionDomain;
  summary: string;
  createdAt: string;
};

type AiActionLogRow = { id: string; domain: AiActionDomain; summary: string; created_at: Date };

/** Records one real, already-happened automated action — the decision engine creating proposals
 * (domain: "marketing") or the CRM Assistant advancing a lead's stage (domain: "crm"). Never called
 * speculatively for actions that don't actually happen yet (see plan's Global Constraints). */
export async function logAiAction(input: { domain: AiActionDomain; summary: string }): Promise<void> {
  await getPool().query(`INSERT INTO ai_action_log (domain, summary) VALUES ($1, $2)`, [
    input.domain,
    input.summary,
  ]);
}

export async function countAiActionsToday(): Promise<number> {
  const { rows } = await getPool().query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM ai_action_log WHERE created_at >= date_trunc('day', now())`,
  );
  return Number(rows[0].count);
}

export async function listRecentAiActions(limit: number): Promise<AiActionLogEntry[]> {
  const { rows } = await getPool().query<AiActionLogRow>(
    `SELECT id, domain, summary, created_at FROM ai_action_log ORDER BY created_at DESC LIMIT $1`,
    [limit],
  );
  return rows.map((row) => ({
    id: row.id,
    domain: row.domain,
    summary: row.summary,
    createdAt: row.created_at.toISOString(),
  }));
}
