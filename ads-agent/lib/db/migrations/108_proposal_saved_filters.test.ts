import { describe, expect, it } from "vitest";
import { readMigration } from "./migration-assertions";

const up = readMigration("108_proposal_saved_filters.up.sql");
const down = readMigration("108_proposal_saved_filters.down.sql");

describe("108_proposal_saved_filters", () => {
  it("creates a schema-qualified table with uuidv7 and owner name uniqueness", () => {
    expect(up).toMatch(
      /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?adsagent\.proposal_saved_filters/i,
    );
    expect(up).toContain("DEFAULT uuidv7()");
    expect(up).toMatch(/UNIQUE\s*\(\s*owner_user_id\s*,\s*name\s*\)/i);
    expect(up).toMatch(/query\s+JSONB\s+NOT\s+NULL/i);
  });

  it("ENABLEs and FORCEs RLS with owner + platform read policy", () => {
    expect(up).toContain("ALTER TABLE adsagent.proposal_saved_filters ENABLE ROW LEVEL SECURITY");
    expect(up).toContain("ALTER TABLE adsagent.proposal_saved_filters FORCE  ROW LEVEL SECURITY");
    expect(up).toMatch(
      /owner_user_id\s*=\s*public\.current_app_user\(\)\s*OR\s*public\.is_platform_read\(\)/i,
    );
    expect(up).toMatch(
      /WITH\s+CHECK\s*\(\s*owner_user_id\s*=\s*public\.current_app_user\(\)\s*AND\s*org_id\s*=\s*public\.current_tenant\(\)\s*\)/i,
    );
  });

  it("adds set_user and current_app_user session primitives", () => {
    expect(up).toContain("CREATE OR REPLACE FUNCTION public.set_user");
    expect(up).toContain("CREATE OR REPLACE FUNCTION public.current_app_user");
    expect(up).toContain("app.current_user_id");
  });

  it("down drops the table and user session primitives", () => {
    expect(down).toContain("DROP TABLE IF EXISTS adsagent.proposal_saved_filters");
    expect(down).toContain("DROP FUNCTION IF EXISTS public.current_app_user");
    expect(down).toContain("DROP FUNCTION IF EXISTS public.set_user");
  });
});
