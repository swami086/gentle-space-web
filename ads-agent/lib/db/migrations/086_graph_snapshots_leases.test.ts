import { describe, it, expect } from "vitest";
import { assertTenantTableHardening, readMigration } from "./migration-assertions";

const up = readMigration("086_graph_snapshots_leases.up.sql");

describe("086_graph_snapshots_leases", () => {
  it("hardens both tenant tables", () => {
    expect(() => assertTenantTableHardening(up, "context.graph_snapshots")).not.toThrow();
    expect(() => assertTenantTableHardening(up, "context.snapshot_leases")).not.toThrow();
  });

  it("carries the compliance columns from data model §9", () => {
    for (const col of ["expires_at", "source_watermark", "cdc_lag_seconds", "generation"]) {
      expect(up).toContain(`ADD COLUMN IF NOT EXISTS ${col}`);
    }
  });

  it("leads every btree index with org_id", () => {
    for (const match of up.matchAll(/CREATE INDEX[^;]*?\(([^)]*)\)/g)) {
      expect(match[1].trim(), match[0]).toMatch(/^org_id/);
    }
  });

  it("makes (org_id, snapshot_id) unique so a generation cannot be recorded twice", () => {
    expect(up).toContain("UNIQUE (org_id, snapshot_id)");
  });

  it("has a down that drops both tables", () => {
    const down = readMigration("086_graph_snapshots_leases.down.sql");
    expect(down).toContain("DROP TABLE IF EXISTS context.snapshot_leases");
    expect(down).toContain("DROP TABLE IF EXISTS context.graph_snapshots");
  });
});
