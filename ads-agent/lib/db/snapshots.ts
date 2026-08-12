import type {
  CrmSignalSnapshot,
  NewCrmSignalSnapshot,
  NewPerformanceSnapshot,
  PerformanceSnapshot,
} from "../types";
import { scopeClause, type Scope } from "./scope-sql";
import { withTenantTransaction } from "./tx";

type PerformanceSnapshotRow = {
  id: string;
  campaign_id: string;
  captured_at: Date;
  spend: string;
  clicks: number;
  impressions: number;
  conversions: number;
  cpl: string | null;
};

function rowToPerformanceSnapshot(row: PerformanceSnapshotRow): PerformanceSnapshot {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    capturedAt: row.captured_at.toISOString(),
    spend: Number(row.spend),
    clicks: row.clicks,
    impressions: row.impressions,
    conversions: row.conversions,
    cpl: row.cpl === null ? null : Number(row.cpl),
  };
}

export async function recordPerformanceSnapshot(
  scope: Scope,
  input: NewPerformanceSnapshot,
): Promise<void> {
  const cpl = input.conversions > 0 ? input.spend / input.conversions : null;
  const s = scopeClause(scope, "c.org_id");
  await withTenantTransaction(scope, async (client) => {
    // org_id comes from the parent campaign, inside the caller's scope, so a
    // snapshot cannot be attached to another tenant's campaign. It is also
    // stored on the row, so the row carries its own RLS policy.
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO adsagent.performance_snapshots
         (org_id, campaign_id, spend, clicks, impressions, conversions, cpl, raw)
       SELECT c.org_id, c.id, $3, $4, $5, $6, $7, $8::jsonb
         FROM adsagent.campaigns c
        WHERE ${s.sql} AND c.id = $2
       RETURNING id`,
      [
        ...s.params,
        input.campaignId,
        input.spend,
        input.clicks,
        input.impressions,
        input.conversions,
        cpl,
        JSON.stringify(input.raw ?? {}),
      ],
    );
    if (!rows[0]) throw new Error(`campaign ${input.campaignId} not found`);
  });
}

export async function recentPerformanceSnapshots(
  scope: Scope,
  days: number,
): Promise<PerformanceSnapshot[]> {
  const s = scopeClause(scope);
  return withTenantTransaction(scope, async (client) => {
    const { rows } = await client.query<PerformanceSnapshotRow>(
      `SELECT * FROM adsagent.performance_snapshots
        WHERE ${s.sql} AND captured_at >= NOW() - ($2 || ' days')::interval
        ORDER BY campaign_id, captured_at DESC`,
      [...s.params, days],
    );
    return rows.map(rowToPerformanceSnapshot);
  });
}

type CrmSignalSnapshotRow = {
  id: string;
  campaign_id: string | null;
  captured_at: Date;
  hot_count: number;
  warm_count: number;
  cold_count: number;
  unscored_count: number;
};

function rowToCrmSignalSnapshot(row: CrmSignalSnapshotRow): CrmSignalSnapshot {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    capturedAt: row.captured_at.toISOString(),
    hotCount: row.hot_count,
    warmCount: row.warm_count,
    coldCount: row.cold_count,
    unscoredCount: row.unscored_count,
  };
}

export async function recordCrmSignalSnapshot(
  scope: Scope,
  input: NewCrmSignalSnapshot,
): Promise<void> {
  // campaign_id is nullable here, so there is no parent to inherit from; the
  // caller's own org_id is the owner.
  const s = scopeClause(scope);
  await withTenantTransaction(scope, (client) =>
    client.query(
      `INSERT INTO adsagent.crm_signal_snapshots
         (org_id, campaign_id, hot_count, warm_count, cold_count, unscored_count)
       VALUES ($1::uuid, $2, $3, $4, $5, $6)`,
      [
        ...s.params,
        input.campaignId,
        input.hotCount,
        input.warmCount,
        input.coldCount,
        input.unscoredCount,
      ],
    ),
  );
}

export async function latestCrmSignalSnapshot(scope: Scope): Promise<CrmSignalSnapshot | null> {
  const s = scopeClause(scope);
  return withTenantTransaction(scope, async (client) => {
    const { rows } = await client.query<CrmSignalSnapshotRow>(
      `SELECT * FROM adsagent.crm_signal_snapshots
        WHERE ${s.sql}
        ORDER BY captured_at DESC LIMIT 1`,
      [...s.params],
    );
    return rows[0] ? rowToCrmSignalSnapshot(rows[0]) : null;
  });
}
