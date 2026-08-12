import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Pool } from "pg";

const LEDGER = `CREATE TABLE IF NOT EXISTS public.schema_migrations (
  version    TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
)`;

/**
 * The runner owns the transaction so that applying a migration and recording it
 * commit together. A file's own BEGIN/COMMIT would otherwise commit the
 * runner's transaction and leave the ledger insert outside it.
 */
export function stripOuterTransaction(sql: string): string {
  return sql
    .replace(/^\s*BEGIN\s*;/i, "")
    .replace(/COMMIT\s*;\s*$/i, "")
    .trim();
}

export function pendingMigrations(files: string[], applied: string[]): string[] {
  const done = new Set(applied);
  return files
    .filter((f) => f.endsWith(".up.sql"))
    .map((f) => f.slice(0, -".up.sql".length))
    .filter((version) => !done.has(version))
    .sort();
}

async function appliedVersions(pool: Pool): Promise<string[]> {
  await pool.query(LEDGER);
  const { rows } = await pool.query<{ version: string }>(
    `SELECT version FROM public.schema_migrations`,
  );
  return rows.map((r) => r.version);
}

export async function applyMigrations(pool: Pool, dir: string): Promise<string[]> {
  const pending = pendingMigrations(readdirSync(dir), await appliedVersions(pool));
  for (const version of pending) {
    const sql = stripOuterTransaction(
      readFileSync(path.join(dir, `${version}.up.sql`), "utf-8"),
    );
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(`INSERT INTO public.schema_migrations (version) VALUES ($1)`, [version]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw new Error(
        `migration ${version} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      client.release();
    }
  }
  return pending;
}

export async function rollbackLast(pool: Pool, dir: string): Promise<string | null> {
  await pool.query(LEDGER);
  const { rows } = await pool.query<{ version: string }>(
    `SELECT version FROM public.schema_migrations ORDER BY version DESC LIMIT 1`,
  );
  const version = rows[0]?.version;
  if (!version) return null;

  const sql = stripOuterTransaction(
    readFileSync(path.join(dir, `${version}.down.sql`), "utf-8"),
  );
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query(`DELETE FROM public.schema_migrations WHERE version = $1`, [version]);
    await client.query("COMMIT");
    return version;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw new Error(
      `rollback ${version} failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  } finally {
    client.release();
  }
}
