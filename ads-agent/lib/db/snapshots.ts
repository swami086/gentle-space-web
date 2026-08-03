import type {
  CrmSignalSnapshot,
  NewCrmSignalSnapshot,
  NewPerformanceSnapshot,
  PerformanceSnapshot,
} from "../types";
import { getPool } from "./client";

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

export async function recordPerformanceSnapshot(input: NewPerformanceSnapshot): Promise<void> {
  const cpl = input.conversions > 0 ? input.spend / input.conversions : null;
  await getPool().query(
    `INSERT INTO performance_snapshots
       (campaign_id, spend, clicks, impressions, conversions, cpl, raw)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [
      input.campaignId,
      input.spend,
      input.clicks,
      input.impressions,
      input.conversions,
      cpl,
      JSON.stringify(input.raw ?? {}),
    ],
  );
}

export async function recentPerformanceSnapshots(days: number): Promise<PerformanceSnapshot[]> {
  const { rows } = await getPool().query<PerformanceSnapshotRow>(
    `SELECT * FROM performance_snapshots
     WHERE captured_at >= NOW() - INTERVAL '${days} days'
     ORDER BY campaign_id, captured_at DESC`,
    [],
  );
  return rows.map(rowToPerformanceSnapshot);
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

export async function recordCrmSignalSnapshot(input: NewCrmSignalSnapshot): Promise<void> {
  await getPool().query(
    `INSERT INTO crm_signal_snapshots (campaign_id, hot_count, warm_count, cold_count, unscored_count)
     VALUES ($1, $2, $3, $4, $5)`,
    [input.campaignId, input.hotCount, input.warmCount, input.coldCount, input.unscoredCount],
  );
}

export async function latestCrmSignalSnapshot(): Promise<CrmSignalSnapshot | null> {
  const { rows } = await getPool().query<CrmSignalSnapshotRow>(
    `SELECT * FROM crm_signal_snapshots ORDER BY captured_at DESC LIMIT 1`,
  );
  return rows[0] ? rowToCrmSignalSnapshot(rows[0]) : null;
}
