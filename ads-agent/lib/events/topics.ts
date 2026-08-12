/**
 * The event vocabulary — datastore spec §14.2.
 *
 * This list and the outbox_events_topic_check constraint are the same list;
 * topics.db.test.ts asserts that against the live catalogue.
 *
 * These strings are used verbatim as Pub/Sub topic ids. Pub/Sub permits periods
 * in resource ids, so there is deliberately no name-mapping layer to drift.
 */
export const OUTBOX_TOPICS = [
  "enquiry.received",
  "enquiry.activity_logged",
  "graph.tenant_stale",
  "agent.task_requested",
  "reminder.due",
  "deletion.requested",
  "portal.event",
] as const;

export type OutboxTopic = (typeof OUTBOX_TOPICS)[number];

/**
 * §14.4: a lost deletion.requested message is a failed erasure obligation under
 * DPDP and GDPR — a compliance failure, not a retry. It gets its own alert and
 * its own reconciler.
 */
export const DELETION_TOPIC: OutboxTopic = "deletion.requested";

export function isOutboxTopic(value: string): value is OutboxTopic {
  return (OUTBOX_TOPICS as readonly string[]).includes(value);
}
