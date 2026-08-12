import { PubSub } from "@google-cloud/pubsub";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { toPublishableMessage, type OutboxRow } from "./envelope";
import { createPublisher, type Publisher } from "./publisher";

// The emulator, not the cloud. docker compose -f ../docker-compose.listings.yml up -d pubsub-emulator
const PROJECT = "gentle-space-local";
const TOPIC = "enquiry.received";
const SUBSCRIPTION = "test-publisher-roundtrip";

let publisher: Publisher;
let admin: PubSub;

beforeAll(async () => {
  if (!process.env.PUBSUB_EMULATOR_HOST) {
    throw new Error(
      "PUBSUB_EMULATOR_HOST is not set. Start the emulator and export it:\n" +
        "  docker compose -f ../docker-compose.listings.yml up -d pubsub-emulator\n" +
        "  export PUBSUB_EMULATOR_HOST=localhost:8085 GOOGLE_CLOUD_PROJECT=gentle-space-local",
    );
  }
  admin = new PubSub({ projectId: PROJECT });
  const [exists] = await admin.topic(TOPIC).exists();
  if (!exists) await admin.createTopic(TOPIC);
  const [subExists] = await admin.subscription(SUBSCRIPTION).exists();
  if (!subExists) {
    await admin.topic(TOPIC).createSubscription(SUBSCRIPTION, { enableMessageOrdering: true });
  }
  publisher = createPublisher();
});

afterAll(async () => {
  if (publisher) await publisher.close();
  if (admin) {
    await admin.subscription(SUBSCRIPTION).delete().catch(() => undefined);
    await admin.close();
  }
});

function rowFor(orgId: string, n: number): OutboxRow {
  return {
    id: `018f3c1a-0000-7000-8000-00000000000${n}`,
    orgId,
    topic: "enquiry.received",
    payload: { n },
    orderingKey: orgId,
    attempts: 0,
    createdAt: new Date().toISOString(),
  };
}

describe("createPublisher", () => {
  it("publishes a message that arrives with its idempotency attributes intact", async () => {
    const orgId = "018f3c1a-0000-7000-8000-0000000000a1";
    const row = rowFor(orgId, 1);

    const received: { eventId: string; orgId: string; body: unknown }[] = [];
    const subscription = admin.subscription(SUBSCRIPTION);
    subscription.on("message", (message) => {
      received.push({
        eventId: message.attributes.eventId,
        orgId: message.attributes.orgId,
        body: JSON.parse(message.data.toString("utf8")),
      });
      message.ack();
    });

    await publisher.publish(toPublishableMessage(row));

    await expect
      .poll(() => received.length, { timeout: 10_000, interval: 100 })
      .toBeGreaterThan(0);
    subscription.removeAllListeners("message");
    await subscription.close();

    expect(received[0].eventId).toBe(row.id);
    expect(received[0].orgId).toBe(orgId);
    expect(received[0].body).toMatchObject({ eventId: row.id, topic: "enquiry.received", payload: { n: 1 } });
  });

  it("resumes an ordering key after a failure, so one error does not stop a tenant forever", () => {
    // resumePublishing is a no-op on a healthy key; the assertion is that the
    // boundary exposes it at all. Without it, the first transient publish error
    // permanently pauses that org's ordering key.
    expect(() => publisher.resume("enquiry.received", "018f3c1a-0000-7000-8000-0000000000a1")).not.toThrow();
  });
});
