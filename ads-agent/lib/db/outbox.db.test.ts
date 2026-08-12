import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { claimUnpublished, enqueueEvent, listEventsForOrg, markFailed, markPublished } from "./outbox";
import { closeTestPool, resetAllOutbox, resetOutbox, seedOrg, testPool } from "./test-support";
import { withTenantTransaction } from "./tx";

const pool = testPool();
let orgA: string;
let orgB: string;

let relay: Pool | null = null;

// Task 7 introduces lib/events/relay-pool.ts for this. Until then the platform-
// scoped assertions below use their own pool: what they test is the SQL, not
// role privileges, and OUTBOX_RELAY_DATABASE_URL is honoured when it is set.
function relayPool(): Pool {
  relay ??= new Pool({
    connectionString: process.env.OUTBOX_RELAY_DATABASE_URL ?? process.env.TEST_DATABASE_URL,
    max: 1,
  });
  return relay;
}

beforeEach(async () => {
  await resetAllOutbox(pool);
  orgA ??= await seedOrg(pool, "outbox-a");
  orgB ??= await seedOrg(pool, "outbox-b");
  await resetOutbox(pool, orgA);
  await resetOutbox(pool, orgB);
});

afterAll(async () => {
  if (relay) await relay.end();
  await closeTestPool();
});

describe("enqueueEvent", () => {
  it("writes a row whose ordering key is the org id", async () => {
    const id = await withTenantTransaction({ kind: "org", orgId: orgA }, (client) =>
      enqueueEvent({ kind: "org", orgId: orgA }, client, {
        topic: "enquiry.received",
        payload: { enquiryId: "e-1" },
      }),
    );

    const rows = await withTenantTransaction({ kind: "org", orgId: orgA }, (client) =>
      listEventsForOrg({ kind: "org", orgId: orgA }, client),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(id);
    expect(rows[0].orderingKey).toBe(orgA);
    expect(rows[0].topic).toBe("enquiry.received");
    expect(rows[0].payload).toEqual({ enquiryId: "e-1" });
    expect(rows[0].attempts).toBe(0);
  });

  it("refuses platform scope, because every event belongs to a tenant", async () => {
    await expect(
      withTenantTransaction({ kind: "platform", orgId: orgA }, (client) =>
        enqueueEvent({ kind: "platform", orgId: orgA }, client, {
          topic: "enquiry.received",
          payload: {},
        }),
      ),
    ).rejects.toThrow("enqueueEvent requires org scope");
  });
});

describe("claimUnpublished", () => {
  it("returns every tenant's unpublished rows oldest first under platform scope", async () => {
    await withTenantTransaction({ kind: "org", orgId: orgA }, (client) =>
      enqueueEvent({ kind: "org", orgId: orgA }, client, { topic: "reminder.due", payload: { n: 1 } }),
    );
    await withTenantTransaction({ kind: "org", orgId: orgB }, (client) =>
      enqueueEvent({ kind: "org", orgId: orgB }, client, { topic: "reminder.due", payload: { n: 2 } }),
    );

    const claimed = await withTenantTransaction(
      { kind: "platform", orgId: orgA },
      (client) => claimUnpublished({ kind: "platform", orgId: orgA }, client, 10),
      relayPool(),
    );
    const orgs = claimed.map((row) => row.orgId);
    expect(orgs).toContain(orgA);
    expect(orgs).toContain(orgB);
    expect(claimed.map((row) => row.payload.n)).toEqual([1, 2]);
  });

  it("refuses org scope, because the relay publishes every tenant's events", async () => {
    await expect(
      withTenantTransaction({ kind: "org", orgId: orgA }, (client) =>
        claimUnpublished({ kind: "org", orgId: orgA }, client, 10),
      ),
    ).rejects.toThrow("claimUnpublished is platform-scoped");
  });
});

describe("markPublished / markFailed", () => {
  it("stamps published_at and increments attempts with the error text", async () => {
    const published = await withTenantTransaction({ kind: "org", orgId: orgA }, (client) =>
      enqueueEvent({ kind: "org", orgId: orgA }, client, { topic: "graph.tenant_stale", payload: {} }),
    );
    const failed = await withTenantTransaction({ kind: "org", orgId: orgA }, (client) =>
      enqueueEvent({ kind: "org", orgId: orgA }, client, { topic: "graph.tenant_stale", payload: {} }),
    );

    await withTenantTransaction(
      { kind: "platform", orgId: orgA },
      async (client) => {
        await markPublished({ kind: "platform", orgId: orgA }, client, [published]);
        await markFailed({ kind: "platform", orgId: orgA }, client, failed, "UNAVAILABLE: transport closed");
      },
      relayPool(),
    );

    const remaining = await withTenantTransaction(
      { kind: "platform", orgId: orgA },
      (client) => claimUnpublished({ kind: "platform", orgId: orgA }, client, 10),
      relayPool(),
    );
    expect(remaining.map((row) => row.id)).toEqual([failed]);
    expect(remaining[0].attempts).toBe(1);
  });
});
