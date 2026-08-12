import { PubSub, type Topic } from "@google-cloud/pubsub";
import type { PublishableMessage } from "./envelope";
import type { OutboxTopic } from "./topics";

/**
 * The only module in this repository permitted to import @google-cloud/pubsub.
 * `lib/events/no-direct-publish.test.ts` in the root app fails the build if any
 * other file does.
 *
 * Writers publish by inserting into context.outbox_events inside their own
 * transaction; the relay is the only caller of this module. Datastore §14.1:
 * publish through the database, never directly.
 *
 * PUBSUB_EMULATOR_HOST is honoured by the client automatically, which is why
 * every test here runs without cloud credentials.
 */
export type Publisher = {
  publish(message: PublishableMessage): Promise<string>;
  resume(topic: OutboxTopic, orderingKey: string): void;
  close(): Promise<void>;
};

export function createPublisher(): Publisher {
  if (!process.env.GOOGLE_CLOUD_PROJECT) {
    throw new Error("GOOGLE_CLOUD_PROJECT is not set");
  }
  const client = new PubSub({ projectId: process.env.GOOGLE_CLOUD_PROJECT });
  const topics = new Map<string, Topic>();

  function topicFor(name: OutboxTopic): Topic {
    const existing = topics.get(name);
    if (existing) return existing;
    // messageOrdering must be enabled on the publisher or the client throws
    // when a message carries an orderingKey.
    const topic = client.topic(name, { messageOrdering: true });
    topics.set(name, topic);
    return topic;
  }

  return {
    async publish(message) {
      return topicFor(message.topic).publishMessage({
        data: message.data,
        orderingKey: message.orderingKey,
        attributes: message.attributes,
      });
    },
    // A failed publish permanently pauses that ordering key. Without this call
    // the first transient error stops one tenant's events forever.
    resume(topic, orderingKey) {
      topicFor(topic).resumePublishing(orderingKey);
    },
    async close() {
      topics.clear();
      await client.close();
    },
  };
}
