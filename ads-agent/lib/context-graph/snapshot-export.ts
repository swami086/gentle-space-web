import { execFile } from "node:child_process";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Scope } from "../db/scope-sql";
import { ObjectStore } from "../objectstore/client";
import { chCommand } from "./clickhouse";
import { SNAPSHOT_TTL_SECONDS } from "./snapshot-lease";
import { provisionSnapshotStorage, snapshotBucketName, tenantDataKey } from "./snapshot-iam";

const G = "gentle_space";

/**
 * The DuckDB CLI path, validated. Arguments are passed to execFile as a list
 * with the shell disabled, so nothing is interpolated into a command line; this
 * check additionally refuses anything that is not a plain filesystem path.
 */
export function duckdbBinary(): string {
  const bin = process.env.DUCKDB_BIN ?? "./.bin/duckdb";
  if (!/^[A-Za-z0-9._/-]+$/.test(bin)) {
    throw new Error(`DUCKDB_BIN is not a plain path: ${bin}`);
  }
  return bin;
}

function runDuckdb(dbPath: string, script: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      duckdbBinary(),
      [dbPath, "-c", script],
      { shell: false, maxBuffer: 16 * 1024 * 1024 },
      (err, _stdout, stderr) =>
        err ? reject(new Error(`duckdb failed: ${stderr || err.message}`)) : resolve(),
    );
  });
}

function chTimestamp(at: Date): string {
  return at.toISOString().replace("T", " ").replace(/\.\d+Z$/, "");
}

/**
 * ClickHouse writes Parquet straight to Garage through its s3() table function,
 * so the first hop of the export is configuration rather than code.
 */
export function snapshotExportStatements(args: {
  orgId: string;
  snapshotId: string;
  stagingBucket: string;
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  sourceWatermark: Date;
  cdcLagSeconds: number;
}): string[] {
  const base = `${args.endpoint.replace(/\/$/, "")}/${args.stagingBucket}/${args.snapshotId}`;
  const creds = `'${args.accessKeyId}', '${args.secretAccessKey}', 'Parquet'`;
  const scoped = `org_id = toUUID('${args.orgId}') AND snapshot_id = toUUID('${args.snapshotId}')`;

  return [
    `INSERT INTO FUNCTION s3('${base}/graph_node.parquet', ${creds})
     SELECT org_id, snapshot_id, node_id, node_kind, label, subject_ref,
            toString(props) AS props
       FROM ${G}.graph_node WHERE ${scoped}`,

    `INSERT INTO FUNCTION s3('${base}/graph_edge.parquet', ${creds})
     SELECT org_id, snapshot_id, source_id, source_kind, relationship_kind,
            target_id, target_kind, meters, weight, confidence, toString(props) AS props
       FROM ${G}.graph_edge WHERE ${scoped}`,

    // One row. org_id is retained so a mis-targeted file fails a check rather
    // than serving silently; source_watermark carries CDC lag forward so an
    // agent can tell how stale its context is (data model §9).
    `INSERT INTO FUNCTION s3('${base}/snapshot_meta.parquet', ${creds})
     SELECT toUUID('${args.orgId}')                             AS org_id,
            toUUID('${args.snapshotId}')                        AS snapshot_id,
            now()                                               AS built_at,
            now() + INTERVAL ${SNAPSHOT_TTL_SECONDS} SECOND     AS expires_at,
            toDateTime('${chTimestamp(args.sourceWatermark)}')  AS source_watermark,
            ${args.cdcLagSeconds}                               AS cdc_lag_seconds`,
  ];
}

/**
 * Local parquet files, not httpfs: reading them from disk keeps DuckDB out of
 * the credentials business entirely.
 */
export function duckdbBuildScript(paths: {
  nodeParquet: string;
  edgeParquet: string;
  metaParquet: string;
}): string {
  return [
    `CREATE TABLE graph_node AS SELECT * FROM read_parquet('${paths.nodeParquet}');`,
    `CREATE TABLE graph_edge AS SELECT * FROM read_parquet('${paths.edgeParquet}');`,
    `CREATE TABLE snapshot_meta AS SELECT * FROM read_parquet('${paths.metaParquet}');`,
    // A file holding two tenants' rows is a bug, and this is where it stops.
    `SELECT count(DISTINCT org_id) = 1 FROM graph_node;`,
  ].join("\n");
}

