// ads-agent/mcp/context-server/read-enquiries.ts
import { z } from "zod";
import { withAgentTenantTx } from "./db";
import type { TaskTokenClaims } from "./task-token";

export const REPLY_STATES = ["waiting", "called", "closed"] as const;
export type ReplyState = (typeof REPLY_STATES)[number];

export type EnquirySummary = {
  id: string;
  contactName: string | null;
  replyState: ReplyState;
  corridorId: string | null;
  listingId: string | null;
  firstSeenAt: string;
  lastActivityAt: string;
};

export type EnquiryActivity = {
  id: string;
  kind: string;
  occurredAt: string;
  summary: string | null;
};

export type EnquiryDetail = EnquirySummary & {
  activity: EnquiryActivity[];
  signals: string[];
};

const MAX_LIMIT = 100;
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

export const listEnquiriesInput = z.strictObject({
  status: z.enum(REPLY_STATES).optional(),
  since: z.string().datetime().optional(),
  limit: z.number().int().min(1).default(25).transform((n) => Math.min(n, MAX_LIMIT)),
});

type EnquiryRow = {
  id: string;
  contact_name: string | null;
  reply_state: ReplyState;
  corridor_id: string | null;
  listing_id: string | null;
  first_seen_at: Date;
  last_activity_at: Date;
};

function toSummary(row: EnquiryRow): EnquirySummary {
  return {
    id: row.id,
    contactName: row.contact_name,
    replyState: row.reply_state,
    corridorId: row.corridor_id,
    listingId: row.listing_id,
    firstSeenAt: row.first_seen_at.toISOString(),
    lastActivityAt: row.last_activity_at.toISOString(),
  };
}

export async function listEnquiries(
  claims: TaskTokenClaims,
  input: z.input<typeof listEnquiriesInput>,
): Promise<EnquirySummary[]> {
  const { status, since, limit } = listEnquiriesInput.parse(input);
  return withAgentTenantTx(claims.orgId, async (tx) => {
    const { rows } = await tx.query<EnquiryRow>(
      `SELECT id, contact_name, reply_state, corridor_id, listing_id,
              first_seen_at, last_activity_at
         FROM context.v_agent_enquiries
        WHERE ($1::text IS NULL OR reply_state = $1)
          AND ($2::timestamptz IS NULL OR last_activity_at >= $2)
        ORDER BY last_activity_at DESC
        LIMIT $3`,
      [status ?? null, since ?? null, limit],
    );
    return rows.map(toSummary);
  });
}

/**
 * Derived signals, the thing the `leads` profile actually reads for ("asked
 * about pricing twice"). Counting repeated activity kinds is the whole rule.
 *
 * ponytail: counts activity kinds only, so it cannot notice a signal that needs
 * message content. Ceiling: no cross-enquiry or temporal reasoning. Upgrade
 * path: derive signals in the graph at S8 and read them through graph_query,
 * which keeps the derivation testable in one place instead of here.
 */
function deriveSignals(activity: EnquiryActivity[]): string[] {
  const counts = new Map<string, number>();
  for (const a of activity) counts.set(a.kind, (counts.get(a.kind) ?? 0) + 1);
  return [...counts.entries()]
    .filter(([, n]) => n > 1)
    .map(([kind, n]) => `${kind} x${n}`)
    .sort();
}

export async function getEnquiry(
  claims: TaskTokenClaims,
  enquiryId: string,
): Promise<EnquiryDetail | null> {
  if (!uuid.safeParse(enquiryId).success) throw new Error("invalid_enquiry_id");
  return withAgentTenantTx(claims.orgId, async (tx) => {
    // The view embeds org_id = public.current_tenant(), so another tenant's id
    // simply yields no row. Not-found and wrong-tenant are the same answer on
    // purpose: a 403 would confirm the row exists.
    const { rows } = await tx.query<EnquiryRow>(
      `SELECT id, contact_name, reply_state, corridor_id, listing_id,
              first_seen_at, last_activity_at
         FROM context.v_agent_enquiries WHERE id = $1`,
      [enquiryId],
    );
    if (!rows[0]) return null;

    const { rows: activityRows } = await tx.query<{
      id: string;
      kind: string;
      occurred_at: Date;
      summary: string | null;
    }>(
      `SELECT id, kind, occurred_at, summary
         FROM context.v_agent_enquiry_activity
        WHERE enquiry_id = $1
        ORDER BY occurred_at ASC
        LIMIT $2`,
      [enquiryId, MAX_LIMIT],
    );
    const activity: EnquiryActivity[] = activityRows.map((a) => ({
      id: a.id,
      kind: a.kind,
      occurredAt: a.occurred_at.toISOString(),
      summary: a.summary,
    }));
    return { ...toSummary(rows[0]), activity, signals: deriveSignals(activity) };
  });
}
