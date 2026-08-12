import type { PoolClient } from "pg";
import type { OutboxRow } from "../events/envelope";
import type { OutboxTopic } from "../events/topics";
import type { Scope } from "./scope-sql";

export type OutboxEventInput = {
  topic: OutboxTopic;
  payload: Record<string, unknown>;
};

type OutboxDbRow = {
  id: string;
  org_id: string;
  topic: OutboxTopic;
  payload: Record<string, unknown>;
  ordering_key: string;
  attempts: number;
  created_at: Date;
};

function toOutboxRow(row: OutboxDbRow): OutboxRow {
  return {
    id: row.id,
    orgId: row.org_id,
    topic: row.topic,
    payload: row.payload,
    orderingKey: row.ordering_key,
    attempts: row.attempts,
    createdAt: row.created_at.toISOString(),
  };
}

const SELECT_COLUMNS = "id, org_id, topic, payload, ordering_key, attempts, created_at";

/**
 * The only way to publish. The caller supplies the client so the event lands in
 * the same transaction as the domain change — that is the whole point of the
 * outbox (datastore spec §14.1).
 */
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

/**
 * The relay's claim. FOR UPDATE SKIP LOCKED so two relay instances never
 * publish the same row, and ORDER BY created_at so a uuidv7 primary key keeps
 * these reads sequential rather than scattered.
 */
export async function claimUnpublished(
  scope: Scope,
  client: PoolClient,
  limit: number,
): Promise<OutboxRow[]> {
  if (scope.kind !== "platform") {
    throw new Error("claimUnpublished is platform-scoped: the relay publishes every tenant's events");
  }
  const { rows } = await client.query<OutboxDbRow>(
    `SELECT ${SELECT_COLUMNS}
       FROM context.outbox_events
      WHERE published_at IS NULL
      ORDER BY created_at
      LIMIT $1
        FOR UPDATE SKIP LOCKED`,
    [limit],
  );
  return rows.map(toOutboxRow);
}

export async function markPublished(scope: Scope, client: PoolClient, ids: string[]): Promise<void> {
  if (scope.kind !== "platform") {
    throw new Error("markPublished is platform-scoped: only the relay marks rows published");
  }
  if (ids.length === 0) return;
  await client.query(
    `UPDATE context.outbox_events SET published_at = now() WHERE id = ANY($1::uuid[])`,
    [ids],
  );
}

export async function markFailed(
  scope: Scope,
  client: PoolClient,
  id: string,
  error: string,
): Promise<void> {
  if (scope.kind !== "platform") {
    throw new Error("markFailed is platform-scoped: only the relay records publish failures");
  }
  await client.query(
    `UPDATE context.outbox_events
        SET attempts = attempts + 1, last_error = $2
      WHERE id = $1`,
    [id, error.slice(0, 2000)],
  );
}

/** Tenant-scoped read. RLS makes the WHERE clause a belt to the policy's braces. */
export async function listEventsForOrg(scope: Scope, client: PoolClient): Promise<OutboxRow[]> {
  if (scope.kind !== "org") {
    throw new Error("listEventsForOrg requires org scope");
  }
  const { rows } = await client.query<OutboxDbRow>(
    `SELECT ${SELECT_COLUMNS}
       FROM context.outbox_events
      WHERE org_id = $1
      ORDER BY created_at`,
    [scope.orgId],
  );
  return rows.map(toOutboxRow);
}
