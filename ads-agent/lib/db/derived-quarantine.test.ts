import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Pool } from "pg";

const live = Boolean(process.env.TEST_DATABASE_URL);
let pool: Pool;

beforeAll(async () => {
  if (live) pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 2 });
});
afterAll(async () => {
  if (live) await pool.end();
});

describe.skipIf(!live)("derived schema is a quarantine", () => {
  it("has at least one table, so this suite is not vacuously green", async () => {
    const { rows } = await pool.query<{ c: string }>(
      `SELECT count(*) AS c FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'derived' AND c.relkind = 'r'`,
    );
    expect(Number(rows[0].c)).toBeGreaterThan(0);
  });

  it("is never the input to another derivation: no view outside derived reads it", async () => {
    const { rows } = await pool.query<{ dependent_object: string }>(
      `SELECT DISTINCT dn.nspname || '.' || dependent.relname AS dependent_object
         FROM pg_depend d
         JOIN pg_rewrite r      ON r.oid = d.objid
         JOIN pg_class dependent ON dependent.oid = r.ev_class
         JOIN pg_namespace dn    ON dn.oid = dependent.relnamespace
         JOIN pg_class source    ON source.oid = d.refobjid
         JOIN pg_namespace sn    ON sn.oid = source.relnamespace
        WHERE sn.nspname = 'derived' AND dn.nspname <> 'derived'`,
    );
    expect(rows.map((r) => r.dependent_object)).toEqual([]);
  });

  it("no table outside derived has a foreign key into it", async () => {
    const { rows } = await pool.query<{ conname: string }>(
      `SELECT c.conname FROM pg_constraint c
         JOIN pg_class t   ON t.oid = c.conrelid
         JOIN pg_namespace n  ON n.oid = t.relnamespace
         JOIN pg_class rt  ON rt.oid = c.confrelid
         JOIN pg_namespace rn ON rn.oid = rt.relnamespace
        WHERE c.contype = 'f' AND rn.nspname = 'derived' AND n.nspname <> 'derived'`,
    );
    expect(rows.map((r) => r.conname)).toEqual([]);
  });

  it("forces RLS on every derived table, because these rows are personal data too", async () => {
    const { rows } = await pool.query<{ relname: string }>(
      `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'derived' AND c.relkind = 'r'
          AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity)`,
    );
    expect(rows).toEqual([]);
  });

  it("says so on the schema, so a reader of the catalogue learns the rule", async () => {
    const { rows } = await pool.query<{ description: string | null }>(
      `SELECT obj_description(oid, 'pg_namespace') AS description FROM pg_namespace WHERE nspname = 'derived'`,
    );
    expect(rows[0].description).toContain("truncatable");
  });
});
