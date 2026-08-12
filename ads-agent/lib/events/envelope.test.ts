import { describe, expect, it } from "vitest";
import { ENVELOPE_SCHEMA_VERSION, buildEnvelope, toPublishableMessage, type OutboxRow } from "./envelope";
import { DELETION_TOPIC, OUTBOX_TOPICS, isOutboxTopic } from "./topics";

const row: OutboxRow = {
  id: "018f3c1a-0000-7000-8000-000000000001",
  orgId: "018f3c1a-0000-7000-8000-0000000000aa",
  topic: "enquiry.received",
  payload: { enquiryId: "e-1", source: "form" },
  orderingKey: "018f3c1a-0000-7000-8000-0000000000aa",
  attempts: 0,
  createdAt: "2026-08-12T04:05:06.000Z",
};

describe("topics", () => {
  it("publishes exactly the seven topics from datastore §14.2", () => {
    expect([...OUTBOX_TOPICS]).toEqual([
      "enquiry.received",
      "enquiry.activity_logged",
      "graph.tenant_stale",
      "agent.task_requested",
      "reminder.due",
      "deletion.requested",
      "portal.event",
    ]);
  });

  it("names the deletion topic, the one class where a drop is a compliance breach", () => {
    expect(DELETION_TOPIC).toBe("deletion.requested");
  });

  it("narrows unknown strings", () => {
    expect(isOutboxTopic("enquiry.received")).toBe(true);
    expect(isOutboxTopic("enquiry.invented")).toBe(false);
  });
});

describe("buildEnvelope", () => {
  it("carries the outbox id as the consumer idempotency key", () => {
    expect(buildEnvelope(row)).toEqual({
      eventId: row.id,
      orgId: row.orgId,
      topic: "enquiry.received",
      occurredAt: "2026-08-12T04:05:06.000Z",
      schemaVersion: ENVELOPE_SCHEMA_VERSION,
      payload: { enquiryId: "e-1", source: "form" },
    });
  });
});

describe("toPublishableMessage", () => {
  it("orders by org, never globally, and repeats the ids as attributes", () => {
    const message = toPublishableMessage(row);
    expect(message.topic).toBe("enquiry.received");
    expect(message.orderingKey).toBe(row.orgId);
    expect(message.attributes).toEqual({
      eventId: row.id,
      orgId: row.orgId,
      topic: "enquiry.received",
      schemaVersion: "1",
    });
    expect(JSON.parse(message.data.toString("utf8"))).toEqual(buildEnvelope(row));
  });
});
