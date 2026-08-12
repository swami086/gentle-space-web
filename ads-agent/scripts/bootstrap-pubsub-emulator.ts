/**
 * Creates every topic and one subscription per topic in the Pub/Sub emulator,
 * so local development sees the same topology as production. Cloud topology is
 * infra/pubsub/create-topics.sh; this is its emulator twin.
 *
 * Run: npm run pubsub:bootstrap
 */
import { PubSub } from "@google-cloud/pubsub";
import { OUTBOX_TOPICS } from "../lib/events/topics";

async function main(): Promise<void> {
  if (!process.env.PUBSUB_EMULATOR_HOST) {
    throw new Error("PUBSUB_EMULATOR_HOST is not set — refusing to create topics against real Pub/Sub");
  }
  const client = new PubSub({ projectId: process.env.GOOGLE_CLOUD_PROJECT ?? "gentle-space-local" });
  for (const name of OUTBOX_TOPICS) {
    const topic = client.topic(name);
    const [topicExists] = await topic.exists();
    if (!topicExists) {
      await client.createTopic(name);
      console.log(`created topic ${name}`);
    }
    const subscriptionName = `${name}.local`;
    const [subExists] = await client.subscription(subscriptionName).exists();
    if (!subExists) {
      await topic.createSubscription(subscriptionName, { enableMessageOrdering: true });
      console.log(`created subscription ${subscriptionName}`);
    }
  }
  await client.close();
  console.log(`emulator ready: ${OUTBOX_TOPICS.length} topics`);
}

main().catch((err) => {
  console.error("bootstrap-pubsub-emulator failed", err);
  process.exit(1);
});
