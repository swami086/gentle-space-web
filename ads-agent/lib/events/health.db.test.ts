import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { enqueueEvent } from "../db/outbox";
import { closeTestPool, resetAllOutbox, seedOrg, testPool } from "../db/test-support";
import { withTenantTransaction } from "../db/tx";
import { healthAlerts, readOutboxHealth, type OutboxHealth } from "./health";
import { pruneOutbox } from "./prune";
import { closeRelayPool } from "./relay-pool";

const pool = testPool();
let orgId: string;

const THRESHOLDS = {
  lagSeconds: 300,
  deletionLagSeconds: 60,
  stuckCount: 1,
  deadTuples: 100_000,
};

beforeEach(async () => {
  orgId ??= await seedOrg(pool, "health");
  await resetAllOutbox(pool);
});

afterAll(async () => {
  await closeRelayPool();
  await closeTestPool();
});

describe("readOutboxHealth", () => {
  it("counts unpublished rows and separates the deletion class", async () => {
    await withTenantTransaction({ kind: "org", orgId }, async (client) => {
      await enqueueEvent({ kind: "org", orgId }, client, { topic: "reminder.due", payload: {} });
      await enqueueEvent({ kind: "org", orgId }, client, {
        topic: "deletion.requested",
        payload: { requestId: "r-1", store: "graph" },
      });
    });

    const health = await readOutboxHealth();

    expect(health.unpublishedCount).toBeGreaterThanOrEqual(2);
    expect(health.unpublishedDeletionCount).toBeGreaterThanOrEqual(1);
    expect(health.oldestUnpublishedSeconds).toBeGreaterThanOrEqual(0);
  });
});

describe("healthAlerts", () => {
  const base: OutboxHealth = {
    unpublishedCount: 0,
    oldestUnpublishedSeconds: 0,
    unpublishedDeletionCount: 0,
    oldestUnpublishedDeletionSeconds: 0,
    stuckCount: 0,
    deadTuples: 0,
  };

  it("is silent when every signal is inside its threshold", () => {
    expect(healthAlerts(base, THRESHOLDS)).toEqual([]);
  });

  it("alerts on relay lag", () => {
    const alerts = healthAlerts({ ...base, oldestUnpublishedSeconds: 400 }, THRESHOLDS);
    expect(alerts).toEqual(["ALERT outbox.relay_lag seconds=400 threshold=300"]);
  });

  it("alerts on deletion lag with a tighter threshold and its own name", () => {
    const alerts = healthAlerts(
      { ...base, unpublishedDeletionCount: 1, oldestUnpublishedDeletionSeconds: 90 },
      THRESHOLDS,
    );
    expect(alerts).toEqual(["ALERT outbox.deletion_lag seconds=90 threshold=60 count=1"]);
  });

  it("alerts on rows the relay keeps failing to publish", () => {
    expect(healthAlerts({ ...base, stuckCount: 3 }, THRESHOLDS)).toEqual([
      "ALERT outbox.stuck_events count=3 threshold=1",
    ]);
  });

  it("alerts on table bloat, the known cost of a queue in Postgres", () => {
    expect(healthAlerts({ ...base, deadTuples: 200_000 }, THRESHOLDS)).toEqual([
      "ALERT outbox.bloat deadTuples=200000 threshold=100000",
    ]);
  });
});

describe("pruneOutbox", () => {
  it("deletes published rows past the retention window and leaves unpublished ones", async () => {
    const keptId = await withTenantTransaction({ kind: "org", orgId }, (client) =>
      enqueueEvent({ kind: "org", orgId }, client, { topic: "reminder.due", payload: { keep: true } }),
    );
    const prunedId = await withTenantTransaction({ kind: "org", orgId }, (client) =>
      enqueueEvent({ kind: "org", orgId }, client, { topic: "reminder.due", payload: { keep: false } }),
    );
    await pool.query(
      `UPDATE context.outbox_events SET published_at = now() - interval '40 days' WHERE id = $1`,
      [prunedId],
    );

    const result = await pruneOutbox(30);

    expect(result.deleted).toBeGreaterThanOrEqual(1);
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM context.outbox_events WHERE id = ANY($1::uuid[])`,
      [[keptId, prunedId]],
    );
    expect(rows.map((r) => r.id)).toEqual([keptId]);
  });
});
