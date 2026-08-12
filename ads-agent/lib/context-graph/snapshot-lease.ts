import { getPool } from "../db/client";
import { scopeClause, type Scope } from "../db/scope-sql";
import type { ObjectStore } from "../objectstore/client";

export const SNAPSHOT_TTL_SECONDS = Number(process.env.SNAPSHOT_TTL_SECONDS ?? 604800);
export const SNAPSHOT_LEASE_SECONDS = Number(process.env.SNAPSHOT_LEASE_SECONDS ?? 300);
/** Current and previous, per datastore §12.2. */
export const SNAPSHOT_GENERATIONS_KEPT = 2;

export type SnapshotRecord = {
  orgId: string;
  snapshotId: string;
  generation: number;
  bucket: string;
  storageKey: string;
  byteSize: number;
  checksum: string;
  sourceWatermark: Date;
  cdcLagSeconds: number;
};

export async function recordSnapshot(scope: Scope, record: SnapshotRecord): Promise<void> {
  await getPool().query(
    `INSERT INTO context.graph_snapshots
       (org_id, snapshot_id, generation, bucket, storage_key, byte_size, checksum,
        expires_at, source_watermark, cdc_lag_seconds)
     VALUES ($1, $2, $3, $4, $5, $6, $7,
             now() + ($8 || ' seconds')::interval, $9, $10)
     ON CONFLICT (org_id, snapshot_id) DO UPDATE SET
       generation = EXCLUDED.generation, bucket = EXCLUDED.bucket,
       storage_key = EXCLUDED.storage_key, byte_size = EXCLUDED.byte_size,
       checksum = EXCLUDED.checksum, expires_at = EXCLUDED.expires_at,
       source_watermark = EXCLUDED.source_watermark,
       cdc_lag_seconds = EXCLUDED.cdc_lag_seconds`,
    [
      scope.orgId,
      record.snapshotId,
      record.generation,
      record.bucket,
      record.storageKey,
      record.byteSize,
      record.checksum,
      String(SNAPSHOT_TTL_SECONDS),
      record.sourceWatermark,
      record.cdcLagSeconds,
    ],
  );
}

/**
 * A serving process takes a lease before opening a file. Collection removes only
 * snapshots with no live lease (datastore §12.2), which is what "once no reader
 * holds them" has to mean in practice.
 */
export async function takeLease(
  scope: Scope,
  snapshotId: string,
  holder: string,
): Promise<string> {
  const { rows } = await getPool().query<{ id: string }>(
    `INSERT INTO context.snapshot_leases (org_id, snapshot_id, holder, expires_at)
     VALUES ($1, $2, $3, now() + ($4 || ' seconds')::interval)
     RETURNING id`,
    [scope.orgId, snapshotId, holder, String(SNAPSHOT_LEASE_SECONDS)],
  );
  return rows[0].id;
}

export async function releaseLease(scope: Scope, leaseId: string): Promise<void> {
  const clause = scopeClause(scope);
  await getPool().query(
    `DELETE FROM context.snapshot_leases
      WHERE ${clause.sql} AND id = $${clause.params.length + 1}`,
    [...clause.params, leaseId],
  );
}

export async function collectSnapshots(store?: ObjectStore): Promise<{
  collected: Array<{ orgId: string; snapshotId: string; bucket: string; storageKey: string }>;
  blockedByLease: number;
  currentGenerationExpired: string[];
}> {
  const pool = getPool();

  const { rows } = await pool.query<{
    id: string;
    org_id: string;
    snapshot_id: string;
    bucket: string;
    storage_key: string;
    is_current: boolean;
  }>(
    `WITH ranked AS (
       SELECT s.*,
              row_number() OVER (PARTITION BY s.org_id ORDER BY s.generation DESC) AS rn
         FROM context.graph_snapshots s
        WHERE s.collected_at IS NULL
     )
     SELECT r.id, r.org_id, r.snapshot_id, r.bucket, r.storage_key, (r.rn = 1) AS is_current
       FROM ranked r
      WHERE (r.rn > $1 OR r.expires_at < now())
        AND NOT EXISTS (
              SELECT 1 FROM context.snapshot_leases l
               WHERE l.org_id = r.org_id
                 AND l.snapshot_id = r.snapshot_id
                 AND l.expires_at > now())`,
    [SNAPSHOT_GENERATIONS_KEPT],
  );

  // Counted, not silently skipped: a lease leak would otherwise keep expired
  // files alive indefinitely with nothing saying so.
  const blockedRows = await pool.query<{ blocked: string }>(
    `WITH ranked AS (
       SELECT s.*, row_number() OVER (PARTITION BY s.org_id ORDER BY s.generation DESC) AS rn
         FROM context.graph_snapshots s WHERE s.collected_at IS NULL
     )
     SELECT count(*)::text AS blocked
       FROM ranked r
      WHERE (r.rn > $1 OR r.expires_at < now())
        AND EXISTS (
              SELECT 1 FROM context.snapshot_leases l
               WHERE l.org_id = r.org_id AND l.snapshot_id = r.snapshot_id
                 AND l.expires_at > now())`,
    [SNAPSHOT_GENERATIONS_KEPT],
  );

  const collected: Array<{
    orgId: string;
    snapshotId: string;
    bucket: string;
    storageKey: string;
  }> = [];
  const currentGenerationExpired: string[] = [];

  for (const row of rows) {
    if (store) await store.remove(row.bucket, row.storage_key);
    await pool.query(`UPDATE context.graph_snapshots SET collected_at = now() WHERE id = $1`, [
      row.id,
    ]);
    collected.push({
      orgId: row.org_id,
      snapshotId: row.snapshot_id,
      bucket: row.bucket,
      storageKey: row.storage_key,
    });

    if (row.is_current) {
      // expires_at outranks generation, so a current-but-expired file still
      // goes. The tenant must then get a fresh one rather than silently losing
      // context, and this list is what an alert watches.
      currentGenerationExpired.push(row.org_id);
      await pool.query(
        `UPDATE context.graph_manifests
            SET status = 'pending', snapshot_id = NULL, stale_since = now(), updated_at = now()
          WHERE org_id = $1`,
        [row.org_id],
      );
    }
  }

  return {
    collected,
    blockedByLease: Number(blockedRows.rows[0]?.blocked ?? 0),
    currentGenerationExpired,
  };
}
