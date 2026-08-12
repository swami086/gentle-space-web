import type { CampaignStatus, Platform } from "../types";
import type { Authority } from "../attribution/quarantine";
import type { AttributionResidual } from "../attribution/reconcile";
import { trailingWindow, type AttributionWindow } from "../attribution/window";
import { readAttribution } from "./attribution";
import { listCorridors } from "./corridors";
import { scopeClause, type Scope } from "./scope-sql";
import { withTenantTransaction } from "./tx";

export type OverviewStats = {
  activeCampaignCount: number;
  pendingProposalCount: number;
  monthSpendInr: number;
  /** Platform-reported conversions from performance_snapshots. Not our enquiry count. */
  blendedCplInr: number | null;
  /** Our own enquiries, from the attribution rollup. Null when the window is uncomputed. */
  costPerEnquiryInr: number | null;
  attributionIsStale: boolean;
};

export async function getOverviewStats(scope: Scope): Promise<OverviewStats> {
  const s = scopeClause(scope);
  return withTenantTransaction(scope, async (client) => {
    const [activeResult, pendingResult, spendResult] = await Promise.all([
      client.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM adsagent.campaigns
          WHERE ${s.sql} AND status = 'active'`,
        [...s.params],
      ),
      client.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM adsagent.proposals
          WHERE ${s.sql} AND status = 'pending'`,
        [...s.params],
      ),
      client.query<{ spend: string; conversions: string }>(
        `SELECT COALESCE(SUM(spend), 0) AS spend, COALESCE(SUM(conversions), 0) AS conversions
           FROM adsagent.performance_snapshots
          WHERE ${s.sql} AND captured_at >= date_trunc('month', now())`,
        [...s.params],
      ),
    ]);

    const monthSpendInr = Number(spendResult.rows[0].spend);
    const monthConversions = Number(spendResult.rows[0].conversions);
    const attribution = await getCorridorCosts(scope, 30, new Date());

    return {
      activeCampaignCount: Number(activeResult.rows[0].count),
      pendingProposalCount: Number(pendingResult.rows[0].count),
      monthSpendInr,
      blendedCplInr: monthConversions > 0 ? monthSpendInr / monthConversions : null,
      costPerEnquiryInr:
        attribution && attribution.totals.enquiryCount > 0
          ? attribution.totals.spendInr / attribution.totals.enquiryCount
          : null,
      attributionIsStale: attribution?.isStale ?? false,
    };
  });
}

export type TrendPoint = { date: string; spendInr: number; cplInr: number | null };

type TrendRow = { day: Date; spend: string; conversions: string };

export async function getSpendCplTrend(scope: Scope, days: number): Promise<TrendPoint[]> {
  const s = scopeClause(scope);
  return withTenantTransaction(scope, async (client) => {
    const { rows } = await client.query<TrendRow>(
      `SELECT date_trunc('day', captured_at) AS day,
              COALESCE(SUM(spend), 0) AS spend,
              COALESCE(SUM(conversions), 0) AS conversions
         FROM adsagent.performance_snapshots
        WHERE ${s.sql} AND captured_at >= NOW() - ($2 || ' days')::interval
        GROUP BY day
        ORDER BY day ASC`,
      [...s.params, days],
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

export async function listCampaignsWithLatestCpl(scope: Scope): Promise<CampaignWithCplRow[]> {
  const s = scopeClause(scope, "c.org_id");
  return withTenantTransaction(scope, async (client) => {
    const { rows } = await client.query<CampaignWithCplSqlRow>(
      `SELECT c.id, c.name, c.platform, c.status, c.daily_budget,
              cor.display_name AS corridor, latest.cpl AS latest_cpl
         FROM adsagent.campaigns c
         LEFT JOIN public.corridors cor ON cor.id = c.corridor_id
         LEFT JOIN LATERAL (
           SELECT p.cpl FROM adsagent.performance_snapshots p
            WHERE p.campaign_id = c.id AND p.org_id = c.org_id
            ORDER BY p.captured_at DESC
            LIMIT 1
         ) latest ON true
        WHERE ${s.sql}
        ORDER BY c.created_at DESC`,
      [...s.params],
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
  });
}

export type CorridorCostRow = {
  corridorId: string;
  corridorName: string;
  spendInr: number;
  enquiryCount: number;
  costPerEnquiryInr: number | null;
  authority: Authority;
};

export type CorridorCostSummary = {
  window: AttributionWindow;
  rows: CorridorCostRow[];
  residual: AttributionResidual;
  lateEnquiryCount: number;
  totals: { spendInr: number; enquiryCount: number };
  isStale: boolean;
  cdcLagSeconds: number;
  authority: Authority;
};

/** Reads the projected rollup from the `derived` quarantine — one indexed Postgres query,
 *  not a live ClickHouse aggregate on every page render. Returns null when the window has
 *  never been computed; zeroes would be indistinguishable from a genuinely quiet week. */
export async function getCorridorCosts(
  scope: Scope,
  days: number,
  now: Date,
): Promise<CorridorCostSummary | null> {
  const window = trailingWindow(days, now);
  const [stored, corridors] = await Promise.all([readAttribution(scope, window), listCorridors(scope)]);
  if (!stored) return null;

  const nameById = new Map(corridors.map((c) => [c.id, c.displayName]));

  return {
    window: stored.window,
    rows: stored.corridors.map((c) => ({
      corridorId: c.corridorId,
      corridorName: nameById.get(c.corridorId) ?? "Unnamed corridor",
      spendInr: c.spendInr,
      enquiryCount: c.enquiryCount,
      costPerEnquiryInr: c.costPerEnquiryInr,
      authority: c.authority,
    })),
    residual: stored.residual,
    lateEnquiryCount: stored.lateEnquiryCount,
    totals: stored.totals,
    isStale: stored.freshness.isStale,
    cdcLagSeconds: stored.freshness.cdcLagSeconds,
    authority: stored.authority,
  };
}
