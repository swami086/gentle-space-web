import { relayPool } from "./relay-pool";

/**
 * Data model §5a retention. "A high-churn queue table is exactly where MVCC
 * bloat and vacuum pressure bite" — published rows are kept only as long as
 * they are useful for debugging replay.
 *
 * This is a genuine DELETE, and it is not an exception to "suppression columns,
 * never DELETE": that rule protects personal data under DPDP's retention floor.
 * These rows are transport bookkeeping whose payloads reference the records
 * rather than being them, and the record itself is retained by the store that
 * owns it.
 */
export async function pruneOutbox(retentionDays: number): Promise<{ deleted: number; deadTuples: number }> {
  const pool = relayPool();
  const { rowCount } = await pool.query(
    `DELETE FROM context.outbox_events
      WHERE published_at IS NOT NULL
        AND published_at < now() - make_interval(days => $1)`,
    [retentionDays],
  );
  const { rows } = await pool.query<{ n_dead_tup: string }>(
    `SELECT coalesce(n_dead_tup, 0)::text AS n_dead_tup
       FROM pg_stat_user_tables
      WHERE schemaname = 'context' AND relname = 'outbox_events'`,
  );
  return { deleted: rowCount ?? 0, deadTuples: Number(rows[0]?.n_dead_tup ?? 0) };
}
