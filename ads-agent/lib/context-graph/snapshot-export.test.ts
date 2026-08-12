import { describe, it, expect, beforeEach } from "vitest";
import {
  duckdbBinary,
  duckdbBuildScript,
  openBytes,
  sealBytes,
  snapshotExportStatements,
} from "./snapshot-export";

const ORG = "11111111-1111-1111-1111-111111111111";
const SNAP = "22222222-2222-2222-2222-222222222222";

const args = {
  orgId: ORG,
  snapshotId: SNAP,
  stagingBucket: "gs-graph-staging",
  endpoint: "http://127.0.0.1:3900",
  accessKeyId: "GK",
  secretAccessKey: "S",
  sourceWatermark: new Date("2026-08-12T08:00:00Z"),
  cdcLagSeconds: 12,
};

describe("snapshotExportStatements", () => {
  const statements = snapshotExportStatements(args);

  it("exports nodes, edges and a one-row snapshot_meta", () => {
    expect(statements).toHaveLength(3);
    expect(statements[0]).toContain("graph_node.parquet");
    expect(statements[1]).toContain("graph_edge.parquet");
    expect(statements[2]).toContain("snapshot_meta.parquet");
  });

  it("scopes the node and edge exports to one tenant and one snapshot", () => {
    for (const sql of statements.slice(0, 2)) {
      expect(sql).toContain(`org_id = toUUID('${ORG}')`);
      expect(sql).toContain(`snapshot_id = toUUID('${SNAP}')`);
    }
  });

  it("writes Parquet into the staging bucket under the snapshot id", () => {
    for (const sql of statements) {
      expect(sql).toContain(`http://127.0.0.1:3900/gs-graph-staging/${SNAP}/`);
      expect(sql).toContain("'Parquet'");
    }
  });

  it("puts source_watermark and expires_at in snapshot_meta, per data model §9", () => {
    expect(statements[2]).toContain("source_watermark");
    expect(statements[2]).toContain("expires_at");
    expect(statements[2]).toContain("2026-08-12 08:00:00");
  });
});

describe("duckdbBuildScript", () => {
  const script = duckdbBuildScript({
    nodeParquet: "/tmp/s/graph_node.parquet",
    edgeParquet: "/tmp/s/graph_edge.parquet",
    metaParquet: "/tmp/s/snapshot_meta.parquet",
  });

  it("creates all three tables from the local parquet files", () => {
    expect(script).toContain(
      "CREATE TABLE graph_node AS SELECT * FROM read_parquet('/tmp/s/graph_node.parquet')",
    );
    expect(script).toContain(
      "CREATE TABLE graph_edge AS SELECT * FROM read_parquet('/tmp/s/graph_edge.parquet')",
    );
    expect(script).toContain(
      "CREATE TABLE snapshot_meta AS SELECT * FROM read_parquet('/tmp/s/snapshot_meta.parquet')",
    );
  });

  it("keeps org_id so a mis-targeted file fails a check rather than serving", () => {
    expect(script).toContain("SELECT count(DISTINCT org_id) = 1 FROM graph_node");
  });

  it("reads local files, keeping DuckDB out of the credentials business", () => {
    expect(script).not.toContain("httpfs");
    expect(script).not.toContain("s3://");
  });
});

describe("duckdbBinary", () => {
  beforeEach(() => {
    delete process.env.DUCKDB_BIN;
  });

  it("defaults to the path install-duckdb.sh writes", () => {
    expect(duckdbBinary()).toBe("./.bin/duckdb");
  });

  it("rejects a path carrying shell metacharacters", () => {
    process.env.DUCKDB_BIN = "duckdb; rm -rf /";
    expect(() => duckdbBinary()).toThrow(/plain path/);
    process.env.DUCKDB_BIN = "$(whoami)";
    expect(() => duckdbBinary()).toThrow(/plain path/);
  });
});

describe("sealBytes", () => {
  const key = Buffer.alloc(32, 7);

  it("round-trips under the tenant data key", () => {
    const plain = new TextEncoder().encode("snapshot bytes");
    expect(openBytes(sealBytes(plain, key), key).toString("utf8")).toBe("snapshot bytes");
  });

  it("cannot be opened with another key, which is what the crypto-shred relies on", () => {
    const sealed = sealBytes(new TextEncoder().encode("x"), key);
    expect(() => openBytes(sealed, Buffer.alloc(32, 9))).toThrow();
  });
});
