import type { CampaignStatus, Platform } from "../types";
import { getPool } from "./client";

export type OverviewStats = {
  activeCampaignCount: number;
  pendingProposalCount: number;
  monthSpendInr: number;
  blendedCplInr: number | null;
};

export async function getOverviewStats(): Promise<OverviewStats> {
  const [activeResult, pendingResult, spendResult] = await Promise.all([
    getPool().query<{ count: string }>(`SELECT COUNT(*) AS count FROM campaigns WHERE status = 'active'`),
    getPool().query<{ count: string }>(`SELECT COUNT(*) AS count FROM proposals WHERE status = 'pending'`),
    getPool().query<{ spend: string; conversions: string }>(
      `SELECT COALESCE(SUM(spend), 0) AS spend, COALESCE(SUM(conversions), 0) AS conversions
       FROM performance_snapshots
       WHERE captured_at >= date_trunc('month', now())`,
    ),
  ]);

  const monthSpendInr = Number(spendResult.rows[0].spend);
  const monthConversions = Number(spendResult.rows[0].conversions);

  return {
    activeCampaignCount: Number(activeResult.rows[0].count),
    pendingProposalCount: Number(pendingResult.rows[0].count),
    monthSpendInr,
    blendedCplInr: monthConversions > 0 ? monthSpendInr / monthConversions : null,
  };
}

export type TrendPoint = { date: string; spendInr: number; cplInr: number | null };

type TrendRow = { day: Date; spend: string; conversions: string };

export async function getSpendCplTrend(days: number): Promise<TrendPoint[]> {
  const { rows } = await getPool().query<TrendRow>(
    `SELECT date_trunc('day', captured_at) AS day,
            COALESCE(SUM(spend), 0) AS spend,
            COALESCE(SUM(conversions), 0) AS conversions
     FROM performance_snapshots
     WHERE captured_at >= NOW() - INTERVAL '${days} days'
     GROUP BY day
     ORDER BY day ASC`,
  );

  return rows.map((row) => {
    const spendInr = Number(row.spend);
    const conversions = Number(row.conversions);
    return {
      date: row.day.toISOString().slice(0, 10),
      spendInr,
      cplInr: conversions > 0 ? spendInr / conversions : null,
    };
  });
}

export type CampaignWithCplRow = {
  id: string;
  name: string;
  platform: Platform;
  status: CampaignStatus;
  dailyBudget: number | null;
  corridor: string | null;
  latestCplInr: number | null;
};

type CampaignWithCplSqlRow = {
  id: string;
  name: string;
  platform: Platform;
  status: CampaignStatus;
  daily_budget: string | null;
  corridor: string | null;
  latest_cpl: string | null;
};

export async function listCampaignsWithLatestCpl(): Promise<CampaignWithCplRow[]> {
  const { rows } = await getPool().query<CampaignWithCplSqlRow>(
    `SELECT c.id, c.name, c.platform, c.status, c.daily_budget, c.corridor, latest.cpl AS latest_cpl
     FROM campaigns c
     LEFT JOIN LATERAL (
       SELECT cpl FROM performance_snapshots
       WHERE campaign_id = c.id
       ORDER BY captured_at DESC
       LIMIT 1
     ) latest ON true
     ORDER BY c.created_at DESC`,
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    platform: row.platform,
    status: row.status,
    dailyBudget: row.daily_budget === null ? null : Number(row.daily_budget),
    corridor: row.corridor,
    latestCplInr: row.latest_cpl === null ? null : Number(row.latest_cpl),
  }));
}
