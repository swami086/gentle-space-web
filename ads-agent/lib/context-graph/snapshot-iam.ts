import { randomBytes } from "node:crypto";
import { getPool } from "../db/client";
import { scopeClause, type Scope } from "../db/scope-sql";
import {
  allowBucketKey,
  createBucket,
  createKey,
  garageAdminFromEnv,
  getBucketByAlias,
} from "../objectstore/garage-admin";
import type { S3Credentials } from "../objectstore/sigv4";
import { openSecret, sealSecret } from "./envelope";

/**
 * One bucket per tenant. §12.3 asks for one prefix per tenant with a credential
 * scoped to that prefix; Garage grants read/write/owner per bucket and has no
 * prefix-scoped grant, and a shared bucket with a shared read credential would
 * make the file boundary decorative -- the exact failure §12.3 names.
 * 8 + 36 = 44 characters, inside the 63-character DNS limit.
 */
export function snapshotBucketName(orgId: string): string {
  return `gs-snap-${orgId}`;
}

export type SnapshotStorage = { bucket: string; readerAccessKeyId: string };

export async function provisionSnapshotStorage(scope: Scope): Promise<SnapshotStorage> {
  const admin = garageAdminFromEnv();
  const bucket = snapshotBucketName(scope.orgId);

  const existing = await getBucketByAlias(admin, bucket);
  const bucketId = existing ? existing.id : (await createBucket(admin, bucket)).id;

  const reader = await createKey(admin, `${bucket}-reader`);
  // Read-only, this bucket only. Never owner: an owner key could grant itself
  // access to other buckets.
  await allowBucketKey(admin, bucketId, reader.accessKeyId, {
    read: true,
    write: false,
    owner: false,
  });

  // The builder uploads with the server key, which needs write here and never
  // needs a tenant's reader credential.
  const serverKeyId = process.env.ARTIFACT_ACCESS_KEY_ID;
  if (!serverKeyId) throw new Error("ARTIFACT_ACCESS_KEY_ID is not set");
  await allowBucketKey(admin, bucketId, serverKeyId, {
    read: true,
    write: true,
    owner: false,
  });

  await getPool().query(
    `INSERT INTO context.snapshot_storage
       (org_id, bucket, garage_bucket_id, reader_access_key_id, reader_secret_sealed,
        data_key_sealed, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (org_id) DO UPDATE SET
       garage_bucket_id = EXCLUDED.garage_bucket_id,
       reader_access_key_id = EXCLUDED.reader_access_key_id,
       reader_secret_sealed = EXCLUDED.reader_secret_sealed,
       -- An existing data key is never rotated here: rotating it would orphan
       -- every snapshot already sealed under it.
       data_key_sealed = COALESCE(context.snapshot_storage.data_key_sealed,
                                  EXCLUDED.data_key_sealed),
       updated_at = now()`,
    [
      scope.orgId,
      bucket,
      bucketId,
      reader.accessKeyId,
      sealSecret(reader.secretAccessKey),
      sealSecret(randomBytes(32)),
    ],
  );

  return { bucket, readerAccessKeyId: reader.accessKeyId };
}

/** The credential a serving process uses. Reaches exactly one bucket. */
export async function readerCredentials(scope: Scope): Promise<S3Credentials> {
  const clause = scopeClause(scope);
  const { rows } = await getPool().query<{
    bucket: string;
    reader_access_key_id: string;
    reader_secret_sealed: Buffer | null;
  }>(
    `SELECT bucket, reader_access_key_id, reader_secret_sealed
       FROM context.snapshot_storage WHERE ${clause.sql}`,
    clause.params,
  );
  const row = rows[0];
  if (!row?.reader_secret_sealed) {
    throw new Error(`no snapshot reader credential provisioned for org ${scope.orgId}`);
  }
  return {
    endpoint: process.env.GARAGE_S3_ENDPOINT ?? "http://127.0.0.1:3900",
    region: process.env.GARAGE_REGION ?? "garage",
    accessKeyId: row.reader_access_key_id,
    secretAccessKey: openSecret(row.reader_secret_sealed).toString("utf8"),
  };
}

export async function tenantDataKey(scope: Scope): Promise<Buffer> {
  const clause = scopeClause(scope);
  const { rows } = await getPool().query<{
    data_key_sealed: Buffer | null;
    key_destroyed_at: Date | null;
  }>(
    `SELECT data_key_sealed, key_destroyed_at
       FROM context.snapshot_storage WHERE ${clause.sql}`,
    clause.params,
  );
  const row = rows[0];
  if (row?.key_destroyed_at) {
    throw new Error(`snapshot data key for org ${scope.orgId} has been destroyed`);
  }
  if (!row?.data_key_sealed) {
    throw new Error(`no snapshot data key for org ${scope.orgId}`);
  }
  return openSecret(row.data_key_sealed);
}

/** Crypto-shredding: every snapshot for this tenant becomes unreadable at once. */
export async function destroyTenantSnapshotKey(scope: Scope): Promise<void> {
  await getPool().query(
    `UPDATE context.snapshot_storage
        SET data_key_sealed = NULL, key_destroyed_at = now(), updated_at = now()
      WHERE org_id = $1 AND key_destroyed_at IS NULL`,
    [scope.orgId],
  );
}
