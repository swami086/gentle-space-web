import type { Scope } from "../db/scope-sql";
import type { CorridorEnquiryRow, CorridorSpendRow } from "./reconcile";
import type { AttributionWindow } from "./window";

/** Injected so the rollup is testable without a running ClickHouse. The concrete
 *  implementation is the S6 client; this module is the only place S7 touches it. */
export type AnalyticalQuery = <T>(sql: string, params: Record<string, unknown>) => Promise<T[]>;

type SpendSqlRow = { corridor_id: string | null; spend_inr: string | number };
type EnquirySqlRow = { corridor_id: string | null; enquiry_count: string | number };
type WatermarkSqlRow = { watermark: string };

export function corridorSpendSql(): string {
  return `SELECT corridor_id, sum(spend_inr) AS spend_inr
            FROM spend_fact
           WHERE org_id = {org_id:UUID}
             AND captured_on >= {start:Date}
             AND captured_on <= {end:Date}
        GROUP BY corridor_id`;
}

export function corridorEnquirySql(): string {
  return `SELECT corridor_id, count() AS enquiry_count
            FROM enquiry_fact
           WHERE org_id = {org_id:UUID}
             AND occurred_on >= {start:Date}
             AND occurred_on <= {end:Date}
        GROUP BY corridor_id`;
}

export function sourceWatermarkSql(): string {
  return `SELECT min(watermark) AS watermark
            FROM cdc_watermark
           WHERE org_id = {org_id:UUID}
             AND source IN ('spend_fact', 'enquiry_fact')`;
}

/** Both scope kinds resolve to a single org here. Cross-tenant analytics is the privileged
 *  audited path (datastore spec §5.1) and is not built by S7. */
function windowParams(scope: Scope, w: AttributionWindow): Record<string, unknown> {
  return { org_id: scope.orgId, start: w.startDate, end: w.endDate };
}

export async function fetchCorridorSpend(
  scope: Scope,
  query: AnalyticalQuery,
  w: AttributionWindow,
): Promise<CorridorSpendRow[]> {
  const rows = await query<SpendSqlRow>(corridorSpendSql(), windowParams(scope, w));
  return rows.map((r) => ({ corridorId: r.corridor_id ?? null, spendInr: Number(r.spend_inr) }));
}

export async function fetchCorridorEnquiries(
  scope: Scope,
  query: AnalyticalQuery,
  w: AttributionWindow,
): Promise<CorridorEnquiryRow[]> {
  const rows = await query<EnquirySqlRow>(corridorEnquirySql(), windowParams(scope, w));
  return rows.map((r) => ({ corridorId: r.corridor_id ?? null, enquiryCount: Number(r.enquiry_count) }));
}

export async function fetchSourceWatermark(scope: Scope, query: AnalyticalQuery): Promise<Date> {
  const rows = await query<WatermarkSqlRow>(sourceWatermarkSql(), { org_id: scope.orgId });
  const raw = rows[0]?.watermark;
  // Defaulting to now() would make stalled or empty CDC look perfectly fresh, which is
  // exactly the silent degradation datastore §12.1 exists to prevent.
  if (!raw) throw new Error(`the analytical mirror reports no watermark for org ${scope.orgId}`);
  return new Date(`${raw.replace(" ", "T")}Z`);
}
