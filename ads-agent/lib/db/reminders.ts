import type { PoolClient } from "pg";
import { logReminderSet } from "./enquiry-activities";
import { scopeClause, type Scope } from "./scope-sql";
import { orgIdForWrite } from "./scope-write";
import { withTenantTransaction } from "./tx";

export const REMINDER_STATES = ["pending", "fired", "done", "cancelled"] as const;
export type ReminderState = (typeof REMINDER_STATES)[number];

export type Reminder = {
  id: string;
  orgId: string;
  enquiryId: string | null;
  userId: string;
  dueAt: string;
  note: string | null;
  state: ReminderState;
  createdAt: string;
};

type ReminderRow = {
  id: string;
  org_id: string;
  enquiry_id: string | null;
  user_id: string;
  due_at: Date;
  note: string | null;
  state: ReminderState;
  created_at: Date;
};

const COLUMNS = `id, org_id, enquiry_id, user_id, due_at, note, state, created_at`;

function rowToReminder(row: ReminderRow): Reminder {
  return {
    id: row.id,
    orgId: row.org_id,
    enquiryId: row.enquiry_id,
    userId: row.user_id,
    dueAt: row.due_at.toISOString(),
    note: row.note,
    state: row.state,
    createdAt: row.created_at.toISOString(),
  };
}

export async function createReminder(
  scope: Scope,
  input: { enquiryId: string | null; userId: string; dueAt: string; note?: string | null },
): Promise<Reminder> {
  const orgId = orgIdForWrite(scope);
  const due = Date.parse(input.dueAt);
  if (Number.isNaN(due)) throw new Error("createReminder: dueAt must be an ISO timestamp");
  if (due <= Date.now()) throw new Error("createReminder: dueAt must be in the future");

  const reminder = await withTenantTransaction(scope, async (c) => {
    const { rows } = await c.query<ReminderRow>(
      `INSERT INTO adsagent.reminders (org_id, enquiry_id, user_id, due_at, note)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${COLUMNS}`,
      [orgId, input.enquiryId, input.userId, input.dueAt, input.note ?? null],
    );
    return rowToReminder(rows[0]);
  });

  // A reminder about an enquiry is part of that enquiry's history, so the
  // timeline shows it. A standalone reminder has no timeline to join.
  if (input.enquiryId) {
    await logReminderSet(scope, {
      enquiryId: input.enquiryId,
      actorUserId: input.userId,
      body: `Reminder set for ${input.dueAt}`,
    });
  }
  return reminder;
}

export async function listPendingReminders(
  scope: Scope,
  opts: { userId?: string; dueBefore?: string } = {},
): Promise<Reminder[]> {
  const clause = scopeClause(scope);
  const params: unknown[] = [...clause.params];
  let where = `${clause.sql} AND state = 'pending'`;
  if (opts.userId) {
    params.push(opts.userId);
    where += ` AND user_id = $${params.length}`;
  }
  if (opts.dueBefore) {
    params.push(opts.dueBefore);
    where += ` AND due_at <= $${params.length}`;
  }
  return withTenantTransaction(scope, async (c) => {
    const { rows } = await c.query<ReminderRow>(
      `SELECT ${COLUMNS} FROM adsagent.reminders WHERE ${where} ORDER BY due_at`,
      params,
    );
    return rows.map(rowToReminder);
  });
}

export async function setReminderState(
  scope: Scope,
  id: string,
  state: ReminderState,
): Promise<Reminder | null> {
  if (!REMINDER_STATES.includes(state)) {
    throw new Error(`setReminderState: state must be one of ${REMINDER_STATES.join(", ")}`);
  }
  const clause = scopeClause(scope);
  const n = clause.params.length;
  return withTenantTransaction(scope, async (c) => {
    const { rows } = await c.query<ReminderRow>(
      `UPDATE adsagent.reminders
          SET state = $${n + 1},
              fired_at = CASE WHEN $${n + 1} = 'fired' THEN now() ELSE fired_at END
        WHERE ${clause.sql} AND id = $${n + 2}
        RETURNING ${COLUMNS}`,
      [...clause.params, state, id],
    );
    return rows[0] ? rowToReminder(rows[0]) : null;
  });
}

/** Cross-tenant claim for the scheduler. Called inside withCrossTenantRead. */
export async function claimDueReminders(
  client: PoolClient,
  now: string,
  limit: number,
): Promise<Reminder[]> {
  const { rows } = await client.query<ReminderRow>(
    `SELECT ${COLUMNS} FROM adsagent.reminders
      WHERE state = 'pending' AND due_at <= $1
      ORDER BY due_at
      LIMIT $2
        FOR UPDATE SKIP LOCKED`,
    [now, limit],
  );
  return rows.map(rowToReminder);
}
