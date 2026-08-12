import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { getPool } from "./client";

const MIGRATIONS_DIR = path.join(process.cwd(), "lib/db/migrations");

/**
 * Applies every numbered migration not already recorded in public.schema_migrations,
 * each in its own transaction.
 *
 * The ledger lives in the database, not in a file, so it travels with the
 * pg_dump that S2 restores into the adsagent schema — which is what stops the
 * pre-consolidation migrations (001, 002) being replayed against tables that
 * have since moved schema.
 */
export async function migrate(): Promise<string[]> {
  const pool = getPool();

  await pool.query(
    `CREATE TABLE IF NOT EXISTS public.schema_migrations (
       version    TEXT PRIMARY KEY,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
     )`,
  );

  const { rows } = await pool.query<{ version: string }>(
    `SELECT version FROM public.schema_migrations`,
  );
  const applied = new Set(rows.map((r) => r.version));

  const pending = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".up.sql"))
    .map((f) => f.replace(".up.sql", ""))
    .sort()
    .filter((version) => !applied.has(version));

  const ran: string[] = [];
  for (const version of pending) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, `${version}.up.sql`), "utf-8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(`INSERT INTO public.schema_migrations (version) VALUES ($1)`, [version]);
      await client.query("COMMIT");
      ran.push(version);
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw new Error(
        `migration ${version} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      client.release();
    }
  }
  return ran;
}

async function main(): Promise<void> {
  const ran = await migrate();
  console.log(
    ran.length > 0
      ? `ads-agent: applied ${ran.length} migration(s): ${ran.join(", ")}`
      : "ads-agent: no pending migrations",
  );
}

// ponytail: skip CLI when vitest dynamic-imports this module
if (process.argv[1]?.endsWith("migrate.ts")) {
  main().catch((err) => {
    console.error("ads-agent: migration failed", err);
    process.exit(1);
  });
}
