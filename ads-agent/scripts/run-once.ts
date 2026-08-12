/**
 * Manual single-cycle trigger for testing — `npm run cycle:run`. Ignores
 * cron_settings.enabled entirely (that toggle only gates the scheduled
 * worker in run-decision-cycle.ts).
 */
import { scopeForJob } from "../lib/auth/scope-interim";
import { touchLastRunAt } from "../lib/db/org-settings";
import { runDecisionCycle } from "../lib/decision-engine/cycle";

const orgId = process.env.ADS_AGENT_ORG_ID;
if (!orgId) throw new Error("ADS_AGENT_ORG_ID is not set");
const scope = scopeForJob(orgId);

async function main(): Promise<void> {
  console.log("ads-agent: running one decision cycle (manual trigger)");
  const result = await runDecisionCycle();
  await touchLastRunAt(scope);
  console.log(`ads-agent: cycle complete, ${result.proposalsCreated} proposal(s) created`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
