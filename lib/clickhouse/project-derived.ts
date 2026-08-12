import type { Scope } from "../db/scope";
import { withTenantTransaction } from "../db/tx";
import { chQuery } from "./client";

type SessionSpaceRow = {
  session_id: string;
  listing_ref: string;
  view_count: string;
  dwell_seconds: string;
  last_viewed_at: string;
};

/**
 * Projects "spaces this visitor viewed" from ClickHouse into the derived quarantine.
 * Truncate-then-insert per tenant, because a derived table is rebuildable by
 * definition; an incremental merge would make it stateful and therefore a record.
 */
export async function rebuildPortalSessionSpaces(
  scope: Scope,
  options: { sinceDays?: number } = {},
): Promise<number> {
  if (scope.kind !== "org") {
    throw new Error("rebuildPortalSessionSpaces requires org scope: a projection is per tenant");
  }
  const orgId = scope.orgId;
  const sinceDays = options.sinceDays ?? 30;

  const rows = await chQuery<SessionSpaceRow>(
    `SELECT session_id,
            JSONExtractString(payload, 'listing_ref')                    AS listing_ref,
            toString(count())                                            AS view_count,
            toString(sum(JSONExtractUInt(payload, 'dwell_seconds')))      AS dwell_seconds,
            formatDateTime(max(occurred_at), '%Y-%m-%d %H:%i:%S')         AS last_viewed_at
       FROM raw.portal_events
      WHERE org_id = {org:UUID}
        AND event = 'listing_view'
        AND occurred_at >= now() - toIntervalDay({days:UInt16})
      GROUP BY session_id, listing_ref
      HAVING listing_ref != ''`,
    { params: { org: orgId, days: String(sinceDays) } },
  );

  return withTenantTransaction(scope, async (client) => {
    await client.query("DELETE FROM derived.portal_session_spaces WHERE org_id = $1", [orgId]);
    for (const row of rows) {
      await client.query(
        `INSERT INTO derived.portal_session_spaces
           (org_id, session_id, listing_ref, view_count, dwell_seconds, last_viewed_at)
         VALUES ($1, $2, $3, $4, $5, $6::timestamptz)`,
        [orgId, row.session_id, row.listing_ref, Number(row.view_count), Number(row.dwell_seconds), row.last_viewed_at],
      );
    }
    return rows.length;
  });
}
