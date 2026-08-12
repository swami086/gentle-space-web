import type { PoolClient } from "pg";
import { scopeClause, type Scope } from "./scope-sql";
import { orgIdForWrite } from "./scope-write";
import { withTenantTransaction } from "./tx";

export const CALL_OUTCOMES = [
  "spoke_interested",
  "spoke_not_interested",
  "no_answer",
  "voicemail",
  "wrong_number",
  "callback_requested",
] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];

export type ActivityKind = "call" | "note" | "state_change" | "reminder_set";

export type EnquiryActivity = {
  id: string;
  orgId: string;
  enquiryId: string;
  kind: ActivityKind;
  actorUserId: string | null;
  callOutcome: CallOutcome | null;
  callDirection: "outgoing" | "incoming" | null;
  callSeconds: number | null;
  occurredAt: string;
  body: string | null;
  syncedToTwentyAt: string | null;
};

export type LogCallInput = {
  enquiryId: string;
  actorUserId: string;
  outcome: CallOutcome;
  direction: "outgoing" | "incoming";
  seconds: number;
  occurredAt: string;
  body?: string | null;
};

type ActivityRow = {
  id: string;
  org_id: string;
  enquiry_id: string;
  kind: ActivityKind;
  actor_user_id: string | null;
  call_outcome: CallOutcome | null;
  call_direction: "outgoing" | "incoming" | null;
  call_seconds: number | null;
  occurred_at: Date;
  body: string | null;
  synced_to_twenty_at: Date | null;
};

const COLUMNS = `id, org_id, enquiry_id, kind, actor_user_id, call_outcome,
                 call_direction, call_seconds, occurred_at, body, synced_to_twenty_at`;

const INSERT = `INSERT INTO adsagent.enquiry_activities
  (org_id, enquiry_id, kind, actor_user_id, call_outcome, call_direction,
   call_seconds, occurred_at, body)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
  RETURNING ${COLUMNS}`;

function rowToActivity(row: ActivityRow): EnquiryActivity {
  return {
    id: row.id,
    orgId: row.org_id,
    enquiryId: row.enquiry_id,
    kind: row.kind,
    actorUserId: row.actor_user_id,
    callOutcome: row.call_outcome,
    callDirection: row.call_direction,
    callSeconds: row.call_seconds,
    occurredAt: row.occurred_at.toISOString(),
    body: row.body,
    syncedToTwentyAt: row.synced_to_twenty_at?.toISOString() ?? null,
  };
}

export async function logCall(scope: Scope, input: LogCallInput): Promise<EnquiryActivity> {
  const orgId = orgIdForWrite(scope);
  if (!Number.isInteger(input.seconds) || input.seconds < 0) {
    throw new Error("logCall: seconds must be zero or greater and a whole number");
  }
  if (!CALL_OUTCOMES.includes(input.outcome)) {
    throw new Error(`logCall: unknown outcome ${input.outcome}`);
  }
  return withTenantTransaction(scope, async (c) => {
    const { rows } = await c.query<ActivityRow>(INSERT, [
      orgId,
      input.enquiryId,
      "call",
      input.actorUserId,
      input.outcome,
      input.direction,
      input.seconds,
      input.occurredAt,
      input.body ?? null,
    ]);
    await c.query(
      `UPDATE adsagent.enquiries
          SET last_activity_at = now(), updated_at = now()
        WHERE org_id = $1 AND id = $2`,
      [orgId, input.enquiryId],
    );
    return rowToActivity(rows[0]);
  });
}

export async function addNote(
  scope: Scope,
  input: { enquiryId: string; actorUserId: string; body: string; occurredAt?: string },
): Promise<EnquiryActivity> {
  const orgId = orgIdForWrite(scope);
  return withTenantTransaction(scope, async (c) => {
    const { rows } = await c.query<ActivityRow>(INSERT, [
      orgId,
      input.enquiryId,
      "note",
      input.actorUserId,
      null,
      null,
      null,
      input.occurredAt ?? new Date().toISOString(),
      input.body,
    ]);
    await c.query(
      `UPDATE adsagent.enquiries
          SET last_activity_at = now(), updated_at = now()
        WHERE org_id = $1 AND id = $2`,
      [orgId, input.enquiryId],
    );
    return rowToActivity(rows[0]);
  });
}

