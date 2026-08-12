import { getPool } from "../db/client";
import { sendAlert } from "../observability/alert";
import { chQuery } from "./client";
import { computeCutoff } from "./replicate";

export type CountRow = { org_id: string; occurred_on: string; rows: number };
export type Divergence = { orgId: string; occurredOn: string; sourceRows: number; mirrorRows: number };
export type ReconciliationReport = {
  cutoff: string;
  lagSeconds: number;
  divergences: Divergence[];
  sampleMismatches: string[];
};

const SOURCE_TABLE = "adsagent.enquiries";

export function compareCounts(source: CountRow[], mirror: CountRow[]): Divergence[] {
  const key = (row: CountRow) => `${row.org_id}|${row.occurred_on}`;
  const mirrorByKey = new Map(mirror.map((row) => [key(row), Number(row.rows)]));
  const divergences: Divergence[] = [];

  for (const row of source) {
    const mirrorRows = mirrorByKey.get(key(row)) ?? 0;
    if (Number(row.rows) !== mirrorRows) {
      divergences.push({
        orgId: row.org_id,
        occurredOn: row.occurred_on,
        sourceRows: Number(row.rows),
        mirrorRows,
      });
    }
    mirrorByKey.delete(key(row));
  }
  for (const [remaining, mirrorRows] of mirrorByKey) {
    const [orgId, occurredOn] = remaining.split("|");
    divergences.push({ orgId, occurredOn, sourceRows: 0, mirrorRows });
  }
  return divergences;
}

export function evaluateReport(
  report: ReconciliationReport,
  lagAlertSeconds: number,
): { ok: boolean; alert: string | null } {
  const problems: string[] = [];
  if (report.lagSeconds > lagAlertSeconds) {
    problems.push(`cdc lag ${report.lagSeconds}s exceeds ${lagAlertSeconds}s`);
  }
  for (const d of report.divergences) {
    problems.push(`${d.orgId}/${d.occurredOn} source=${d.sourceRows} mirror=${d.mirrorRows}`);
  }
  problems.push(...report.sampleMismatches);
  return problems.length === 0 ? { ok: true, alert: null } : { ok: false, alert: problems.join("; ") };
}

export async function reconcileEnquiries(
  options: { toleranceSeconds?: number; sampleSize?: number } = {},
): Promise<ReconciliationReport> {
  const toleranceSeconds = options.toleranceSeconds ?? Number(process.env.RECONCILE_LAG_TOLERANCE_SECONDS ?? "120");
  const sampleSize = options.sampleSize ?? 50;
  const cutoff = await computeCutoff(toleranceSeconds);

  const source = await getPool().query<CountRow>(
    `SELECT org_id::text AS org_id, to_char(first_seen_at::date, 'YYYY-MM-DD') AS occurred_on, count(*)::int AS rows
       FROM adsagent.enquiries
      WHERE updated_at <= $1::timestamptz
      GROUP BY 1, 2`,
    [cutoff],
  );

  const mirror = await chQuery<CountRow>(
    `SELECT toString(org_id) AS org_id, toString(occurred_on) AS occurred_on, toUInt32(count()) AS rows
       FROM analytics.enquiry_fact FINAL
      WHERE updated_at <= {cutoff:DateTime64(3)}
      GROUP BY 1, 2`,
    { params: { cutoff } },
  );

  const { rows: lagRows } = await getPool().query<{ source_max: string | null }>(
    `SELECT to_char(max(updated_at), 'YYYY-MM-DD HH24:MI:SS.MS') AS source_max FROM adsagent.enquiries`,
  );
  const [mirrorMax] = await chQuery<{ mirror_max: string }>(
    `SELECT formatDateTime(max(updated_at), '%Y-%m-%d %H:%i:%S') AS mirror_max FROM analytics.enquiry_fact FINAL`,
  );
  const sourceMs = lagRows[0].source_max ? Date.parse(`${lagRows[0].source_max}Z`) : 0;
  const mirrorMs = mirrorMax?.mirror_max ? Date.parse(`${mirrorMax.mirror_max}Z`) : 0;
  const lagSeconds = sourceMs === 0 ? 0 : Math.max(0, Math.round((sourceMs - mirrorMs) / 1000));

  const sample = await getPool().query<{ id: string; reply_state: string }>(
    `SELECT id::text AS id, reply_state FROM adsagent.enquiries
      WHERE updated_at <= $1::timestamptz ORDER BY id LIMIT $2`,
    [cutoff, sampleSize],
  );
  const sampleMismatches: string[] = [];
  if (sample.rows.length > 0) {
    const mirrored = await chQuery<{ enquiry_id: string; reply_state: string }>(
      `SELECT toString(enquiry_id) AS enquiry_id, reply_state FROM analytics.enquiry_fact FINAL
        WHERE enquiry_id IN ({ids:Array(UUID)})`,
      { params: { ids: JSON.stringify(sample.rows.map((r) => r.id)) } },
    );
    const mirroredById = new Map(mirrored.map((r) => [r.enquiry_id, r.reply_state]));
    for (const row of sample.rows) {
      const mirrorState = mirroredById.get(row.id);
      if (mirrorState === undefined) {
        sampleMismatches.push(`enquiry ${row.id} missing from mirror`);
      } else if (mirrorState !== row.reply_state) {
        sampleMismatches.push(`enquiry ${row.id} reply_state ${row.reply_state} != ${mirrorState}`);
      }
    }
  }

  return { cutoff, lagSeconds, divergences: compareCounts(source.rows, mirror), sampleMismatches };
}

export async function recordReconciliation(report: ReconciliationReport, ok: boolean): Promise<void> {
  await getPool().query(
    `INSERT INTO context.reconciliation_runs (source_table, cutoff_at, lag_seconds, ok, detail)
     VALUES ($1, $2::timestamptz, $3, $4, $5::jsonb)`,
    [
      SOURCE_TABLE,
      report.cutoff,
      report.lagSeconds,
      ok,
      JSON.stringify({ divergences: report.divergences, sampleMismatches: report.sampleMismatches }),
    ],
  );
}

export async function runReconciliation(): Promise<boolean> {
  const report = await reconcileEnquiries();
  const { ok, alert } = evaluateReport(report, Number(process.env.CDC_LAG_ALERT_SECONDS ?? "900"));
  await recordReconciliation(report, ok);
  if (alert) await sendAlert("cdc_reconciliation", alert);
  console.log(`reconcile: ok=${ok} lag=${report.lagSeconds}s divergences=${report.divergences.length}`);
  return ok;
}
