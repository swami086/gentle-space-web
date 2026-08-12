import { describe, it, expect } from "vitest";
import { assertTenantTableHardening, readMigration } from "./migration-assertions";

const up = readMigration("081_deletion_ledger_objectstore.up.sql");

describe("081_deletion_ledger_objectstore", () => {
  it("hardens both ledger tables", () => {
    expect(() => assertTenantTableHardening(up, "context.deletion_requests")).not.toThrow();
    expect(() => assertTenantTableHardening(up, "context.deletion_propagations")).not.toThrow();
  });

  it("includes objectstore in the store vocabulary", () => {
    expect(up).toContain("'objectstore'");
    expect(up).toContain("deletion_propagations_store_check");
  });

  it("adds and backfills org_id, since §6.1 omitted it and RLS needs it", () => {
    expect(up).toContain("ADD COLUMN IF NOT EXISTS org_id");
    expect(up).toMatch(/UPDATE context\.deletion_propagations[\s\S]*SET org_id = r\.org_id/);
    expect(up).toContain("ALTER COLUMN org_id SET NOT NULL");
  });

  it("has a down that drops both tables", () => {
    const down = readMigration("081_deletion_ledger_objectstore.down.sql");
    expect(down).toContain("DROP TABLE IF EXISTS context.deletion_propagations");
    expect(down).toContain("DROP TABLE IF EXISTS context.deletion_requests");
  });
});
