/**
 * Cron: the deletion reconciler — `npm run reconcile:deletions`.
 *
 * §14.5: cron finds work by time and publishes rather than doing it. §14.4:
 * this is the one event class where a drop is a compliance breach, so its alert
 * is distinct from ordinary publish failures and its exit code is non-zero when
 * an erasure has stalled — a cron mail is the alerting channel.
 *
 * Suggested schedule: every 10 minutes (cron: minute 0,10,20…).
 */
import { reconcileDeletions } from "../lib/events/deletion-reconciler";
import { closeRelayPool } from "../lib/events/relay-pool";

const REPUBLISH_AFTER_MINUTES = Number(process.env.OUTBOX_DELETION_REPUBLISH_AFTER_MINUTES ?? 10);
const ALERT_AFTER_HOURS = Number(process.env.OUTBOX_DELETION_ALERT_AFTER_HOURS ?? 24);

async function main(): Promise<void> {
  const result = await reconcileDeletions({
    republishAfterMinutes: REPUBLISH_AFTER_MINUTES,
    alertAfterHours: ALERT_AFTER_HOURS,
  });
  console.log(`deletion reconciler republished=${result.republished} stalled=${result.stalled.length}`);

  if (result.stalled.length > 0) {
    console.error(
      `ALERT deletion.propagation_stalled count=${result.stalled.length} ` +
        `olderThanHours=${ALERT_AFTER_HOURS} refs=${result.stalled.join(",")}`,
    );
  }

  await closeRelayPool();
  // Non-zero when an erasure obligation is overdue: this is a compliance
  // deadline (DPDP Rule 14(3): 90 days maximum), not a transient blip.
  process.exit(result.stalled.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("ALERT deletion.reconciler_failed", err);
  process.exit(1);
});
