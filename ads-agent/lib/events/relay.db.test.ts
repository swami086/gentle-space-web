import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { enqueueEvent, listEventsForOrg } from "../db/outbox";
import { closeTestPool, resetAllOutbox, resetOutbox, seedOrg, testPool } from "../db/test-support";
import { withTenantTransaction } from "../db/tx";
import type { PublishableMessage } from "./envelope";
import type { Publisher } from "./publisher";
import { closeRelayPool } from "./relay-pool";
import { runRelayOnce } from "./relay";

const pool = testPool();
let orgA: string;
let orgB: string;

function fakePublisher(behaviour: { failOn?: (m: PublishableMessage) => boolean } = {}) {
  const sent: PublishableMessage[] = [];
  const resumed: string[] = [];
  const publisher: Publisher = {
    async publish(message) {
      if (behaviour.failOn?.(message)) throw new Error("UNAVAILABLE: transport closed");
      sent.push(message);
      return "server-assigned-id";
    },
    resume(_topic, orderingKey) {
      resumed.push(orderingKey);
    },
    async close() {},
  };
  return { publisher, sent, resumed };
}

beforeEach(async () => {
  await resetAllOutbox(pool);
  await pool.query(`DELETE FROM context.access_log WHERE actor_ref = 'outbox-relay'`);
  orgA ??= await seedOrg(pool, "relay-a");
  orgB ??= await seedOrg(pool, "relay-b");
  await resetOutbox(pool, orgA);
  await resetOutbox(pool, orgB);
});

afterAll(async () => {
  await closeRelayPool();
  await closeTestPool();
});

async function enqueue(orgId: string, n: number): Promise<string> {
  return withTenantTransaction({ kind: "org", orgId }, (client) =>
    enqueueEvent({ kind: "org", orgId }, client, { topic: "enquiry.received", payload: { n } }),
  );
}

async function unpublishedIds(orgId: string): Promise<string[]> {
  const rows = await withTenantTransaction({ kind: "org", orgId }, (client) =>
    listEventsForOrg({ kind: "org", orgId }, client),
  );
  return rows.map((row) => row.id);
}

describe("runRelayOnce", () => {
  it("publishes unpublished rows and marks them published", async () => {
    const id = await enqueue(orgA, 1);
    const { publisher, sent } = fakePublisher();

    const tick = await runRelayOnce({ publisher, batchSize: 100, perOrgCeiling: 100 });

    expect(tick).toMatchObject({ claimed: 1, published: 1, failed: 0, deferred: 0 });
    expect(sent).toHaveLength(1);
    expect(sent[0].attributes.eventId).toBe(id);
    expect(sent[0].orderingKey).toBe(orgA);

    const second = await runRelayOnce({ publisher, batchSize: 100, perOrgCeiling: 100 });
    expect(second.claimed).toBe(0);
  });

  it("leaves a row unpublished when the publish fails, and resumes its ordering key", async () => {
    await enqueue(orgA, 1);
    const { publisher, sent, resumed } = fakePublisher({ failOn: () => true });

    const tick = await runRelayOnce({ publisher, batchSize: 100, perOrgCeiling: 100 });

    expect(tick).toMatchObject({ claimed: 1, published: 0, failed: 1 });
    expect(sent).toHaveLength(0);
    expect(resumed).toEqual([orgA]);

    const stillThere = await runRelayOnce({ publisher: fakePublisher().publisher, batchSize: 100, perOrgCeiling: 100 });
    expect(stillThere.claimed).toBe(1);
  });

  it("caps how many events one tenant takes from a single tick", async () => {
    await enqueue(orgA, 1);
    await enqueue(orgA, 2);
    await enqueue(orgA, 3);
    await enqueue(orgB, 4);
    const { publisher, sent } = fakePublisher();

    const tick = await runRelayOnce({ publisher, batchSize: 100, perOrgCeiling: 2 });

    expect(tick).toMatchObject({ claimed: 4, published: 3, deferred: 1 });
    expect(sent.filter((m) => m.orderingKey === orgA)).toHaveLength(2);
    expect(sent.filter((m) => m.orderingKey === orgB)).toHaveLength(1);
    expect(await unpublishedIds(orgA)).toHaveLength(3);
  });

  it("reports deletion publish failures separately from ordinary ones", async () => {
    await withTenantTransaction({ kind: "org", orgId: orgA }, (client) =>
      enqueueEvent({ kind: "org", orgId: orgA }, client, {
        topic: "deletion.requested",
        payload: { requestId: "r-1", store: "clickhouse" },
      }),
    );
    const { publisher } = fakePublisher({ failOn: () => true });

    const tick = await runRelayOnce({ publisher, batchSize: 100, perOrgCeiling: 100 });

    expect(tick.failed).toBe(1);
    expect(tick.deletionFailures).toHaveLength(1);
  });

  it("writes one cross-tenant access_log row per org per tick", async () => {
    await enqueue(orgA, 1);
    await enqueue(orgB, 2);
    const { publisher } = fakePublisher();

    await runRelayOnce({ publisher, batchSize: 100, perOrgCeiling: 100 });

    const { rows } = await pool.query<{ org_id: string; actor_kind: string; actor_ref: string; action: string }>(
      `SELECT org_id, actor_kind, actor_ref, action FROM context.access_log
        WHERE actor_ref = 'outbox-relay' AND org_id = ANY($1::uuid[]) ORDER BY org_id`,
      [[orgA, orgB].sort()],
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.actor_kind === "cross_tenant" && r.action === "outbox.publish")).toBe(true);
  });
});
