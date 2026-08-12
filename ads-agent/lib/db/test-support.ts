import { Pool } from "pg";

let pool: Pool | null = null;

/**
 * The pool every *.db.test.ts uses. Throws rather than skipping when
 * TEST_DATABASE_URL is unset: the S5a gate is a transaction-atomicity property,
 * and a gate that can silently not run is not a gate.
 */
export function testPool(): Pool {
  if (!process.env.TEST_DATABASE_URL) {
    throw new Error(
      "TEST_DATABASE_URL is not set. Database tests need a live PostgreSQL 18:\n" +
        "  docker compose -f ../docker-compose.listings.yml up -d db\n" +
        "  export TEST_DATABASE_URL=postgres://gentle:gentle@localhost:5433/gentle_space_listings",
    );
  }
  if (!pool) {
    // max: 1 so a test can assert what the *next* request on the same physical
    // connection sees — the pooled-connection tenant leak is invisible otherwise.
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1 });
  }
  return pool;
}

export async function closeTestPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

export async function seedOrg(pool: Pool, name: string): Promise<string> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const slug = `${name}-${suffix}`.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO public.orgs (name, kind, slug) VALUES ($1, 'external', $2) RETURNING id`,
    [`${name}-${suffix}`, slug],
  );
  return rows[0].id;
}

export async function resetOutbox(pool: Pool, orgId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT public.set_tenant($1)", [orgId]);
    await client.query(`DELETE FROM context.outbox_events WHERE org_id = $1`, [orgId]);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/** Test helper: clear the outbox table (requires BYPASSRLS or table owner). */
export async function resetAllOutbox(pool: Pool): Promise<void> {
  await pool.query(`DELETE FROM context.outbox_events`);
}
