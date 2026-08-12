import type { OutboxTopic } from "./topics";

export const ENVELOPE_SCHEMA_VERSION = 1;

/** One row of context.outbox_events, in application shape. */
export type OutboxRow = {
  id: string;
  orgId: string;
  topic: OutboxTopic;
  payload: Record<string, unknown>;
  orderingKey: string;
  attempts: number;
  createdAt: string;
};

export type EventEnvelope = {
  eventId: string;
  orgId: string;
  topic: OutboxTopic;
  occurredAt: string;
  schemaVersion: number;
  payload: Record<string, unknown>;
};

export type PublishableMessage = {
  topic: OutboxTopic;
  data: Buffer;
  orderingKey: string;
  attributes: Record<string, string>;
};

export function buildEnvelope(row: OutboxRow): EventEnvelope {
  return {
    eventId: row.id,
    orgId: row.orgId,
    topic: row.topic,
    occurredAt: row.createdAt,
    schemaVersion: ENVELOPE_SCHEMA_VERSION,
    payload: row.payload,
  };
}

export function toPublishableMessage(row: OutboxRow): PublishableMessage {
  const envelope = buildEnvelope(row);
  return {
    topic: row.topic,
    data: Buffer.from(JSON.stringify(envelope), "utf8"),
    // §14.3: per-tenant ordering is what matters; global ordering would
    // serialise every tenant behind every other.
    orderingKey: row.orderingKey,
    // Repeated as attributes so a consumer can de-duplicate without parsing
    // the body, and so a dead-lettered message is still attributable.
    attributes: {
      eventId: envelope.eventId,
      orgId: envelope.orgId,
      topic: envelope.topic,
      schemaVersion: String(envelope.schemaVersion),
    },
  };
}
