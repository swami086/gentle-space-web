import type { PoolClient } from "pg";
import { scopeClause, type Scope } from "./scope-sql";
import { orgIdForWrite } from "./scope-write";
import { withTenantTransaction } from "./tx";

export const REPLY_STATES = ["waiting", "called", "closed"] as const;
export type ReplyState = (typeof REPLY_STATES)[number];

export type Enquiry = {
  id: string;
  orgId: string;
  contactId: string | null;
  twentyOpportunityId: string | null;
  listingId: string | null;
  listingUrl: string | null;
  corridorId: string | null;
  replyState: ReplyState;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  firstSeenAt: string;
  lastActivityAt: string;
  lifecycle: "active" | "suppressed" | "erased";
  createdAt: string;
};

export type NewEnquiry = {
  contactId: string | null;
  listingId?: string | null;
  listingUrl?: string | null;
  contactName: string;
  contactPhone?: string | null;
  contactEmail?: string | null;
};

type EnquiryRow = {
  id: string;
  org_id: string;
  contact_id: string | null;
  twenty_opportunity_id: string | null;
  listing_id: string | null;
  listing_url: string | null;
  corridor_id: string | null;
  reply_state: ReplyState;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  first_seen_at: Date;
  last_activity_at: Date;
  lifecycle: "active" | "suppressed" | "erased";
  created_at: Date;
};

const COLUMNS = `id, org_id, contact_id, twenty_opportunity_id, listing_id, listing_url,
                 corridor_id, reply_state, contact_name, contact_phone, contact_email,
                 first_seen_at, last_activity_at, lifecycle, created_at`;

function rowToEnquiry(row: EnquiryRow): Enquiry {
  return {
    id: row.id,
    orgId: row.org_id,
    contactId: row.contact_id,
    twentyOpportunityId: row.twenty_opportunity_id,
    listingId: row.listing_id,
    listingUrl: row.listing_url,
    corridorId: row.corridor_id,
    replyState: row.reply_state,
    contactName: row.contact_name,
    contactPhone: row.contact_phone,
    contactEmail: row.contact_email,
    firstSeenAt: row.first_seen_at.toISOString(),
    lastActivityAt: row.last_activity_at.toISOString(),
    lifecycle: row.lifecycle,
    createdAt: row.created_at.toISOString(),
  };
}

/**
 * Commits with no Twenty identifier at all. The opportunity id arrives later
 * from the projection worker, which is what makes a Twenty outage a delay in
 * enrichment rather than a lost enquiry (TW4).
 */
export async function createEnquiry(
  scope: Scope,
  input: NewEnquiry,
  client?: PoolClient,
): Promise<Enquiry> {
  const orgId = orgIdForWrite(scope);
  const sql = `INSERT INTO adsagent.enquiries
                 (org_id, contact_id, listing_id, listing_url,
                  contact_name, contact_phone, contact_email)
               VALUES ($1, $2, $3, $4, $5, $6, $7)
               RETURNING ${COLUMNS}`;
  const params = [
    orgId,
    input.contactId,
    input.listingId ?? null,
    input.listingUrl ?? null,
    input.contactName,
    input.contactPhone ?? null,
    input.contactEmail ?? null,
  ];
  if (client) {
    const { rows } = await client.query<EnquiryRow>(sql, params);
    return rowToEnquiry(rows[0]);
  }
  return withTenantTransaction(scope, async (c) => {
    const { rows } = await c.query<EnquiryRow>(sql, params);
    return rowToEnquiry(rows[0]);
  });
}

export async function listEnquiries(
  scope: Scope,
  opts: { replyState?: ReplyState; limit?: number } = {},
): Promise<Enquiry[]> {
  const clause = scopeClause(scope);
  const params: unknown[] = [...clause.params];
  let where = `${clause.sql} AND lifecycle = 'active'`;
  if (opts.replyState) {
    params.push(opts.replyState);
    where += ` AND reply_state = $${params.length}`;
  }
  params.push(opts.limit ?? 100);
  const limitPlaceholder = `$${params.length}`;
  return withTenantTransaction(scope, async (c) => {
    const { rows } = await c.query<EnquiryRow>(
      `SELECT ${COLUMNS} FROM adsagent.enquiries
        WHERE ${where}
        ORDER BY last_activity_at DESC
        LIMIT ${limitPlaceholder}`,
      params,
    );
    return rows.map(rowToEnquiry);
  });
}

