import { describe, it, expect } from "vitest";
import { assertTenantTableHardening, readMigration } from "./migration-assertions";

const up = readMigration("082_artifact_sweep_state.up.sql");

describe("082_artifact_sweep_state", () => {
  it("hardens the tenant-scoped flags table", () => {
    expect(() => assertTenantTableHardening(up, "context.artifact_dangling_flags")).not.toThrow();
  });

  it("classifies a dangling row as mid_erasure or unexplained", () => {
    expect(up).toContain("'mid_erasure'");
    expect(up).toContain("'unexplained'");
  });

  it("records both sweeps by name", () => {
    expect(up).toMatch(/sweep IN \('orphan','dangling'\)/);
  });

  it("has a down that drops both tables", () => {
    const down = readMigration("082_artifact_sweep_state.down.sql");
    expect(down).toContain("DROP TABLE IF EXISTS context.artifact_dangling_flags");
    expect(down).toContain("DROP TABLE IF EXISTS context.artifact_sweep_runs");
  });
});
