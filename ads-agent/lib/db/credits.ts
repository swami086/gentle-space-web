import { getPool } from "./client";

export type OrgBalanceRow = { orgId: string; orgName: string; balanceCredits: number };

export async function listOrgBalances(): Promise<OrgBalanceRow[]> {
  const { rows } = await getPool().query<{ org_id: string; org_name: string; balance_credits: string }>(
    `SELECT o.id AS org_id, o.name AS org_name, COALESCE(b.balance_credits, 0) AS balance_credits
     FROM orgs o
     LEFT JOIN org_balances b ON b.org_id = o.id
     ORDER BY o.created_at ASC`,
  );
  return rows.map((row) => ({
    orgId: row.org_id,
    orgName: row.org_name,
    balanceCredits: Number(row.balance_credits),
  }));
}

export type MemberBalanceRow = {
  userId: string;
  email: string;
  displayName: string | null;
  capCredits: number | null;
};

export async function listMemberBalances(orgId: string): Promise<MemberBalanceRow[]> {
  const { rows } = await getPool().query<{
    user_id: string;
    email: string;
    display_name: string | null;
    cap_credits: string | null;
  }>(
    `SELECT u.id AS user_id, u.email, u.display_name, ub.balance_credits AS cap_credits
     FROM users u
     LEFT JOIN user_balances ub ON ub.user_id = u.id
     WHERE u.org_id = $1
     ORDER BY u.created_at ASC`,
    [orgId],
  );
  return rows.map((row) => ({
    userId: row.user_id,
    email: row.email,
    displayName: row.display_name,
    capCredits: row.cap_credits === null ? null : Number(row.cap_credits),
  }));
}

export type SpendByKeyRow = { key: string; totalCredits: number; totalCostUsd: number };

async function spendByColumn(orgId: string, days: number, column: "feature" | "model"): Promise<SpendByKeyRow[]> {
  const { rows } = await getPool().query<{ key: string; total_credits: string; total_cost_usd: string }>(
    `SELECT ${column} AS key,
            COALESCE(SUM(credits_debited), 0) AS total_credits,
            COALESCE(SUM(cost_usd), 0) AS total_cost_usd
     FROM usage_ledger
     WHERE org_id = $1 AND occurred_at >= NOW() - ($2 || ' days')::interval
     GROUP BY ${column}
     ORDER BY total_credits DESC`,
    [orgId, days],
  );
  return rows.map((row) => ({
    key: row.key,
    totalCredits: Number(row.total_credits),
    totalCostUsd: Number(row.total_cost_usd),
  }));
}

export async function getSpendByFeature(orgId: string, days: number): Promise<SpendByKeyRow[]> {
  return spendByColumn(orgId, days, "feature");
}

export async function getSpendByModel(orgId: string, days: number): Promise<SpendByKeyRow[]> {
  return spendByColumn(orgId, days, "model");
}

export type SpendTrendPoint = { date: string; totalCredits: number };

type TrendRow = { day: Date; total_credits: string };

export async function getSpendTrend(orgId: string, days: number): Promise<SpendTrendPoint[]> {
  const { rows } = await getPool().query<TrendRow>(
    `SELECT date_trunc('day', occurred_at) AS day, COALESCE(SUM(credits_debited), 0) AS total_credits
     FROM usage_ledger
     WHERE org_id = $1 AND occurred_at >= NOW() - ($2 || ' days')::interval
     GROUP BY day
     ORDER BY day ASC`,
    [orgId, days],
  );
  return rows.map((row) => ({
    date: row.day.toISOString().slice(0, 10),
    totalCredits: Number(row.total_credits),
  }));
}