export async function logStateChange(
  scope: Scope,
  input: { enquiryId: string; actorUserId: string; body: string },
): Promise<EnquiryActivity> {
  const orgId = orgIdForWrite(scope);
  return withTenantTransaction(scope, async (c) => {
    const { rows } = await c.query<ActivityRow>(INSERT, [
      orgId,
      input.enquiryId,
      "state_change",
      input.actorUserId,
      null,
      null,
      null,
      new Date().toISOString(),
      input.body,
    ]);
    return rowToActivity(rows[0]);
  });
}

export async function logReminderSet(
  scope: Scope,
  input: { enquiryId: string; actorUserId: string; body: string },
): Promise<EnquiryActivity> {
  const orgId = orgIdForWrite(scope);
  return withTenantTransaction(scope, async (c) => {
    const { rows } = await c.query<ActivityRow>(INSERT, [
      orgId,
      input.enquiryId,
      "reminder_set",
      input.actorUserId,
      null,
      null,
      null,
      new Date().toISOString(),
      input.body,
    ]);
    return rowToActivity(rows[0]);
  });
}

export async function listActivities(
  scope: Scope,
  enquiryId: string,
  limit = 200,
): Promise<EnquiryActivity[]> {
  const clause = scopeClause(scope);
  const n = clause.params.length;
  return withTenantTransaction(scope, async (c) => {
    const { rows } = await c.query<ActivityRow>(
      `SELECT ${COLUMNS} FROM adsagent.enquiry_activities
        WHERE ${clause.sql} AND enquiry_id = $${n + 1}
        ORDER BY occurred_at DESC
        LIMIT $${n + 2}`,
      [...clause.params, enquiryId, limit],
    );
    return rows.map(rowToActivity);
  });
}

export type UnsyncedActivity = {
  id: string;
  orgId: string;
  enquiryId: string;
  twentyOpportunityId: string;
  kind: ActivityKind;
  body: string | null;
  callOutcome: CallOutcome | null;
  callSeconds: number | null;
  occurredAt: string;
};

export async function claimUnsyncedActivities(
  client: PoolClient,
  limit: number,
): Promise<UnsyncedActivity[]> {
  const { rows } = await client.query<{
    id: string;
    org_id: string;
    enquiry_id: string;
    twenty_opportunity_id: string;
    kind: ActivityKind;
    body: string | null;
    call_outcome: CallOutcome | null;
    call_seconds: number | null;
    occurred_at: Date;
  }>(
    `SELECT a.id, a.org_id, a.enquiry_id, e.twenty_opportunity_id,
            a.kind, a.body, a.call_outcome, a.call_seconds, a.occurred_at
       FROM adsagent.enquiry_activities a
       JOIN adsagent.enquiries e ON e.id = a.enquiry_id AND e.org_id = a.org_id
      WHERE a.synced_to_twenty_at IS NULL
        AND a.kind IN ('call','note')
        AND e.twenty_opportunity_id IS NOT NULL
        AND e.lifecycle = 'active'
      ORDER BY a.created_at
      LIMIT $1
        FOR UPDATE OF a SKIP LOCKED`,
    [limit],
  );
  return rows.map((r) => ({
    id: r.id,
    orgId: r.org_id,
    enquiryId: r.enquiry_id,
    twentyOpportunityId: r.twenty_opportunity_id,
    kind: r.kind,
    body: r.body,
    callOutcome: r.call_outcome,
    callSeconds: r.call_seconds,
    occurredAt: r.occurred_at.toISOString(),
  }));
}

export async function markActivitySynced(scope: Scope, id: string): Promise<void> {
  const clause = scopeClause(scope);
  await withTenantTransaction(scope, async (c) => {
    await c.query(
      `UPDATE adsagent.enquiry_activities
          SET synced_to_twenty_at = now()
        WHERE ${clause.sql} AND id = $${clause.params.length + 1}`,
      [...clause.params, id],
    );
  });
}
