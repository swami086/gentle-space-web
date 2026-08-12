import { Pool } from "pg";

let pool: Pool | null = null;

/**
 * The relay's own pool, as its own role. Separate from getPool() on purpose:
 * outbox_relay is a deliberate cross-tenant actor (data model §5a) and the
 * application role must never inherit that reach.
 */
export function relayPool(): Pool {
  if (!process.env.OUTBOX_RELAY_DATABASE_URL) {
    throw new Error("OUTBOX_RELAY_DATABASE_URL is not set");
  }
  if (!pool) {
    pool = new Pool({ connectionString: process.env.OUTBOX_RELAY_DATABASE_URL, max: 2 });
  }
  return pool;
}

export async function closeRelayPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
