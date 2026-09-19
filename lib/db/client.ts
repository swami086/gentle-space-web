import { Pool } from "pg";

let pool: Pool | null = null;

/**
 * Consolidated DB (S1–S3) keeps listing tables in schema `listings`. App SQL is
 * unqualified (`FROM listings`), so connections must resolve that schema the
 * same way role `listings_rw` does: ag_catalog first (AGE), then listings.
 * Local `.env` still uses the owner role `gentle`, which defaults to
 * `"$user", public` and otherwise misses `listings.listings`.
 */
const LISTINGS_SEARCH_PATH = "ag_catalog,listings,public";

export function getPool(): Pool {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  if (!pool) {
    // Render Internal/External URLs need SSL; local Docker Postgres does not.
    const needsSsl = /render\.com|dpg-/i.test(process.env.DATABASE_URL);
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      options: `-c search_path=${LISTINGS_SEARCH_PATH}`,
      ...(needsSsl ? { ssl: { rejectUnauthorized: false } } : {}),
    });
  }
  return pool;
}
