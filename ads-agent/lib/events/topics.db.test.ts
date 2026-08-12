import { afterAll, describe, expect, it } from "vitest";
import { closeTestPool, testPool } from "../db/test-support";
import { OUTBOX_TOPICS } from "./topics";

const pool = testPool();

afterAll(async () => {
  await closeTestPool();
});

describe("topic vocabulary", () => {
  // Two lists of topics is one list too many. If someone adds a topic to the
  // CHECK constraint without adding it to OUTBOX_TOPICS, the relay silently
  // cannot publish it; the reverse fails at insert time in production.
  it("matches context.outbox_events.topic's CHECK constraint exactly", async () => {
    const { rows } = await pool.query<{ definition: string }>(
      `SELECT pg_get_constraintdef(oid) AS definition
         FROM pg_constraint
        WHERE conname = 'outbox_events_topic_check'
          AND conrelid = 'context.outbox_events'::regclass`,
    );
    expect(rows).toHaveLength(1);
    const inConstraint = [...rows[0].definition.matchAll(/'([a-z_]+\.[a-z_]+)'/g)].map((m) => m[1]);
    expect([...inConstraint].sort()).toEqual([...OUTBOX_TOPICS].sort());
  });
});