const IV_BYTES = 12;
const TAG_BYTES = 16;

/**
 * Per-tenant AES-256-GCM over the snapshot file. Destroying the tenant's data
 * key makes every snapshot it ever had unreadable at once (datastore §12.3,
 * §11.2), which is what makes erasure practical for immutable files.
 */
export function sealBytes(plaintext: Uint8Array, dataKey: Buffer): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", dataKey, iv);
  const body = Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

export function openBytes(sealed: Uint8Array, dataKey: Buffer): Buffer {
  const buf = Buffer.from(sealed);
  const decipher = createDecipheriv("aes-256-gcm", dataKey, buf.subarray(0, IV_BYTES));
  decipher.setAuthTag(buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
  return Buffer.concat([decipher.update(buf.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]);
}

export async function exportSnapshot(
  scope: Scope,
  snapshotId: string,
  generation: number,
  build: { sourceWatermark: Date; cdcLagSeconds: number },
): Promise<{ bucket: string; storageKey: string; byteSize: number; checksum: string }> {
  void generation;
  const stagingBucket = process.env.SNAPSHOT_STAGING_BUCKET ?? "gs-graph-staging";
  const endpoint = process.env.GARAGE_S3_ENDPOINT ?? "http://127.0.0.1:3900";
  const accessKeyId = process.env.ARTIFACT_ACCESS_KEY_ID;
  const secretAccessKey = process.env.ARTIFACT_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error("ARTIFACT_ACCESS_KEY_ID / ARTIFACT_SECRET_ACCESS_KEY are not set");
  }

  for (const statement of snapshotExportStatements({
    orgId: scope.orgId,
    snapshotId,
    stagingBucket,
    endpoint,
    accessKeyId,
    secretAccessKey,
    sourceWatermark: build.sourceWatermark,
    cdcLagSeconds: build.cdcLagSeconds,
  })) {
    await chCommand(statement, { orgId: scope.orgId });
  }

  const store = ObjectStore.fromEnv();
  const workDir = await mkdtemp(join(tmpdir(), `snap-${snapshotId}-`));
  try {
    const local: Record<string, string> = {};
    for (const name of ["graph_node", "graph_edge", "snapshot_meta"]) {
      const bytes = await store.get(stagingBucket, `${snapshotId}/${name}.parquet`);
      if (!bytes) throw new Error(`staging parquet missing: ${snapshotId}/${name}.parquet`);
      local[name] = join(workDir, `${name}.parquet`);
      await writeFile(local[name], bytes);
    }

    // A rebuild writes a NEW file. Readers hold the current one open READ_ONLY,
    // so building in place would violate DuckDB's concurrency model (§6.4).
    const dbPath = join(workDir, `${snapshotId}.duckdb`);
    await runDuckdb(
      dbPath,
      duckdbBuildScript({
        nodeParquet: local.graph_node,
        edgeParquet: local.graph_edge,
        metaParquet: local.snapshot_meta,
      }),
    );

    const raw = await readFile(dbPath);
    const dataKey = await tenantDataKey(scope).catch(async () => {
      await provisionSnapshotStorage(scope);
      return tenantDataKey(scope);
    });
    const sealed = sealBytes(raw, dataKey);

    const bucket = snapshotBucketName(scope.orgId);
    const storageKey = `${snapshotId}.duckdb.enc`;
    await store.put(bucket, storageKey, sealed, "application/octet-stream");

    // Staging is transport, not an archive: the parquet is reproducible from
    // ClickHouse and holds a copy of the same personal data.
    for (const name of ["graph_node", "graph_edge", "snapshot_meta"]) {
      await store.remove(stagingBucket, `${snapshotId}/${name}.parquet`);
    }

    return {
      bucket,
      storageKey,
      byteSize: sealed.byteLength,
      checksum: createHash("sha256").update(sealed).digest("hex"),
    };
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}
