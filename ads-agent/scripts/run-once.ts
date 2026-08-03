/**
 * Manual single-cycle trigger for testing — `npm run cycle:run`. Ignores
 * cron_settings.enabled entirely (that toggle only gates the scheduled
 * worker in run-decision-cycle.ts).
 */
import { runDecisionCycle } from "../lib/decision-engine/cycle";
import { touchLastRunAt } from "../lib/db/settings";

async function main(): Promise<void> {
  console.log("ads-agent: running one decision cycle (manual trigger)");
  const result = await runDecisionCycle();
  await touchLastRunAt();
  console.log(`ads-agent: cycle complete, ${result.proposalsCreated} proposal(s) created`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
