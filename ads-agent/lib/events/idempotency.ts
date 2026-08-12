import type { PoolClient } from "pg";
import type { Scope } from "../db/scope-sql";

/**
 * At-least-once delivery made safe (datastore spec §14.3).
 *
 * The marker insert and the handler share the caller's transaction, so either
 * both stick or neither does: a handler that throws leaves no marker and the
 * redelivery runs for real. `consumer` is part of the key because §14.2 fans
 * one event out to up to five consumers, each of which must see it once.
 */
export async function consumeOnce(
  scope: Scope,
  client: PoolClient,
  consumer: string,
  eventId: string,
  handler: (client: PoolClient) => Promise<void>,
): Promise<{ skipped: boolean }> {
  if (scope.kind !== "org") {
    throw new Error("consumeOnce requires org scope: every event belongs to exactly one tenant");
  }
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO context.consumed_events (org_id, consumer, event_id)
     VALUES ($1, $2, $3)
     ON CONFLICT ON CONSTRAINT consumed_events_once DO NOTHING
     RETURNING id`,
    [scope.orgId, consumer, eventId],
  );
  if (rows.length === 0) return { skipped: true };
  await handler(client);
  return { skipped: false };
}
