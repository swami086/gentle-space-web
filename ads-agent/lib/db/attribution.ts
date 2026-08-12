import {
  assertConserved,
  type AttributionResidual,
  type AttributionResult,
  type CorridorAttribution,
} from "../attribution/reconcile";
import { freshness, type AttributionFreshness } from "../attribution/freshness";
import type { Authority } from "../attribution/quarantine";
import type { AttributionWindow, WindowState } from "../attribution/window";
import { getPool } from "./client";
import { scopeClause, type Scope } from "./scope-sql";

export type StoredCorridorAttribution = CorridorAttribution & { authority: Authority };

export type StoredAttribution = {
  window: AttributionWindow;
  windowState: WindowState;
  corridors: StoredCorridorAttribution[];
  residual: AttributionResidual;
  lateEnquiryCount: number;
  totals: { spendInr: number; enquiryCount: number };
  freshness: AttributionFreshness;
  authority: Authority;
};

type CorridorSqlRow = {
  corridor_id: string | null;
  spend_inr: string;
  enquiry_count: number;
  cost_per_enquiry_inr: string | null;
  late_enquiry_count: number;
  window_state: WindowState;
  computed_at: Date;
  source_watermark: Date;
  cdc_lag_seconds: number;
};

type ReconciliationSqlRow = {
  total_spend_inr: string;
  total_enquiry_count: number;
  unattributed_spend_inr: string;
  unattributed_enquiry_count: number;
  spend_without_enquiries_inr: string;
  enquiries_without_spend_count: number;
  late_enquiry_count: number;
};

