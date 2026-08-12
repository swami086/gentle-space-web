/**
 * Cron: outbox retention — `npm run outbox:prune`.
 * Data model §5a: keep published rows only as long as they are useful for
 * debugging replay, and monitor bloat on this table specifically.
 *
 * Suggested schedule: daily, off-peak.
 */
import { pruneOutbox } from "../lib/events/prune";
import { closeRelayPool } from "../lib/events/relay-pool";

const RETENTION_DAYS = Number(process.env.OUTBOX_RETENTION_DAYS ?? 14);

async function main(): Promise<void> {
  const result = await pruneOutbox(RETENTION_DAYS);
  console.log(`outbox prune deleted=${result.deleted} retentionDays=${RETENTION_DAYS} deadTuples=${result.deadTuples}`);
  await closeRelayPool();
}

main().catch((err) => {
  console.error("ALERT outbox.prune_failed", err);
  process.exit(1);
});
