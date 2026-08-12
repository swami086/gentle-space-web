import { relayPool } from "./relay-pool";

/**
 * The outbox's share of datastore spec §12.4: one alert per signal, one channel.
 * The channel is a stable `ALERT <name> …` line on stderr plus a non-zero exit
 * from scripts/check-outbox-health.ts, which is what a solo operator can
 * actually maintain.
 */
export type OutboxHealth = {
  unpublishedCount: number;
  oldestUnpublishedSeconds: number;
  unpublishedDeletionCount: number;
  oldestUnpublishedDeletionSeconds: number;
  stuckCount: number;
  deadTuples: number;
};

export type HealthThresholds = {
  lagSeconds: number;
  deletionLagSeconds: number;
  stuckCount: number;
  deadTuples: number;
};

type HealthRow = {
  unpublished_count: string;
  oldest_unpublished_seconds: string;
  unpublished_deletion_count: string;
  oldest_unpublished_deletion_seconds: string;
  stuck_count: string;
};

export async function readOutboxHealth(): Promise<OutboxHealth> {
  const pool = relayPool();
  const { rows } = await pool.query<HealthRow>(`SELECT * FROM context.outbox_health`);
  // Bloat is not in the view: pg_stat_user_tables is a different relation, and
  // §5a names this table specifically as the one to watch for it.
  const { rows: bloat } = await pool.query<{ n_dead_tup: string }>(
    `SELECT coalesce(n_dead_tup, 0)::text AS n_dead_tup
       FROM pg_stat_user_tables
      WHERE schemaname = 'context' AND relname = 'outbox_events'`,
  );
  return {
    unpublishedCount: Number(rows[0].unpublished_count),
    oldestUnpublishedSeconds: Number(rows[0].oldest_unpublished_seconds),
    unpublishedDeletionCount: Number(rows[0].unpublished_deletion_count),
    oldestUnpublishedDeletionSeconds: Number(rows[0].oldest_unpublished_deletion_seconds),
    stuckCount: Number(rows[0].stuck_count),
    deadTuples: Number(bloat[0]?.n_dead_tup ?? 0),
  };
}

export function healthAlerts(health: OutboxHealth, thresholds: HealthThresholds): string[] {
  const alerts: string[] = [];
  if (health.oldestUnpublishedSeconds > thresholds.lagSeconds) {
    alerts.push(
      `ALERT outbox.relay_lag seconds=${health.oldestUnpublishedSeconds} threshold=${thresholds.lagSeconds}`,
    );
  }
  // §14.4: deletion gets its own alert and a tighter threshold, because a
  // delayed erasure is a compliance breach rather than a stale dashboard.
  if (health.oldestUnpublishedDeletionSeconds > thresholds.deletionLagSeconds) {
    alerts.push(
      `ALERT outbox.deletion_lag seconds=${health.oldestUnpublishedDeletionSeconds} ` +
        `threshold=${thresholds.deletionLagSeconds} count=${health.unpublishedDeletionCount}`,
    );
  }
  if (health.stuckCount >= thresholds.stuckCount) {
    alerts.push(`ALERT outbox.stuck_events count=${health.stuckCount} threshold=${thresholds.stuckCount}`);
  }
  if (health.deadTuples > thresholds.deadTuples) {
    alerts.push(`ALERT outbox.bloat deadTuples=${health.deadTuples} threshold=${thresholds.deadTuples}`);
  }
  return alerts;
}
