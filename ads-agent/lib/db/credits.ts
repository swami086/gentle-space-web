import { scopeClause, type Scope } from "./scope-sql";
import { withTenantTransaction } from "./tx";

export type OrgBalanceRow = { orgId: string; orgName: string; balanceCredits: number };

/**
 * Platform scope only. This lists every org on the platform, so there is no
 * org-scoped reading of it. It throws rather than returning an empty array:
 * an empty list is indistinguishable from a platform user whose deployment has
 * no orgs, and a caller that silently sees nothing does not get fixed.
 */
export async function listOrgBalances(scope: Scope): Promise<OrgBalanceRow[]> {
  if (scope.kind !== "platform") {
    throw new Error("listOrgBalances requires platform scope");
  }
  return withTenantTransaction(scope, async (client) => {
    const { rows } = await client.query<{
      org_id: string;
      org_name: string;
      balance_credits: string;
    }>(
      `SELECT o.id AS org_id, o.name AS org_name, COALESCE(b.balance_credits, 0) AS balance_credits
         FROM public.orgs o
         LEFT JOIN adsagent.org_balances b ON b.org_id = o.id
        ORDER BY o.created_at ASC`,
    );
    return rows.map((row) => ({
      orgId: row.org_id,
      orgName: row.org_name,
      balanceCredits: Number(row.balance_credits),
    }));
  });
}

export type MemberBalanceRow = {
  userId: string;
  email: string;
  displayName: string | null;
  capCredits: number | null;
};

export async function listMemberBalances(scope: Scope): Promise<MemberBalanceRow[]> {
  const s = scopeClause(scope, "u.org_id");
  return withTenantTransaction(scope, async (client) => {
    const { rows } = await client.query<{
      user_id: string;
      email: string;
      display_name: string | null;
      cap_credits: string | null;
    }>(
      `SELECT u.id AS user_id, u.email, u.display_name, ub.balance_credits AS cap_credits
         FROM public.users u
         LEFT JOIN adsagent.user_balances ub ON ub.user_id = u.id
        WHERE ${s.sql}
        ORDER BY u.created_at ASC`,
      [...s.params],
    );
    return rows.map((row) => ({
      userId: row.user_id,
      email: row.email,
      displayName: row.display_name,
      capCredits: row.cap_credits === null ? null : Number(row.cap_credits),
    }));
  });
}

export type SpendByKeyRow = { key: string; totalCredits: number; totalCostUsd: number };

async function spendByColumn(
  scope: Scope,
  days: number,
  column: "feature" | "model",
): Promise<SpendByKeyRow[]> {
  // `column` is a closed union, never caller-supplied text, so interpolating it
  // cannot inject. Every value is parameterised.
  const s = scopeClause(scope);
  return withTenantTransaction(scope, async (client) => {
    const { rows } = await client.query<{
      key: string;
      total_credits: string;
      total_cost_usd: string;
    }>(
      `SELECT ${column} AS key,
              COALESCE(SUM(credits_debited), 0) AS total_credits,
              COALESCE(SUM(cost_usd), 0) AS total_cost_usd
         FROM adsagent.usage_ledger
        WHERE ${s.sql} AND occurred_at >= NOW() - ($2 || ' days')::interval
        GROUP BY ${column}
        ORDER BY total_credits DESC`,
      [...s.params, days],
    );
    return rows.map((row) => ({
      key: row.key,
      totalCredits: Number(row.total_credits),
      totalCostUsd: Number(row.total_cost_usd),
    }));
  });
}

export async function getSpendByFeature(scope: Scope, days: number): Promise<SpendByKeyRow[]> {
  return spendByColumn(scope, days, "feature");
}

export async function getSpendByModel(scope: Scope, days: number): Promise<SpendByKeyRow[]> {
  return spendByColumn(scope, days, "model");
}

export type SpendTrendPoint = { date: string; totalCredits: number };

type TrendRow = { day: Date; total_credits: string };

export async function getSpendTrend(scope: Scope, days: number): Promise<SpendTrendPoint[]> {
  const s = scopeClause(scope);
  return withTenantTransaction(scope, async (client) => {
    const { rows } = await client.query<TrendRow>(
      `SELECT date_trunc('day', occurred_at) AS day,
              COALESCE(SUM(credits_debited), 0) AS total_credits
         FROM adsagent.usage_ledger
        WHERE ${s.sql} AND occurred_at >= NOW() - ($2 || ' days')::interval
        GROUP BY day
        ORDER BY day ASC`,
      [...s.params, days],
    );
    return rows.map((row) => ({
      date: row.day.toISOString().slice(0, 10),
      totalCredits: Number(row.total_credits),
    }));
  });
}
