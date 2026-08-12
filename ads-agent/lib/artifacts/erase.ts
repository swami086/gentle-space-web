import { getPool } from "../db/client";
import { enqueueEvent } from "../db/outbox";
import { scopeClause, type Scope } from "../db/scope-sql";
import { withTenantTransaction } from "../db/tx";
import { ObjectStore } from "../objectstore/client";
import { tenantPrefix } from "./key";
import { ARTIFACT_BUCKET } from "./store";

export type EraseResult = { erasedIds: string[]; deletedKeys: string[] };

/**
 * Delete the bytes, then prove they are gone, then tombstone the row.
 *
 * The order is the compliance decision. Tombstoning first means a crash leaves
 * a row claiming erasure over bytes that still exist -- a false claim, which is
 * the failure a regulator would care about. Deleting first means a crash leaves
 * a row not yet tombstoned whose object is missing: recoverable, and the
 * dangling sweep classifies it as mid_erasure rather than a bug.
 *
 * ObjectStore.head returns null only on 404 and throws on 403, so a permissions
 * failure can never be mistaken for absence.
 */
async function deleteAndVerify(store: ObjectStore, key: string): Promise<void> {
  await store.remove(ARTIFACT_BUCKET, key);
  if (await store.head(ARTIFACT_BUCKET, key)) {
    throw new Error(`object ${key} still present after delete; erasure not recorded`);
  }
}

async function recordPropagation(
  scope: Scope,
  requestId: string,
  count: number,
  detail: string,
): Promise<void> {
  // The metadata row's erased_at and the ledger write commit together (data
  // model §8a), and the event rides the same client, because a lost deletion
  // event is a failed erasure obligation rather than a retry (datastore §14.4).
  // Org scope: enqueueEvent refuses platform scope by design.
  await withTenantTransaction({ kind: "org", orgId: scope.orgId }, async (client) => {
    await client.query(
      `INSERT INTO context.deletion_propagations
         (request_id, org_id, store, state, detail, updated_at)
       VALUES ($1, $2, 'objectstore', 'erased', $3, now())
       ON CONFLICT (request_id, store) DO UPDATE SET
         state = 'erased', detail = EXCLUDED.detail, updated_at = now()`,
      [requestId, scope.orgId, `${count} artifacts; ${detail}`],
    );
    await enqueueEvent({ kind: "org", orgId: scope.orgId }, client, {
      topic: "deletion.requested",
      payload: { requestId, store: "objectstore", state: "erased", artifactCount: count },
    });
  });
}

export async function eraseArtifactsForSubject(
  scope: Scope,
  subjectRef: string,
  requestId: string,
  store: ObjectStore = ObjectStore.fromEnv(),
): Promise<EraseResult> {
  const pool = getPool();
  const clause = scopeClause(scope);
  const { rows } = await pool.query<{ id: string; storage_key: string }>(
    `SELECT id, storage_key FROM context.artifacts
      WHERE ${clause.sql}
        AND subject_refs @> ARRAY[$${clause.params.length + 1}]::uuid[]
        AND erased_at IS NULL`,
    [...clause.params, subjectRef],
  );

  const erasedIds: string[] = [];
  const deletedKeys: string[] = [];
  // One artifact at a time, each tombstoned as soon as its bytes are provably
  // gone, so a crash can leave at most one row mid-erasure.
  for (const row of rows) {
    await deleteAndVerify(store, row.storage_key);
    await pool.query(`UPDATE context.artifacts SET erased_at = now() WHERE id = $1`, [row.id]);
    erasedIds.push(row.id);
    deletedKeys.push(row.storage_key);
  }

  await recordPropagation(scope, requestId, erasedIds.length, `subject=${subjectRef}`);
  return { erasedIds, deletedKeys };
}

/** Tenant offboarding: prefix delete on artifacts/{org_id}/ (§13.1). */
export async function eraseArtifactsForTenant(
  scope: Scope,
  requestId: string,
  store: ObjectStore = ObjectStore.fromEnv(),
): Promise<EraseResult> {
  const prefix = tenantPrefix(scope);

  const deletedKeys: string[] = [];
  for await (const object of store.list(ARTIFACT_BUCKET, prefix)) {
    await deleteAndVerify(store, object.key);
    deletedKeys.push(object.key);
  }

  const { rows } = await getPool().query<{ id: string }>(
    `UPDATE context.artifacts SET erased_at = now()
      WHERE org_id = $1 AND erased_at IS NULL
      RETURNING id`,
    [scope.orgId],
  );

  await recordPropagation(scope, requestId, rows.length, `prefix=${prefix}`);
  return { erasedIds: rows.map((r) => r.id), deletedKeys };
}
