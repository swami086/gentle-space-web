import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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

suite("every down migration reverses its up", () => {
  it("002 removes and restores the decider columns", async () => {
    const dir = join(__dirname, "migrations");
    const { rows: loc } = await pool.query<{ table_schema: string }>(
      `SELECT table_schema FROM information_schema.tables
        WHERE table_name = 'proposals' AND table_schema IN ('public','adsagent')`,
    );
    const schema = loc[0]?.table_schema ?? "adsagent";
    const qualify = (sql: string) => sql.replaceAll("public.proposals", `${schema}.proposals`);
    const down = qualify(readFileSync(join(dir, "002_proposal_decider.down.sql"), "utf8"));
    const up = qualify(readFileSync(join(dir, "002_proposal_decider.up.sql"), "utf8"));

    const countCols = async () => {
      const { rows } = await pool.query<{ n: string }>(
        `SELECT count(*) AS n FROM information_schema.columns
          WHERE table_schema = $1 AND table_name = 'proposals'
            AND column_name IN ('decided_by','decided_via')`,
        [schema],
      );
      return Number(rows[0].n);
    };

    expect(await countCols()).toBe(2);
    await pool.query(down);
    expect(await countCols()).toBe(0);
    await pool.query(up);
    expect(await countCols()).toBe(2);
  });

  it("001 restores the widened role CHECK after a down-and-up", async () => {
    const dir = join(__dirname, "migrations");
    await pool.query(readFileSync(join(dir, "001_role_vocabulary.down.sql"), "utf8"));
    await pool.query(readFileSync(join(dir, "001_role_vocabulary.up.sql"), "utf8"));
    const { rows } = await pool.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'users_role_check'`,
    );
    expect(rows[0].def).toContain("operator");
    expect(rows[0].def).toContain("viewer");
  });
});
