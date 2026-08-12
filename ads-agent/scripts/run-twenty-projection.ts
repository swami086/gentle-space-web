/**
 * Drains the Twenty projection backlog on a schedule — `npm run worker:projection`.
 *
 * This is the interim mechanism for tenancy spec §7. At S5a it becomes an
 * outbox consumer: replace the two calls below with subscriptions on
 * `enquiry.received` and `enquiry.activity_logged`. Nothing else changes,
 * because projectPendingContacts and projectPendingActivities keep their
 * signatures.
 */
import cron from "node-cron";
import { projectPendingActivities, projectPendingContacts } from "../lib/crm/twenty-projection";

const SCHEDULE = process.env.TWENTY_PROJECTION_SCHEDULE ?? "*/2 * * * *";

async function tick(): Promise<void> {
  const contacts = await projectPendingContacts(50);
  const activities = await projectPendingActivities(50);
  if (contacts.attempted + activities.attempted === 0) return;
  console.log(
    `twenty projection: contacts ${contacts.succeeded}/${contacts.attempted}, ` +
      `activities ${activities.succeeded}/${activities.attempted}`,
  );
}

cron.schedule(SCHEDULE, () => {
  tick().catch((err) => console.error("twenty projection: tick failed", err));
});

console.log(`twenty projection worker started, schedule="${SCHEDULE}" (Ctrl+C to stop)`);
