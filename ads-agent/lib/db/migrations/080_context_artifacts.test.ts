import { describe, it, expect } from "vitest";
import { assertTenantTableHardening, readMigration } from "./migration-assertions";

const up = readMigration("080_context_artifacts.up.sql");

describe("080_context_artifacts", () => {
  it("hardens the table: enabled, forced, USING and WITH CHECK", () => {
    expect(() => assertTenantTableHardening(up, "context.artifacts")).not.toThrow();
  });

  it("uses uuidv7 and TIMESTAMPTZ throughout", () => {
    expect(up).toContain("DEFAULT uuidv7()");
    expect(up).not.toMatch(/TIMESTAMP(?!TZ)/);
  });

  it("makes a mis-prefixed storage key unstorable", () => {
    expect(up).toContain("artifacts_key_carries_tenant");
    expect(up).toContain("storage_key = 'artifacts/' || org_id::text");
  });

  it("indexes subject_refs for per-subject erasure", () => {
    expect(up).toMatch(/USING GIN \(subject_refs\)/);
  });

  it("leads its btree indexes with org_id", () => {
    for (const match of up.matchAll(/CREATE INDEX[^;]*?\(([^)]*)\)/g)) {
      if (match[0].includes("GIN")) continue;
      expect(match[1].trim(), match[0]).toMatch(/^org_id/);
    }
  });

  it("has a down migration that drops what the up created", () => {
    const down = readMigration("080_context_artifacts.down.sql");
    expect(down).toContain("DROP TABLE IF EXISTS context.artifacts");
  });
});
