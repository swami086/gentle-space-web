import { Pool } from "pg";

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  if (!pool) {
    // Render Internal/External URLs need SSL; local Docker Postgres does not.
    const needsSsl = /render\.com|dpg-/i.test(process.env.DATABASE_URL);
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ...(needsSsl ? { ssl: { rejectUnauthorized: false } } : {}),
    });
  }
  return pool;
}
