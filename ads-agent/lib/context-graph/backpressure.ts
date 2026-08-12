import { getPool } from "../db/client";
import { enqueueEvent } from "../db/outbox";
import type { Scope } from "../db/scope-sql";
import { withTenantTransaction } from "../db/tx";

export const REBUILD_CEILING = Number(process.env.GRAPH_REBUILD_CEILING ?? 2);
export const REBUILD_DEBOUNCE_SECONDS = Number(process.env.GRAPH_REBUILD_DEBOUNCE_SECONDS ?? 300);
export const REBUILD_LEASE_SECONDS = Number(process.env.GRAPH_REBUILD_LEASE_SECONDS ?? 900);

export type RebuildClaim = {
  orgId: string;
  slotNo: number;
  snapshotId: string;
  generation: number;
};

const FREE_SLOT = `UPDATE context.rebuild_slots
                      SET org_id = NULL, leased_until = NULL
                    WHERE slot_no = $1`;

export async function markTenantStale(scope: Scope, opts: { byUser: boolean }): Promise<void> {
  await withTenantTransaction({ kind: "org", orgId: scope.orgId }, async (client) => {
    await client.query(
      `INSERT INTO context.graph_manifests
         (org_id, status, stale_since, last_user_activity_at, updated_at)
       VALUES ($1, 'pending', now(), CASE WHEN $2 THEN now() ELSE NULL END, now())
       ON CONFLICT (org_id) DO UPDATE SET
         status = CASE WHEN context.graph_manifests.status = 'building'
                       THEN 'building' ELSE 'pending' END,
         stale_since = COALESCE(context.graph_manifests.stale_since, now()),
         last_user_activity_at = CASE WHEN $2 THEN now()
                                      ELSE context.graph_manifests.last_user_activity_at END,
         updated_at = now()`,
      [scope.orgId, opts.byUser],
    );
    await enqueueEvent({ kind: "org", orgId: scope.orgId }, client, {
      topic: "graph.tenant_stale",
      payload: { byUser: opts.byUser },
    });
  });
}

export async function claimRebuild(): Promise<RebuildClaim | null> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");

    const slot = await client.query<{ slot_no: number }>(
      `UPDATE context.rebuild_slots
          SET leased_until = now() + ($1 || ' seconds')::interval
        WHERE slot_no = (
                SELECT slot_no FROM context.rebuild_slots
                 WHERE org_id IS NULL OR leased_until IS NULL OR leased_until < now()
                 ORDER BY slot_no
                 LIMIT 1
                 FOR UPDATE SKIP LOCKED)
        RETURNING slot_no`,
      [String(REBUILD_LEASE_SECONDS)],
    );
    if (slot.rowCount === 0) {
      await client.query("ROLLBACK");
      return null;
    }
    const slotNo = slot.rows[0].slot_no;

    const manifest = await client.query<{
      org_id: string;
      building_id: string;
      generation: string;
    }>(
      `UPDATE context.graph_manifests m
          SET status = 'building', building_id = uuidv7(),
              generation = m.generation + 1, attempts = m.attempts + 1, updated_at = now()
        WHERE m.org_id = (
                SELECT org_id FROM context.graph_manifests
                 WHERE status = 'pending'
                   AND stale_since IS NOT NULL
                   AND stale_since <= now() - ($1 || ' seconds')::interval
                 ORDER BY (last_user_activity_at >= now() - interval '1 day') DESC NULLS LAST,
                          stale_since ASC
                 LIMIT 1
                 FOR UPDATE SKIP LOCKED)
        RETURNING m.org_id, m.building_id, m.generation`,
      [String(REBUILD_DEBOUNCE_SECONDS)],
    );
    if (manifest.rowCount === 0) {
      await client.query(FREE_SLOT, [slotNo]);
      await client.query("COMMIT");
      return null;
    }

    await client.query(`UPDATE context.rebuild_slots SET org_id = $1 WHERE slot_no = $2`, [
      manifest.rows[0].org_id,
      slotNo,
    ]);
    await client.query("COMMIT");

    return {
      orgId: manifest.rows[0].org_id,
      slotNo,
      snapshotId: manifest.rows[0].building_id,
      generation: Number(manifest.rows[0].generation),
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function finishRebuild(
  claim: RebuildClaim,
  result: { sourceWatermark: Date; cdcLagSeconds: number },
): Promise<void> {
  await withTenantTransaction({ kind: "platform", orgId: claim.orgId }, async (client) => {
    await client.query(
      `UPDATE context.graph_manifests
          SET status = 'ready', snapshot_id = $2, building_id = NULL,
              last_built_at = now(), stale_since = NULL, error_message = NULL,
              source_watermark = $3, cdc_lag_seconds = $4, attempts = 0, updated_at = now()
        WHERE org_id = $1`,
      [claim.orgId, claim.snapshotId, result.sourceWatermark, result.cdcLagSeconds],
    );
    await client.query(FREE_SLOT, [claim.slotNo]);
  });
}

export async function failRebuild(claim: RebuildClaim, message: string): Promise<void> {
  await withTenantTransaction({ kind: "platform", orgId: claim.orgId }, async (client) => {
    await client.query(
      `UPDATE context.graph_manifests
          SET status = 'error', building_id = NULL, error_message = $2, updated_at = now()
        WHERE org_id = $1`,
      [claim.orgId, message.slice(0, 2000)],
    );
    await client.query(FREE_SLOT, [claim.slotNo]);
  });
}
