import { describe, it, expect, beforeAll } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { applyMigrations, DEFAULT_MIGRATIONS_DIR } from "./migrate";
import { chExec, chQuery } from "./client";

const OWNED = ["010", "011", "012", "013", "014"];

const files = readdirSync(DEFAULT_MIGRATIONS_DIR);
const ownedUps = files.filter((f) => OWNED.includes(f.slice(0, 3)) && f.endsWith(".up.sql"));
const live = Boolean(process.env.CLICKHOUSE_URL);

describe("migrations 010-014 on disk", () => {
  it("gives every owned .up.sql a real matching .down.sql", () => {
    expect(ownedUps.sort()).toEqual([
      "010_graph_database.up.sql",
      "011_graph_node.up.sql",
      "012_graph_edge.up.sql",
      "013_graph_node_policy.up.sql",
      "014_graph_edge_policy.up.sql",
    ]);
    for (const up of ownedUps) {
      const down = up.replace(/\.up\.sql$/, ".down.sql");
      expect(files).toContain(down);
      const body = readFileSync(path.join(DEFAULT_MIGRATIONS_DIR, down), "utf8");
      expect(body).toMatch(/^\s*DROP\s+/im);
    }
  });

  it("claims no number outside 010-019 and none of S6/S6a's 000-007", () => {
    const graphVersions = files
      .filter((f) => f.includes("_graph_") && f.endsWith(".up.sql"))
      .map((f) => Number(f.slice(0, 3)));
    expect(graphVersions.length).toBe(5);
    for (const v of graphVersions) {
      expect(v).toBeGreaterThanOrEqual(10);
      expect(v).toBeLessThanOrEqual(19);
    }
  });

  it("needs no env substitution, so it cannot fail on a missing variable", () => {
    for (const up of ownedUps) {
      expect(readFileSync(path.join(DEFAULT_MIGRATIONS_DIR, up), "utf8")).not.toMatch(/\$\{/);
    }
  });
});

describe.skipIf(!live)("migrations 010-014 applied", () => {
  beforeAll(async () => {
    await applyMigrations();
  }, 60_000);

  it("records every owned version in the runner's ledger", async () => {
    const rows = await chQuery<{ version: string }>(
      "SELECT version FROM default._ch_migrations FINAL ORDER BY version",
    );
    const applied = rows.map((r) => r.version);
    for (const version of OWNED) expect(applied).toContain(version);
  });

  it("is idempotent -- a second run applies nothing", async () => {
    await expect(applyMigrations()).resolves.toEqual([]);
  });

  it("orders both tables with the tenant leading", async () => {
    const rows = await chQuery<{ name: string; sorting_key: string }>(
      "SELECT name, sorting_key FROM system.tables " +
        "WHERE database = 'gentle_space' AND name LIKE 'graph\\_%' ORDER BY name",
    );
    expect(rows).toEqual([
      {
        name: "graph_edge",
        sorting_key: "org_id, snapshot_id, source_kind, relationship_kind, source_id",
      },
      { name: "graph_node", sorting_key: "org_id, snapshot_id, node_kind, node_id" },
    ]);
  });

  it("is tables, not a graph engine", async () => {
    const rows = await chQuery<{ engine: string }>(
      "SELECT DISTINCT engine FROM system.tables " +
        "WHERE database = 'gentle_space' AND name LIKE 'graph\\_%'",
    );
    expect(rows).toEqual([{ engine: "MergeTree" }]);
  });

  it("carries subject provenance on nodes so erasure can prune", async () => {
    const rows = await chQuery<{ type: string }>(
      "SELECT type FROM system.columns WHERE database = 'gentle_space' " +
        "AND table = 'graph_node' AND name = 'subject_ref'",
    );
    expect(rows).toEqual([{ type: "Nullable(String)" }]);
  });

  it("types edge properties as columns rather than JSON", async () => {
    const rows = await chQuery<{ name: string; type: string }>(
      "SELECT name, type FROM system.columns WHERE database = 'gentle_space' " +
        "AND table = 'graph_edge' AND name IN ('meters', 'weight', 'confidence') ORDER BY name",
    );
    expect(rows).toEqual([
      { name: "confidence", type: "Nullable(Float32)" },
      { name: "meters", type: "Nullable(UInt32)" },
      { name: "weight", type: "Nullable(Float32)" },
    ]);
  });

  it("puts a fail-closed tenant row policy on both tables", async () => {
    const rows = await chQuery<{
      short_name: string;
      select_filter: string;
      apply_to_all: number;
      apply_to_except: string[];
    }>(
      "SELECT short_name, select_filter, apply_to_all, apply_to_except " +
        "FROM system.row_policies WHERE database = 'gentle_space' ORDER BY short_name",
    );
    expect(rows.map((r) => r.short_name)).toEqual(["graph_edge_tenant", "graph_node_tenant"]);
    for (const row of rows) {
      expect(row.select_filter).toContain("toUUIDOrZero(getSetting('SQL_current_tenant_id'))");
      expect(row.apply_to_all).toBe(1);
      expect(row.apply_to_except).toEqual(["etl_writer"]);
    }
  });

  it("has a down migration that really reverses, proven on 014", async () => {
    const dir = DEFAULT_MIGRATIONS_DIR;
    const count = async () =>
      (
        await chQuery<{ c: string }>(
          "SELECT toString(count()) AS c FROM system.row_policies " +
            "WHERE database = 'gentle_space' AND short_name = 'graph_edge_tenant'",
        )
      )[0].c;

    expect(await count()).toBe("1");
    await chExec(readFileSync(path.join(dir, "014_graph_edge_policy.down.sql"), "utf8"));
    expect(await count()).toBe("0");
    await chExec(readFileSync(path.join(dir, "014_graph_edge_policy.up.sql"), "utf8"));
    expect(await count()).toBe("1");
  });
});
