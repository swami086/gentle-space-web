import type { PoolClient } from "pg";
import { scopeClause, type Scope } from "./scope-sql";
import { orgIdForWrite } from "./scope-write";
import { withTenantTransaction } from "./tx";

export const NOTIFICATION_KINDS = [
  "reminder_due",
  "enquiry_received",
  "no_contact",
  "requirement_extracted",
] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

export type Notification = {
  id: string;
  orgId: string;
  userId: string;
  kind: NotificationKind;
  enquiryId: string | null;
  title: string;
  body: string | null;
  readAt: string | null;
  createdAt: string;
};

type NotificationRow = {
  id: string;
  org_id: string;
  user_id: string;
  kind: NotificationKind;
  enquiry_id: string | null;
  title: string;
  body: string | null;
  read_at: Date | null;
  created_at: Date;
};

const COLUMNS = `id, org_id, user_id, kind, enquiry_id, title, body, read_at, created_at`;

function rowToNotification(row: NotificationRow): Notification {
  return {
    id: row.id,
    orgId: row.org_id,
    userId: row.user_id,
    kind: row.kind,
    enquiryId: row.enquiry_id,
    title: row.title,
    body: row.body,
    readAt: row.read_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
  };
}

export async function createNotification(
  scope: Scope,
  input: {
    userId: string;
    kind: NotificationKind;
    enquiryId?: string | null;
    title: string;
    body?: string | null;
  },
  client?: PoolClient,
): Promise<Notification> {
  const orgId = orgIdForWrite(scope);
  const sql = `INSERT INTO adsagent.notifications
                 (org_id, user_id, kind, enquiry_id, title, body)
               VALUES ($1, $2, $3, $4, $5, $6)
               RETURNING ${COLUMNS}`;
  const params = [
    orgId,
    input.userId,
    input.kind,
    input.enquiryId ?? null,
    input.title,
    input.body ?? null,
  ];
  if (client) {
    const { rows } = await client.query<NotificationRow>(sql, params);
    return rowToNotification(rows[0]);
  }
  return withTenantTransaction(scope, async (c) => {
    const { rows } = await c.query<NotificationRow>(sql, params);
    return rowToNotification(rows[0]);
  });
}

export async function listNotifications(
  scope: Scope,
  userId: string,
  opts: { unreadOnly?: boolean; limit?: number } = {},
): Promise<Notification[]> {
  const clause = scopeClause(scope);
  const params: unknown[] = [...clause.params, userId];
  let where = `${clause.sql} AND user_id = $${params.length}`;
  if (opts.unreadOnly) where += ` AND read_at IS NULL`;
  params.push(opts.limit ?? 50);
  const limitPlaceholder = `$${params.length}`;
  return withTenantTransaction(scope, async (c) => {
    const { rows } = await c.query<NotificationRow>(
      `SELECT ${COLUMNS} FROM adsagent.notifications
        WHERE ${where}
        ORDER BY created_at DESC
        LIMIT ${limitPlaceholder}`,
      params,
    );
    return rows.map(rowToNotification);
  });
}

/**
 * Scoped to the user as well as the org: inside one broker's office, one
 * person marking another's notification read would be wrong even though RLS
 * permits it.
 */
export async function markNotificationRead(
  scope: Scope,
  id: string,
  userId: string,
): Promise<Notification | null> {
  const clause = scopeClause(scope);
  const n = clause.params.length;
  return withTenantTransaction(scope, async (c) => {
    const { rows } = await c.query<NotificationRow>(
      `UPDATE adsagent.notifications
          SET read_at = COALESCE(read_at, now())
        WHERE ${clause.sql} AND id = $${n + 1} AND user_id = $${n + 2}
        RETURNING ${COLUMNS}`,
      [...clause.params, id, userId],
    );
    return rows[0] ? rowToNotification(rows[0]) : null;
  });
}

export async function countUnread(scope: Scope, userId: string): Promise<number> {
  const clause = scopeClause(scope);
  return withTenantTransaction(scope, async (c) => {
    const { rows } = await c.query<{ n: string }>(
      `SELECT count(*) AS n FROM adsagent.notifications
        WHERE ${clause.sql} AND user_id = $${clause.params.length + 1} AND read_at IS NULL`,
      [...clause.params, userId],
    );
    return Number(rows[0]?.n ?? 0);
  });
}
