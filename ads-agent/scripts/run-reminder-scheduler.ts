/**
 * Fires due reminders into the notification feed — `npm run worker:reminders`.
 * Follows scripts/run-decision-cycle.ts: the schedule is env-overridable and
 * the work is idempotent, so restarting mid-tick loses nothing.
 */
import cron from "node-cron";
import { fireDueReminders } from "../lib/reminders/scheduler";

// Every minute: a reminder that fires up to six hours late is not a reminder.
const SCHEDULE = process.env.REMINDER_SCHEDULE ?? "* * * * *";

async function tick(): Promise<void> {
  const result = await fireDueReminders();
  if (result.fired > 0) console.log(`reminder scheduler: fired ${result.fired}`);
}

cron.schedule(SCHEDULE, () => {
  tick().catch((err) => console.error("reminder scheduler: tick failed", err));
});

console.log(`reminder scheduler started, schedule="${SCHEDULE}" (Ctrl+C to stop)`);
