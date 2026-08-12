import { getPool } from "../db/client";
import { chQuery, clickhouseConfig } from "./client";

export type ReplicationResult = { table: string; rowsCopied: number; watermark: string };

const SOURCE_TABLE = "adsagent.enquiries";
const EPOCH = "1970-01-01 00:00:00.000";

export async function readWatermark(sourceTable: string): Promise<string> {
  const { rows } = await getPool().query<{ watermark: string }>(
    `SELECT to_char(watermark, 'YYYY-MM-DD HH24:MI:SS.MS') AS watermark
       FROM context.replication_state WHERE source_table = $1`,
    [sourceTable],
  );
  return rows[0]?.watermark ?? EPOCH;
}

export async function writeWatermark(sourceTable: string, watermark: string, rowsCopied: number): Promise<void> {
  await getPool().query(
    `INSERT INTO context.replication_state (source_table, watermark, rows_copied, last_run_at, last_error)
     VALUES ($1, $2::timestamptz, $3, now(), NULL)
     ON CONFLICT (source_table) DO UPDATE
        SET watermark   = EXCLUDED.watermark,
            rows_copied = context.replication_state.rows_copied + EXCLUDED.rows_copied,
            last_run_at = now(),
            last_error  = NULL`,
    [sourceTable, watermark, rowsCopied],
  );
}

// Both bounds come from PostgreSQL's clock. Taking the cutoff from ClickHouse would
// let skew between the two servers silently skip a window of rows.
export async function computeCutoff(toleranceSeconds: number): Promise<string> {
  const { rows } = await getPool().query<{ cutoff: string }>(
    `SELECT to_char(now() - make_interval(secs => $1), 'YYYY-MM-DD HH24:MI:SS.MS') AS cutoff`,
    [toleranceSeconds],
  );
  return rows[0].cutoff;
}

async function auditCrossTenantRead(rowsCopied: number): Promise<void> {
  await getPool().query(
    `INSERT INTO context.access_log (org_id, actor_kind, actor_ref, subject_kind, subject_ref, action)
     VALUES ('00000000-0000-0000-0000-000000000000', $1, $2, 'table', $3, $4)`,
    ["cross_tenant", "cdc-replicator", SOURCE_TABLE, `replicated ${rowsCopied} rows`],
  );
}

function pgConnectionParts(): { hostPort: string; database: string; user: string; password: string } {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL is not set");
  const url = new URL(raw);
  return {
    hostPort: `${url.hostname}:${url.port || "5432"}`,
    database: url.pathname.replace(/^\//, ""),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  };
}

export async function replicateEnquiries(
  options: { toleranceSeconds?: number } = {},
): Promise<ReplicationResult> {
  const toleranceSeconds = options.toleranceSeconds ?? Number(process.env.RECONCILE_LAG_TOLERANCE_SECONDS ?? "120");
  const cutoff = await computeCutoff(toleranceSeconds);
  const watermark = await readWatermark(SOURCE_TABLE);
  const pg = pgConnectionParts();

  const [row] = await chQuery<{ copied: string }>(
    `INSERT INTO analytics.enquiry_fact
       (org_id, enquiry_id, listing_id, corridor_id, reply_state, first_seen_at, updated_at, snapshot_id)
     SELECT org_id, id, listing_id, corridor_id, reply_state, first_seen_at, updated_at,
            toUUID('00000000-0000-0000-0000-000000000000')
       FROM postgresql({host:String}, {db:String}, 'enquiries', {user:String}, {password:String}, 'adsagent')
      WHERE updated_at > {watermark:DateTime64(3)}
        AND updated_at <= {cutoff:DateTime64(3)}`,
    {
      config: clickhouseConfig(),
      params: {
        host: pg.hostPort,
        db: pg.database,
        user: pg.user,
        password: pg.password,
        watermark,
        cutoff,
      },
      settings: { send_progress_in_http_headers: "0" },
    },
  ).then(async (inserted) => {
    // INSERT ... SELECT returns no rows; count what the window contained so the
    // caller and the state row agree on how much moved.
    void inserted;
    return chQuery<{ copied: string }>(
      `SELECT count() AS copied FROM analytics.enquiry_fact FINAL
        WHERE updated_at > {watermark:DateTime64(3)} AND updated_at <= {cutoff:DateTime64(3)}`,
      { params: { watermark, cutoff } },
    );
  });

  const rowsCopied = Number(row?.copied ?? "0");
  await auditCrossTenantRead(rowsCopied);
  await writeWatermark(SOURCE_TABLE, cutoff, rowsCopied);
  return { table: SOURCE_TABLE, rowsCopied, watermark: cutoff };
}
