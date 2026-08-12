/**
 * The relay — `npm run relay`. Not cron: outbox latency is user-visible, and a
 * minute-granularity clock would add a minute to every enquiry. Cron's job in
 * this system is finding work by time (datastore spec §14.5); this loop's job
 * is transport.
 */
import { createPublisher } from "../lib/events/publisher";
import { closeRelayPool } from "../lib/events/relay-pool";
import { runRelayOnce } from "../lib/events/relay";

const POLL_MS = Number(process.env.OUTBOX_RELAY_POLL_MS ?? 500);
const BATCH_SIZE = Number(process.env.OUTBOX_RELAY_BATCH_SIZE ?? 100);
const PER_ORG_CEILING = Number(process.env.OUTBOX_RELAY_PER_ORG_CEILING ?? 25);
const IDLE_BACKOFF_MS = Number(process.env.OUTBOX_RELAY_IDLE_BACKOFF_MS ?? 2000);

let running = true;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  const publisher = createPublisher();
  console.log(`outbox relay started, poll=${POLL_MS}ms batch=${BATCH_SIZE} perOrg=${PER_ORG_CEILING}`);

  while (running) {
    try {
      const tick = await runRelayOnce({ publisher, batchSize: BATCH_SIZE, perOrgCeiling: PER_ORG_CEILING });
      if (tick.published > 0 || tick.failed > 0) {
        console.log(
          `outbox relay tick claimed=${tick.claimed} published=${tick.published} failed=${tick.failed} deferred=${tick.deferred}`,
        );
      }
      await sleep(tick.claimed === 0 ? IDLE_BACKOFF_MS : POLL_MS);
    } catch (err) {
      console.error("ALERT outbox.relay_tick_failed", err);
      await sleep(IDLE_BACKOFF_MS);
    }
  }

  await publisher.close();
  await closeRelayPool();
  console.log("outbox relay stopped");
}

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    console.log(`outbox relay received ${signal}, finishing the current tick`);
    running = false;
  });
}

main().catch((err) => {
  console.error("outbox relay failed to start", err);
  process.exit(1);
});
