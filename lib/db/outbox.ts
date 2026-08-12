import type { PoolClient } from "pg";
import type { Scope } from "./scope";

/**
 * The listings app's only publish path. There is no Pub/Sub client in this app
 * at all — `lib/events/no-direct-publish.test.ts` fails if one appears. The
 * relay in ads-agent publishes what this writes.
 *
 * Topic list mirrors ads-agent/lib/events/topics.ts and the CHECK constraint on
 * context.outbox_events; a value outside it is rejected by the database.
 */
export type ListingsOutboxTopic = "enquiry.received" | "enquiry.activity_logged" | "portal.event";

export type OutboxEventInput = {
  topic: ListingsOutboxTopic;
  payload: Record<string, unknown>;
};

export async function enqueueEvent(
  scope: Scope,
  client: PoolClient,
  event: OutboxEventInput,
): Promise<string> {
  if (scope.kind !== "org") {
    throw new Error("enqueueEvent requires org scope: every event belongs to exactly one tenant");
  }
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO context.outbox_events (org_id, topic, payload, ordering_key)
     VALUES ($1, $2, $3::jsonb, $4)
     RETURNING id`,
    [scope.orgId, event.topic, JSON.stringify(event.payload), scope.orgId],
  );
  return rows[0].id;
}
