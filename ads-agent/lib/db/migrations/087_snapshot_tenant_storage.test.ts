import { describe, it, expect } from "vitest";
import { assertTenantTableHardening, readMigration } from "./migration-assertions";

const up = readMigration("087_snapshot_tenant_storage.up.sql");

describe("087_snapshot_tenant_storage", () => {
  it("hardens the table", () => {
    expect(() => assertTenantTableHardening(up, "context.snapshot_storage")).not.toThrow();
  });

  it("stores only sealed secrets, never plaintext ones", () => {
    expect(up).toContain("reader_secret_sealed BYTEA");
    expect(up).toContain("data_key_sealed      BYTEA");
    expect(up).not.toMatch(/secret_access_key\s+TEXT/i);
  });

  it("records key destruction, which is what crypto-shredding evidences", () => {
    expect(up).toContain("key_destroyed_at");
  });

  it("has a down that drops the table", () => {
    expect(readMigration("087_snapshot_tenant_storage.down.sql")).toContain(
      "DROP TABLE IF EXISTS context.snapshot_storage",
    );
  });
});
