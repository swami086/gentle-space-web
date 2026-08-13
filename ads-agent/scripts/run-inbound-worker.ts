/**
 * Claims pending inbound_events and processes match, media, and message writes.
 * `npm run worker:inbound` — not gated on cron_settings.enabled.
 */
import cron from "node-cron";
import {
  claimPendingInboundEvents,
} from "../lib/db/inbound-events";
import { processInboundEvent } from "../lib/inbound/process";

export const DEFAULT_SCHEDULE = "*/5 * * * * *";
export const DEFAULT_BATCH = 10;

export function isWorkerEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.INBOUND_WORKER !== "0";
}

export async function runInboundWorkerTick(
  limit = DEFAULT_BATCH,
): Promise<{ claimed: number; processed: number; failed: number }> {
  const claimed = await claimPendingInboundEvents(limit);
  let processed = 0;
  let failed = 0;

  for (const event of claimed) {
    try {
      await processInboundEvent(event);
      processed++;
    } catch (err) {
      failed++;
      console.error("inbound worker: process failed", {
        inboundEventId: event.id,
        orgId: event.orgId,
        channel: event.channel,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (claimed.length > 0) {
    console.log(
      `inbound worker: claimed ${claimed.length}, processed ${processed}, failed ${failed}`,
    );
  }

  return { claimed: claimed.length, processed, failed };
}

export function startInboundWorker(env: NodeJS.ProcessEnv): void {
  if (!isWorkerEnabled(env)) {
    console.log("inbound worker: disabled (INBOUND_WORKER=0)");
    return;
  }
  const schedule = env.INBOUND_WORKER_CRON ?? DEFAULT_SCHEDULE;
  cron.schedule(schedule, () => {
    runInboundWorkerTick().catch((err) => console.error("inbound worker: tick failed", err));
  });
  console.log(`inbound worker started, schedule="${schedule}" (Ctrl+C to stop)`);
}

const isDirect =
  process.argv[1]?.endsWith("run-inbound-worker.ts") ||
  process.argv[1]?.endsWith("run-inbound-worker.js");
if (isDirect) {
  startInboundWorker(process.env);
}
