/**
 * Cron: the outbox's four §12.4 signals — `npm run outbox:health`.
 * Prints one ALERT line per breached signal and exits non-zero, so cron mail is
 * the alerting channel and no additional service is needed.
 *
 * Suggested schedule: every 5 minutes.
 */
import { healthAlerts, readOutboxHealth } from "../lib/events/health";
import { closeRelayPool } from "../lib/events/relay-pool";

async function main(): Promise<void> {
  const health = await readOutboxHealth();
  const alerts = healthAlerts(health, {
    lagSeconds: Number(process.env.OUTBOX_LAG_ALERT_SECONDS ?? 300),
    deletionLagSeconds: Number(process.env.OUTBOX_DELETION_LAG_ALERT_SECONDS ?? 60),
    stuckCount: Number(process.env.OUTBOX_STUCK_ALERT_COUNT ?? 1),
    deadTuples: Number(process.env.OUTBOX_BLOAT_ALERT_DEAD_TUPLES ?? 100_000),
  });

  console.log(
    `outbox health unpublished=${health.unpublishedCount} oldestSeconds=${health.oldestUnpublishedSeconds} ` +
      `deletionUnpublished=${health.unpublishedDeletionCount} stuck=${health.stuckCount} deadTuples=${health.deadTuples}`,
  );
  for (const alert of alerts) console.error(alert);

  await closeRelayPool();
  process.exit(alerts.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("ALERT outbox.health_check_failed", err);
  process.exit(1);
});
