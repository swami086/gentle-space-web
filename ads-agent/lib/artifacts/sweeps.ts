import { getPool } from "../db/client";
import { ObjectStore } from "../objectstore/client";
import { ARTIFACT_BUCKET } from "./store";

/**
 * The write order is bytes-then-row, so a young object with no row is a write
 * in flight rather than residue. Without this window the orphan sweep races its
 * own writer and deletes bytes that are about to be referenced.
 */
export const ORPHAN_GRACE_SECONDS = Number(process.env.ARTIFACT_ORPHAN_GRACE_SECONDS ?? 3600);

export type OrphanSweepResult = { scanned: number; deleted: string[]; skippedYoung: number };

export type DanglingFlag = {
  artifactId: string;
  orgId: string;
  classification: "mid_erasure" | "unexplained";
};

async function recordRun(
  sweep: "orphan" | "dangling",
  counts: Partial<{
    objectsScanned: number;
    objectsDeleted: number;
    objectsSkipped: number;
    rowsFlagged: number;
    unexplained: number;
  }>,
): Promise<void> {
  await getPool().query(
    `INSERT INTO context.artifact_sweep_runs
       (sweep, finished_at, objects_scanned, objects_deleted, objects_skipped,
        rows_flagged, unexplained)
     VALUES ($1, now(), $2, $3, $4, $5, $6)`,
    [
      sweep,
      counts.objectsScanned ?? 0,
      counts.objectsDeleted ?? 0,
      counts.objectsSkipped ?? 0,
      counts.rowsFlagged ?? 0,
      counts.unexplained ?? 0,
    ],
  );
}

/**
 * Bytes with no index row: the expected residue of a crash between the two
 * writes. This sweep deletes. Connect as context_maintenance.
 */
export async function orphanSweep(
  opts: { graceSeconds?: number; now?: Date; store?: ObjectStore } = {},
): Promise<OrphanSweepResult> {
  const store = opts.store ?? ObjectStore.fromEnv();
  const graceMs = (opts.graceSeconds ?? ORPHAN_GRACE_SECONDS) * 1000;
  const now = opts.now ?? new Date();
  const pool = getPool();

  const result: OrphanSweepResult = { scanned: 0, deleted: [], skippedYoung: 0 };

  for await (const object of store.list(ARTIFACT_BUCKET, "artifacts/")) {
    result.scanned += 1;

    const { rowCount } = await pool.query(
      `SELECT 1 FROM context.artifacts WHERE storage_key = $1`,
      [object.key],
    );
    if (rowCount) continue;

    if (now.getTime() - object.lastModified.getTime() < graceMs) {
      result.skippedYoung += 1;
      continue;
    }

    await store.remove(ARTIFACT_BUCKET, object.key);
    result.deleted.push(object.key);
  }

  await recordRun("orphan", {
    objectsScanned: result.scanned,
    objectsDeleted: result.deleted.length,
    objectsSkipped: result.skippedYoung,
  });
  return result;
}

/**
 * Index rows with no bytes. This sweep flags and never deletes: §13.1 calls it
 * "not expected", indicating a bug or an out-of-band deletion. The exception is
 * a crash mid-erasure, which is expected by construction, so a row covered by
 * an unfinished deletion request is classified mid_erasure and does not alert.
 */
export async function danglingSweep(
  opts: { store?: ObjectStore } = {},
): Promise<DanglingFlag[]> {
  const store = opts.store ?? ObjectStore.fromEnv();
  const pool = getPool();

  const { rows } = await pool.query<{
    id: string;
    org_id: string;
    storage_key: string;
    open_request: boolean;
  }>(
    `SELECT a.id, a.org_id, a.storage_key,
            EXISTS (
              SELECT 1 FROM context.deletion_requests r
               WHERE r.org_id = a.org_id
                 AND r.erased_at IS NULL
                 -- CASE, not OR: SQL does not guarantee short-circuit
                 -- evaluation, and subject_ref::uuid would raise on a
                 -- non-UUID subject reference whichever branch "should" run.
                 AND (CASE WHEN r.subject_kind = 'tenant' THEN true
                           WHEN r.subject_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                             THEN r.subject_ref::uuid = ANY (a.subject_refs)
                           ELSE false END)
            ) AS open_request
       FROM context.artifacts a
      WHERE a.erased_at IS NULL`,
  );

  const flags: DanglingFlag[] = [];
  for (const row of rows) {
    if (await store.head(ARTIFACT_BUCKET, row.storage_key)) continue;

    const classification: DanglingFlag["classification"] = row.open_request
      ? "mid_erasure"
      : "unexplained";
    flags.push({ artifactId: row.id, orgId: row.org_id, classification });

    await pool.query(
      `INSERT INTO context.artifact_dangling_flags
         (artifact_id, org_id, classification, detected_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (artifact_id) DO UPDATE SET
         classification = EXCLUDED.classification, detected_at = now()`,
      [row.id, row.org_id, classification],
    );
  }

  await recordRun("dangling", {
    rowsFlagged: flags.length,
    unexplained: flags.filter((f) => f.classification === "unexplained").length,
  });
  return flags;
}
