import { withCrossTenantRead } from "../db/cross-tenant";
import { createNotification } from "../db/notifications";
import { claimDueReminders } from "../db/reminders";
import type { Scope } from "../db/scope-sql";
import { withTenantTransaction } from "../db/tx";

/**
 * Fires every reminder whose due time has passed, for every org. Idempotent by
 * construction: claimDueReminders takes FOR UPDATE SKIP LOCKED, and the
 * notification insert and the state flip commit together, so two scheduler
 * instances cannot both notify for one reminder.
 */
export async function fireDueReminders(
  now: Date = new Date(),
  limit = 200,
): Promise<{ fired: number }> {
  const due = await withCrossTenantRead("reminder-scheduler", (client) =>
    claimDueReminders(client, now.toISOString(), limit),
  );

  let fired = 0;
  for (const reminder of due) {
    const scope: Scope = { kind: "org", orgId: reminder.orgId };
    try {
      await withTenantTransaction(scope, async (client) => {
        await createNotification(
          scope,
          {
            userId: reminder.userId,
            kind: "reminder_due",
            enquiryId: reminder.enquiryId,
            title: "Reminder due",
            body: reminder.note,
          },
          client,
        );
        await client.query(
          `UPDATE adsagent.reminders SET state = 'fired', fired_at = now()
            WHERE org_id = $1 AND id = $2 AND state = 'pending'`,
          [reminder.orgId, reminder.id],
        );
      });
      fired++;
    } catch (err) {
      // One org's failure must not stall every other org's reminders. The row
      // stays pending, so the next tick retries it.
      console.error("reminder scheduler: failed to fire", {
        reminderId: reminder.id,
        orgId: reminder.orgId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { fired };
}