export async function getEnquiryById(scope: Scope, id: string): Promise<Enquiry | null> {
  const clause = scopeClause(scope);
  return withTenantTransaction(scope, async (c) => {
    const { rows } = await c.query<EnquiryRow>(
      `SELECT ${COLUMNS} FROM adsagent.enquiries
        WHERE ${clause.sql} AND lifecycle = 'active' AND id = $${clause.params.length + 1}`,
      [...clause.params, id],
    );
    return rows[0] ? rowToEnquiry(rows[0]) : null;
  });
}

export async function setReplyState(
  scope: Scope,
  id: string,
  replyState: ReplyState,
): Promise<Enquiry | null> {
  const clause = scopeClause(scope);
  const n = clause.params.length;
  return withTenantTransaction(scope, async (c) => {
    const { rows } = await c.query<EnquiryRow>(
      `UPDATE adsagent.enquiries
          SET reply_state = $${n + 1}, last_activity_at = now(), updated_at = now()
        WHERE ${clause.sql} AND lifecycle = 'active' AND id = $${n + 2}
        RETURNING ${COLUMNS}`,
      [...clause.params, replyState, id],
    );
    return rows[0] ? rowToEnquiry(rows[0]) : null;
  });
}

export async function touchLastActivity(
  scope: Scope,
  id: string,
  client?: PoolClient,
): Promise<void> {
  const clause = scopeClause(scope);
  const sql = `UPDATE adsagent.enquiries
                  SET last_activity_at = now(), updated_at = now()
                WHERE ${clause.sql} AND id = $${clause.params.length + 1}`;
  const params = [...clause.params, id];
  if (client) {
    await client.query(sql, params);
    return;
  }
  await withTenantTransaction(scope, async (c) => {
    await c.query(sql, params);
  });
}

export async function setTwentyOpportunityId(
  scope: Scope,
  id: string,
  opportunityId: string,
): Promise<void> {
  const clause = scopeClause(scope);
  const n = clause.params.length;
  await withTenantTransaction(scope, async (c) => {
    await c.query(
      `UPDATE adsagent.enquiries
          SET twenty_opportunity_id = $${n + 1}, updated_at = now()
        WHERE ${clause.sql} AND id = $${n + 2}`,
      [...clause.params, opportunityId, id],
    );
  });
}

export async function listEnquiriesAwaitingOpportunity(
  scope: Scope,
  contactId: string,
): Promise<Enquiry[]> {
  const clause = scopeClause(scope);
  return withTenantTransaction(scope, async (c) => {
    const { rows } = await c.query<EnquiryRow>(
      `SELECT ${COLUMNS} FROM adsagent.enquiries
        WHERE ${clause.sql}
          AND lifecycle = 'active'
          AND contact_id = $${clause.params.length + 1}
          AND twenty_opportunity_id IS NULL
        ORDER BY first_seen_at`,
      [...clause.params, contactId],
    );
    return rows.map(rowToEnquiry);
  });
}

/** Backs the Enquiries badge. Always returns every state, so a zero renders. */
export async function countEnquiriesByState(scope: Scope): Promise<Record<ReplyState, number>> {
  const clause = scopeClause(scope);
  const counts: Record<ReplyState, number> = { waiting: 0, called: 0, closed: 0 };
  return withTenantTransaction(scope, async (c) => {
    const { rows } = await c.query<{ reply_state: ReplyState; n: string }>(
      `SELECT reply_state, count(*) AS n FROM adsagent.enquiries
        WHERE ${clause.sql} AND lifecycle = 'active'
        GROUP BY reply_state`,
      clause.params,
    );
    for (const row of rows) counts[row.reply_state] = Number(row.n);
    return counts;
  });
}
