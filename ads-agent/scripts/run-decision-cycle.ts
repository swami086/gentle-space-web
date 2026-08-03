/**
 * Standalone worker — `npm run worker`. Runs on a cron schedule; checks
 * cron_settings.enabled at every tick before doing any work, so flipping
 * the toggle off in the admin UI (Task 13) is enough to pause it without
 * restarting this process.
 */
import cron from "node-cron";
import { getCronSettings, touchLastRunAt } from "../lib/db/settings";
import { runDecisionCycle } from "../lib/decision-engine/cycle";

const SCHEDULE = process.env.CRON_SCHEDULE ?? "0 */6 * * *";

async function tick(): Promise<void> {
  const settings = await getCronSettings();
  if (!settings.enabled) {
    console.log("ads-agent worker: cron disabled, skipping tick");
    return;
  }
  console.log("ads-agent worker: running decision cycle");
  const result = await runDecisionCycle();
  await touchLastRunAt();
  console.log(`ads-agent worker: cycle complete, ${result.proposalsCreated} proposal(s) created`);
}

cron.schedule(SCHEDULE, () => {
  tick().catch((err) => console.error("ads-agent worker: tick failed", err));
});

console.log(`ads-agent worker started, schedule="${SCHEDULE}" (Ctrl+C to stop)`);
