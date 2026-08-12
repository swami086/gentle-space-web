import type { PoolClient } from "pg";
import { getPool } from "../db/client";
import { scopeClause, type Scope } from "../db/scope-sql";

export async function linkSession(
  scope: Scope,
  input: { sessionId: string; enquiryId: string },
  client?: PoolClient,
): Promise<void> {
  if (scope.kind !== "org") throw new Error("linkSession requires org scope");
  const runner = client ?? getPool();
  await runner.query(
    `INSERT INTO context.session_links (org_id, session_id, enquiry_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (org_id, session_id, enquiry_id) DO NOTHING`,
    [scope.orgId, input.sessionId, input.enquiryId],
  );
}

export async function sessionsForEnquiry(scope: Scope, enquiryId: string): Promise<string[]> {
  const clause = scopeClause(scope, "org_id");
  const { rows } = await getPool().query<{ session_id: string }>(
    `SELECT session_id FROM context.session_links
      WHERE ${clause.sql} AND enquiry_id = $${clause.params.length + 1}::uuid
      ORDER BY session_id`,
    [...clause.params, enquiryId],
  );
  return rows.map((r) => r.session_id);
}

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Erasure for an enquirer covers their linked sessions, not just the enquiry row:
 * once a session is linked, every prior event in it is personal data retrospectively.
 * Works from either end -- an enquiry id expands to its sessions, a session id
 * expands to the enquiries it reached.
 */
export async function erasureSubjects(
  scope: Scope,
  subjectRef: string,
): Promise<{ enquiryIds: string[]; sessionIds: string[] }> {
  if (UUID_SHAPE.test(subjectRef)) {
    const sessionIds = await sessionsForEnquiry(scope, subjectRef);
    return { enquiryIds: [subjectRef], sessionIds };
  }

  const clause = scopeClause(scope, "org_id");
  const { rows } = await getPool().query<{ enquiry_id: string }>(
    `SELECT enquiry_id::text AS enquiry_id FROM context.session_links
      WHERE ${clause.sql} AND session_id = $${clause.params.length + 1}
      ORDER BY enquiry_id`,
    [...clause.params, subjectRef],
  );
  return { enquiryIds: rows.map((r) => r.enquiry_id), sessionIds: [subjectRef] };
}

/**
 * Unlinked sessions still expire: "pseudonymous" is not "exempt" while
 * re-identification remains possible.
 */
export async function unlinkedSessionsOlderThan(scope: Scope, days: number): Promise<string[]> {
  const clause = scopeClause(scope, "l.org_id");
  const { rows } = await getPool().query<{ session_id: string }>(
    `SELECT DISTINCT l.session_id
       FROM derived.portal_session_spaces l
      WHERE ${clause.sql}
        AND l.last_viewed_at < now() - make_interval(days => $${clause.params.length + 1})
        AND NOT EXISTS (
          SELECT 1 FROM context.session_links sl
           WHERE sl.org_id = l.org_id AND sl.session_id = l.session_id
        )`,
    [...clause.params, days],
  );
  return rows.map((r) => r.session_id);
}
