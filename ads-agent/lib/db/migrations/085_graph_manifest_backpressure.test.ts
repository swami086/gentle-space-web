import { describe, it, expect } from "vitest";
import { assertTenantTableHardening, readMigration } from "./migration-assertions";

const up = readMigration("085_graph_manifest_backpressure.up.sql");

describe("085_graph_manifest_backpressure", () => {
  it("hardens the manifest table", () => {
    expect(() => assertTenantTableHardening(up, "context.graph_manifests")).not.toThrow();
  });

  it("adds every column as an explicit ALTER, since the table may pre-exist", () => {
    for (const col of [
      "cdc_lag_seconds",
      "source_watermark",
      "last_user_activity_at",
      "generation",
      "attempts",
    ]) {
      expect(up).toContain(`ADD COLUMN IF NOT EXISTS ${col}`);
    }
  });

  it("seeds the concurrency ceiling as rows, so the ceiling is 2", () => {
    expect(up).toContain("context.rebuild_slots");
    expect(up).toMatch(/INSERT INTO context\.rebuild_slots[\s\S]*VALUES \(1\), \(2\)/);
  });

  it("uses TIMESTAMPTZ throughout", () => {
    expect(up).not.toMatch(/TIMESTAMP(?!TZ)/);
  });

  it("has a down that removes both the columns and the slots table", () => {
    const down = readMigration("085_graph_manifest_backpressure.down.sql");
    expect(down).toContain("DROP TABLE IF EXISTS context.rebuild_slots");
    expect(down).toContain("DROP COLUMN IF EXISTS cdc_lag_seconds");
  });
});
