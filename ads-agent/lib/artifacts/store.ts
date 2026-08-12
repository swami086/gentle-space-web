import { createHash } from "node:crypto";
import { getPool } from "../db/client";
import { scopeClause, type Scope } from "../db/scope-sql";
import { ObjectStore } from "../objectstore/client";
import { artifactStorageKey, orgIdFromKey, type ArtifactContentType } from "./key";

export const ARTIFACT_BUCKET = process.env.ARTIFACT_BUCKET ?? "gs-artifacts";

/**
 * Retention is bytes-bounded, not operation-bounded (datastore §13.4). Text
 * artifacts get the DPDP Rule 8(3) one-year floor plus a month of slack;
 * recordings will dominate the byte budget once voice ships, so they get the
 * floor exactly and not a day longer.
 */
export const RETENTION_DAYS: Record<ArtifactContentType, number> = {
  talking_points: 400,
  draft: 400,
  context_pack: 400,
  trace_payload: 400,
  call_recording: 366,
};

export type ArtifactRow = {
  id: string;
  orgId: string;
  storageKey: string;
  contentType: ArtifactContentType;
  mediaType: string;
  byteSize: number;
  checksum: string;
  subjectRefs: string[];
  createdAt: Date;
  eraseAfter: Date;
  erasedAt: Date | null;
};

export type PutArtifactInput = {
  contentType: ArtifactContentType;
  body: Uint8Array;
  mediaType?: string;
  /** Subject ids this payload names, so per-subject erasure can find it. */
  subjectRefs?: string[];
};

const SELECT_COLUMNS = `id, org_id, storage_key, content_type, media_type, byte_size,
  checksum, subject_refs, created_at, erase_after, erased_at`;

type DbRow = {
  id: string;
  org_id: string;
  storage_key: string;
  content_type: ArtifactContentType;
  media_type: string;
  byte_size: string | number;
  checksum: string;
  subject_refs: string[];
  created_at: Date;
  erase_after: Date;
  erased_at: Date | null;
};

function toRow(row: DbRow): ArtifactRow {
  return {
    id: row.id,
    orgId: row.org_id,
    storageKey: row.storage_key,
    contentType: row.content_type,
    mediaType: row.media_type,
    byteSize: Number(row.byte_size),
    checksum: row.checksum,
    subjectRefs: row.subject_refs,
    createdAt: row.created_at,
    eraseAfter: row.erase_after,
    erasedAt: row.erased_at,
  };
}

export async function putArtifact(
  scope: Scope,
  input: PutArtifactInput,
  store: ObjectStore = ObjectStore.fromEnv(),
): Promise<ArtifactRow> {
  const pool = getPool();

  // The key embeds the id, so the id is needed before the bytes. It comes from
  // Postgres to stay a time-ordered uuidv7 rather than a scattered v4.
  const { rows: idRows } = await pool.query<{ id: string }>("SELECT uuidv7() AS id");
  const id = idRows[0].id;

  const storageKey = artifactStorageKey(scope, input.contentType, id);
  const mediaType = input.mediaType ?? "application/json";
  const checksum = createHash("sha256").update(input.body).digest("hex");

  // Bytes first (data model §8a). A crash here leaves an unreferenced object,
  // which the orphan sweep reclaims; the reverse leaves a row pointing at
  // nothing, which is indistinguishable from corruption.
  await store.put(ARTIFACT_BUCKET, storageKey, input.body, mediaType);

  const { rows } = await pool.query<DbRow>(
    `INSERT INTO context.artifacts
       (id, org_id, storage_key, content_type, media_type, byte_size, checksum,
        subject_refs, erase_after)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::uuid[], now() + ($9 || ' days')::interval)
     RETURNING ${SELECT_COLUMNS}`,
    [
      id,
      scope.orgId,
      storageKey,
      input.contentType,
      mediaType,
      input.body.byteLength,
      checksum,
      input.subjectRefs ?? [],
      String(RETENTION_DAYS[input.contentType]),
    ],
  );
  return toRow(rows[0]);
}

export async function getArtifact(
  scope: Scope,
  id: string,
  store: ObjectStore = ObjectStore.fromEnv(),
): Promise<{ row: ArtifactRow; body: Uint8Array | null } | null> {
  const clause = scopeClause(scope);
  const { rows } = await getPool().query<DbRow>(
    `SELECT ${SELECT_COLUMNS} FROM context.artifacts
      WHERE ${clause.sql} AND id = $${clause.params.length + 1}`,
    [...clause.params, id],
  );
  // Absent and another tenant's look identical to the caller, so the 404 leaks
  // nothing about whether the id exists.
  if (rows.length === 0) return null;

  const row = toRow(rows[0]);

  // The accessor checks the key's tenant against the row on every read
  // (datastore §13.1). The CHECK constraint should make this impossible; if it
  // fires, something wrote around the constraint.
  if (orgIdFromKey(row.storageKey) !== row.orgId) {
    throw new Error(`artifact ${row.id}: storage key tenant does not match row org_id`);
  }

  // Tombstone: the row survives so a dangling reference renders "content
  // erased" rather than an unexplained 404.
  if (row.erasedAt) return { row, body: null };

  return { row, body: await store.get(ARTIFACT_BUCKET, row.storageKey) };
}

export async function listArtifactsForSubject(
  scope: Scope,
  subjectRef: string,
): Promise<ArtifactRow[]> {
  const clause = scopeClause(scope);
  const { rows } = await getPool().query<DbRow>(
    `SELECT ${SELECT_COLUMNS} FROM context.artifacts
      WHERE ${clause.sql}
        AND subject_refs @> ARRAY[$${clause.params.length + 1}]::uuid[]
        AND erased_at IS NULL
      ORDER BY created_at DESC`,
    [...clause.params, subjectRef],
  );
  return rows.map(toRow);
}
