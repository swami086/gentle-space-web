import { scopeClause, type Scope } from "./scope-sql";
import { withTenantTransaction } from "./tx";

export type DueReminder = {
  id: string;
  dueAt: string;
  note: string | null;
  enquiryId: string | null;
  contactName: string | null;
};

export type WaitingEnquiry = {
  id: string;
  contactName: string | null;
  listingUrl: string | null;
  firstSeenAt: string;
};

export type StaleEnquiry = {
  id: string;
  contactName: string | null;
  lastActivityAt: string;
  daysSince: number;
};

export type TodayFeed = {
  dueReminders: DueReminder[];
  waitingEnquiries: WaitingEnquiry[];
  noContactSince: StaleEnquiry[];
};

/**
 * "No contact since X" is a query, not a table (C6). The answer is
 * last_activity_at against an interval, and materialising it would be a cache
 * that goes stale the moment a broker makes a call. noContactDays is a
 * parameter rather than a constant because seven days is a guess and the first
 * broker will have an opinion.
 */
export async function getTodayFeed(
  scope: Scope,
  opts: { userId?: string; noContactDays?: number; now?: Date } = {},
): Promise<TodayFeed> {
  const clause = scopeClause(scope);
  const now = (opts.now ?? new Date()).toISOString();
  const noContactDays = opts.noContactDays ?? 7;

  return withTenantTransaction(scope, async (c) => {
    const reminderParams: unknown[] = [...clause.params];
    let reminderWhere = `${clause.sql} AND r.state = 'pending'`;
    if (opts.userId) {
      reminderParams.push(opts.userId);
      reminderWhere += ` AND r.user_id = $${reminderParams.length}`;
    }
    reminderParams.push(now);
    const dueReminders = await c.query<{
      id: string;
      due_at: Date;
      note: string | null;
      enquiry_id: string | null;
      contact_name: string | null;
    }>(
      `SELECT r.id, r.due_at, r.note, r.enquiry_id, e.contact_name
         FROM adsagent.reminders r
         LEFT JOIN adsagent.enquiries e ON e.id = r.enquiry_id AND e.org_id = r.org_id
        WHERE ${reminderWhere.replace(/\borg_id\b/g, "r.org_id")}
          AND r.due_at <= $${reminderParams.length}
        ORDER BY r.due_at`,
      reminderParams,
    );

    const waiting = await c.query<{
      id: string;
      contact_name: string | null;
      listing_url: string | null;
      first_seen_at: Date;
    }>(
      `SELECT id, contact_name, listing_url, first_seen_at
         FROM adsagent.enquiries
        WHERE ${clause.sql} AND lifecycle = 'active' AND reply_state = 'waiting'
        ORDER BY first_seen_at
        LIMIT 50`,
      clause.params,
    );

    const stale = await c.query<{
      id: string;
      contact_name: string | null;
      last_activity_at: Date;
      days_since: string;
    }>(
      `SELECT id, contact_name, last_activity_at,
              floor(extract(epoch FROM (now() - last_activity_at)) / 86400) AS days_since
         FROM adsagent.enquiries
        WHERE ${clause.sql}
          AND lifecycle = 'active'
          AND reply_state <> 'closed'
          AND last_activity_at < now() - ($${clause.params.length + 1}::int * interval '1 day')
        ORDER BY last_activity_at
        LIMIT 50`,
      [...clause.params, noContactDays],
    );

    return {
      dueReminders: dueReminders.rows.map((r) => ({
        id: r.id,
        dueAt: r.due_at.toISOString(),
        note: r.note,
        enquiryId: r.enquiry_id,
        contactName: r.contact_name,
      })),
      waitingEnquiries: waiting.rows.map((r) => ({
        id: r.id,
        contactName: r.contact_name,
        listingUrl: r.listing_url,
        firstSeenAt: r.first_seen_at.toISOString(),
      })),
      noContactSince: stale.rows.map((r) => ({
        id: r.id,
        contactName: r.contact_name,
        lastActivityAt: r.last_activity_at.toISOString(),
        daysSince: Number(r.days_since),
      })),
    };
  });
}