export async function writeAttribution(
  scope: Scope,
  result: AttributionResult,
  f: AttributionFreshness,
): Promise<void> {
  assertConserved(result);

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT public.set_tenant($1)", [scope.orgId]);

    const rows: {
      corridorId: string | null;
      spendInr: number;
      enquiryCount: number;
      costPerEnquiryInr: number | null;
    }[] = [
      ...result.corridors,
      {
        corridorId: null,
        spendInr: result.residual.unattributedSpendInr,
        enquiryCount: result.residual.unattributedEnquiryCount,
        costPerEnquiryInr:
          result.residual.unattributedEnquiryCount > 0
            ? result.residual.unattributedSpendInr / result.residual.unattributedEnquiryCount
            : null,
      },
    ];

    for (const row of rows) {
      await client.query(
        `INSERT INTO derived.corridor_attribution_daily
           (org_id, corridor_id, window_start, window_end, window_state,
            spend_inr, enquiry_count, cost_per_enquiry_inr, late_enquiry_count,
            computed_at, source_watermark, cdc_lag_seconds)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (org_id, corridor_id, window_start, window_end) DO UPDATE SET
           window_state         = EXCLUDED.window_state,
           spend_inr            = EXCLUDED.spend_inr,
           enquiry_count        = EXCLUDED.enquiry_count,
           cost_per_enquiry_inr = EXCLUDED.cost_per_enquiry_inr,
           late_enquiry_count   = EXCLUDED.late_enquiry_count,
           computed_at          = EXCLUDED.computed_at,
           source_watermark     = EXCLUDED.source_watermark,
           cdc_lag_seconds      = EXCLUDED.cdc_lag_seconds`,
        [
          scope.orgId,
          row.corridorId,
          result.window.startDate,
          result.window.endDate,
          result.windowState,
          row.spendInr,
          row.enquiryCount,
          row.costPerEnquiryInr,
          result.lateEnquiryCount,
          f.computedAt,
          f.sourceWatermark,
          f.cdcLagSeconds,
        ],
      );
    }

    await client.query(
      `INSERT INTO derived.attribution_reconciliation
         (org_id, window_start, window_end, window_state,
          total_spend_inr, total_enquiry_count,
          unattributed_spend_inr, unattributed_enquiry_count,
          spend_without_enquiries_inr, enquiries_without_spend_count,
          late_enquiry_count, computed_at, source_watermark, cdc_lag_seconds)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (org_id, window_start, window_end) DO UPDATE SET
         window_state                  = EXCLUDED.window_state,
         total_spend_inr               = EXCLUDED.total_spend_inr,
         total_enquiry_count           = EXCLUDED.total_enquiry_count,
         unattributed_spend_inr        = EXCLUDED.unattributed_spend_inr,
         unattributed_enquiry_count    = EXCLUDED.unattributed_enquiry_count,
         spend_without_enquiries_inr   = EXCLUDED.spend_without_enquiries_inr,
         enquiries_without_spend_count = EXCLUDED.enquiries_without_spend_count,
         late_enquiry_count            = EXCLUDED.late_enquiry_count,
         computed_at                   = EXCLUDED.computed_at,
         source_watermark              = EXCLUDED.source_watermark,
         cdc_lag_seconds               = EXCLUDED.cdc_lag_seconds`,
      [
        scope.orgId,
        result.window.startDate,
        result.window.endDate,
        result.windowState,
        result.totals.spendInr,
        result.totals.enquiryCount,
        result.residual.unattributedSpendInr,
        result.residual.unattributedEnquiryCount,
        result.residual.spendWithoutEnquiriesInr,
        result.residual.enquiriesWithoutSpendCount,
        result.lateEnquiryCount,
        f.computedAt,
        f.sourceWatermark,
        f.cdcLagSeconds,
      ],
    );

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function readAttribution(
  scope: Scope,
  w: AttributionWindow,
): Promise<StoredAttribution | null> {
  const s = scopeClause(scope, "org_id");
  const n = s.params.length;

  const corridorResult = await getPool().query<CorridorSqlRow>(
    `SELECT corridor_id, spend_inr, enquiry_count, cost_per_enquiry_inr, late_enquiry_count,
            window_state, computed_at, source_watermark, cdc_lag_seconds
       FROM derived.corridor_attribution_daily
      WHERE ${s.sql} AND window_start = $${n + 1} AND window_end = $${n + 2}
      ORDER BY spend_inr DESC`,
    [...s.params, w.startDate, w.endDate],
  );
  if (corridorResult.rows.length === 0) return null;

  const reconciliationResult = await getPool().query<ReconciliationSqlRow>(
    `SELECT total_spend_inr, total_enquiry_count,
            unattributed_spend_inr, unattributed_enquiry_count,
            spend_without_enquiries_inr, enquiries_without_spend_count, late_enquiry_count
       FROM derived.attribution_reconciliation
      WHERE ${s.sql} AND window_start = $${n + 1} AND window_end = $${n + 2}`,
    [...s.params, w.startDate, w.endDate],
  );
  const r = reconciliationResult.rows[0];
  if (!r) return null;

  const head = corridorResult.rows[0];
  return {
    window: w,
    windowState: head.window_state,
    corridors: corridorResult.rows
      .filter((row) => row.corridor_id !== null)
      .map((row) => ({
        corridorId: row.corridor_id as string,
        spendInr: Number(row.spend_inr),
        enquiryCount: row.enquiry_count,
        costPerEnquiryInr: row.cost_per_enquiry_inr === null ? null : Number(row.cost_per_enquiry_inr),
        authority: "derived" as const,
      })),
    residual: {
      unattributedSpendInr: Number(r.unattributed_spend_inr),
      unattributedEnquiryCount: r.unattributed_enquiry_count,
      spendWithoutEnquiriesInr: Number(r.spend_without_enquiries_inr),
      enquiriesWithoutSpendCount: r.enquiries_without_spend_count,
    },
    lateEnquiryCount: r.late_enquiry_count,
    totals: { spendInr: Number(r.total_spend_inr), enquiryCount: r.total_enquiry_count },
    freshness: freshness(head.computed_at, head.source_watermark),
    authority: "derived",
  };
}
