import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
let pool: Pool;

beforeAll(() => {
  if (url) pool = new Pool({ connectionString: url, max: 2 });
});
afterAll(async () => {
  if (pool) await pool.end();
});

suite("RLS coverage", () => {
  it("every table carrying org_id has RLS both ENABLEd and FORCEd", async () => {
    // Keyed off the presence of an org_id column rather than a hand-maintained
    // list, so a new tenant table added tomorrow fails this test on the day it
    // lands rather than the day it leaks.
    const { rows } = await pool.query<{ unprotected: string }>(
      `SELECT format('%s.%s', n.nspname, c.relname) AS unprotected
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'r'
          AND n.nspname IN ('adsagent','context','derived')
          AND EXISTS (
                SELECT 1 FROM pg_attribute a
                 WHERE a.attrelid = c.oid AND a.attname = 'org_id' AND NOT a.attisdropped
              )
          AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity)
        ORDER BY 1`,
    );
    expect(rows.map((r) => r.unprotected), "these tables are unprotected").toEqual([]);
  });

  it("every policy carries WITH CHECK as well as USING", async () => {
    const { rows } = await pool.query<{ missing: string }>(
      `SELECT format('%s.%s/%s', schemaname, tablename, policyname) AS missing
         FROM pg_policies
        WHERE schemaname IN ('adsagent','context','derived')
          AND with_check IS NULL
        ORDER BY 1`,
    );
    // USING alone stops a tenant reading another's rows but not writing rows
    // carrying another tenant's org_id.
    expect(rows.map((r) => r.missing)).toEqual([]);
  });

  it("no policy compares against current_setting directly", async () => {
    // Everything goes through public.current_tenant(), which is the single
    // helper that no code path bypasses.
    const { rows } = await pool.query<{ policyname: string; qual: string }>(
      `SELECT policyname, qual FROM pg_policies
        WHERE schemaname IN ('adsagent','context','derived')
          AND qual LIKE '%current_setting%'`,
    );
    expect(rows).toEqual([]);
  });

  it("the application role owns no table it can read", async () => {
    // FORCE ROW LEVEL SECURITY covers the owner case, but a non-owning role is
    // the belt to that braces (validation F-20).
    const { rows } = await pool.query<{ relname: string }>(
      `SELECT c.relname FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_roles r ON r.oid = c.relowner
        WHERE n.nspname = 'adsagent' AND c.relkind = 'r' AND r.rolname = 'adsagent_rw'`,
    );
    expect(rows).toEqual([]);
  });

  it("every org_id-carrying table has an index leading with org_id", async () => {
    const { rows } = await pool.query<{ table_name: string }>(
      `SELECT format('%s.%s', n.nspname, c.relname) AS table_name
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'r'
          AND n.nspname IN ('adsagent','context')
          AND EXISTS (SELECT 1 FROM pg_attribute a
                       WHERE a.attrelid = c.oid AND a.attname = 'org_id' AND NOT a.attisdropped)
          AND NOT EXISTS (
                SELECT 1 FROM pg_index i
                 WHERE i.indrelid = c.oid
                   AND (SELECT a.attname FROM pg_attribute a
                         WHERE a.attrelid = c.oid AND a.attnum = i.indkey[0]) = 'org_id'
              )
        ORDER BY 1`,
    );
    // A missing leading-edge tenant index quietly destroys customer-facing
    // query latency at scale.
    expect(rows.map((r) => r.table_name)).toEqual([]);
  });
});
