import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { enqueueEvent, listEventsForOrg } from "../db/outbox";
import { closeTestPool, resetAllOutbox, resetOutbox, seedOrg, testPool } from "../db/test-support";
import { withTenantTransaction } from "../db/tx";
import { reconcileDeletions } from "./deletion-reconciler";
import type { PublishableMessage } from "./envelope";
import { consumeOnce } from "./idempotency";
import type { Publisher } from "./publisher";
import { closeRelayPool } from "./relay-pool";
import { runRelayOnce } from "./relay";

const pool = testPool();
let orgId: string;

/**
 * A publisher that records what reached the wire and can fail on demand. The
 * distinction that matters: `sent` is what a consumer would have seen, so a row
 * appearing there twice is at-least-once working, and a committed row never
 * appearing there at all is the gate failing.
 */
function recordingPublisher() {
  const sent: PublishableMessage[] = [];
  let failNext = false;
  let failAfterSend = false;
  const publisher: Publisher = {
    async publish(message) {
      if (failNext) throw new Error("UNAVAILABLE: transport closed");
      sent.push(message);
      if (failAfterSend) throw new Error("crashed after the message left, before the row was marked");
      return "server-id";
    },
    resume() {},
    async close() {},
  };
  return {
    publisher,
    sent,
    failEverything() {
      failNext = true;
    },
    recover() {
      failNext = false;
      failAfterSend = false;
    },
    crashAfterSending() {
      failAfterSend = true;
    },
  };
}

beforeEach(async () => {
  orgId ??= await seedOrg(pool, "gate");
  await resetAllOutbox(pool);
  await pool.query(`DELETE FROM context.deletion_propagations`);
  await pool.query(`DELETE FROM context.deletion_requests`);
  await withTenantTransaction({ kind: "org", orgId }, async (client) => {
    await client.query(`DELETE FROM context.consumed_events WHERE org_id = $1`, [orgId]);
  });
});

afterAll(async () => {
  await closeRelayPool();
  await closeTestPool();
});

async function drain(publisher: Publisher, ticks = 3): Promise<void> {
  for (let i = 0; i < ticks; i += 1) {
    const tick = await runRelayOnce({ publisher, batchSize: 100, perOrgCeiling: 100 });
    if (tick.claimed === 0) return;
  }
}

/**
 * The relay is cross-tenant by design, so it may carry other orgs' rows on the
 * same tick. Every assertion about what reached the wire filters to this test's
 * org, or it would be flaky the moment another test leaves a row behind.
 */
function sentEventIds(sent: PublishableMessage[]): string[] {
  return sent.filter((m) => m.attributes.orgId === orgId).map((m) => m.attributes.eventId);
}

describe("S5a gate: an event cannot exist without its row", () => {
  it("leaves nothing on the wire when the domain transaction fails", async () => {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS context.s5a_gate_probe (
         id UUID PRIMARY KEY DEFAULT uuidv7(),
         org_id UUID NOT NULL,
         note TEXT NOT NULL
       )`,
    );

    try {
      await expect(
        withTenantTransaction({ kind: "org", orgId }, async (client) => {
          await client.query(`INSERT INTO context.s5a_gate_probe (org_id, note) VALUES ($1, 'enquiry')`, [orgId]);
          await enqueueEvent({ kind: "org", orgId }, client, {
            topic: "enquiry.received",
            payload: { probe: "rollback" },
          });
          throw new Error("Twenty sync rejected the payload");
        }),
      ).rejects.toThrow("Twenty sync rejected the payload");

      const probes = await pool.query(`SELECT id FROM context.s5a_gate_probe WHERE org_id = $1`, [orgId]);
      expect(probes.rows).toEqual([]);

      const events = await withTenantTransaction({ kind: "org", orgId }, (client) =>
        listEventsForOrg({ kind: "org", orgId }, client),
      );
      expect(events).toEqual([]);

      const recorder = recordingPublisher();
      await drain(recorder.publisher);
      expect(sentEventIds(recorder.sent)).toEqual([]);
    } finally {
      await pool.query(`DROP TABLE IF EXISTS context.s5a_gate_probe`);
    }
  });
});

describe("S5a gate: a row cannot exist without its event", () => {
  it("still delivers a committed row after the relay crashes between commit and publish", async () => {
    const id = await withTenantTransaction({ kind: "org", orgId }, (client) =>
      enqueueEvent({ kind: "org", orgId }, client, { topic: "enquiry.received", payload: { probe: "crash" } }),
    );

    // The message reaches the wire, then publish throws before markPublished runs.
    const recorder = recordingPublisher();
    recorder.crashAfterSending();
    const first = await runRelayOnce({ publisher: recorder.publisher, batchSize: 100, perOrgCeiling: 100 });
    expect(first).toMatchObject({ claimed: 1, published: 0, failed: 1 });
    expect(sentEventIds(recorder.sent)).toEqual([id]);

    recorder.recover();
    await drain(recorder.publisher);
    expect(sentEventIds(recorder.sent)).toEqual([id, id]);
  });

  it("keeps delivering after repeated publish failures rather than dropping the row", async () => {
    const id = await withTenantTransaction({ kind: "org", orgId }, (client) =>
      enqueueEvent({ kind: "org", orgId }, client, { topic: "reminder.due", payload: { probe: "retry" } }),
    );

    const recorder = recordingPublisher();
    recorder.failEverything();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const tick = await runRelayOnce({ publisher: recorder.publisher, batchSize: 100, perOrgCeiling: 100 });
      expect(tick).toMatchObject({ claimed: 1, published: 0, failed: 1 });
    }

    recorder.recover();
    await drain(recorder.publisher);
    expect(sentEventIds(recorder.sent)).toEqual([id]);
  });
});

describe("S5a gate: redelivery is a no-op", () => {
  it("runs a consumer once no matter how many times the message arrives", async () => {
    const id = await withTenantTransaction({ kind: "org", orgId }, (client) =>
      enqueueEvent({ kind: "org", orgId }, client, { topic: "enquiry.received", payload: { probe: "idem" } }),
    );

    const recorder = recordingPublisher();
    recorder.crashAfterSending();
    await runRelayOnce({ publisher: recorder.publisher, batchSize: 100, perOrgCeiling: 100 });
    recorder.recover();
    await drain(recorder.publisher);
    const delivered = sentEventIds(recorder.sent);
    expect(delivered).toEqual([id, id]);

    let sideEffects = 0;
    for (const eventId of delivered) {
      await withTenantTransaction({ kind: "org", orgId }, (client) =>
        consumeOnce({ kind: "org", orgId }, client, "twenty-sync", eventId, async () => {
          sideEffects += 1;
        }),
      );
    }

    expect(sideEffects).toBe(1);
  });
});

describe("S5a gate: a deletion event cannot be lost", () => {
  it("recovers an erasure whose message the relay dropped permanently", async () => {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO context.deletion_requests (org_id, subject_kind, subject_ref, erase_after, respond_by)
       VALUES ($1, 'enquirer', 'enquiry-gate', current_date + 365, current_date + 90)
       RETURNING id`,
      [orgId],
    );
    const requestId = rows[0].id;
    await pool.query(
      `INSERT INTO context.deletion_propagations (request_id, store, state) VALUES ($1, 'clickhouse', 'pending')`,
      [requestId],
    );

    const first = await reconcileDeletions({ republishAfterMinutes: 10, alertAfterHours: 24 });
    expect(first.republished).toBe(1);

    await pool.query(
      `UPDATE context.outbox_events SET published_at = now()
        WHERE org_id = $1 AND topic = 'deletion.requested'`,
      [orgId],
    );
    await pool.query(
      `UPDATE context.deletion_propagations SET last_published_at = now() - interval '1 hour'
        WHERE request_id = $1`,
      [requestId],
    );

    const second = await reconcileDeletions({ republishAfterMinutes: 10, alertAfterHours: 24 });

    expect(second.republished).toBe(1);
    const events = await withTenantTransaction({ kind: "org", orgId }, (client) =>
      listEventsForOrg({ kind: "org", orgId }, client),
    );
    expect(events.filter((e) => e.topic === "deletion.requested")).toHaveLength(2);

    await pool.query(
      `UPDATE context.deletion_propagations SET state = 'erased', last_published_at = now() - interval '1 hour'
        WHERE request_id = $1`,
      [requestId],
    );
    const third = await reconcileDeletions({ republishAfterMinutes: 10, alertAfterHours: 24 });
    expect(third.republished).toBe(0);
  });
});

describe("S5a gate: tenant isolation survives a cross-tenant relay", () => {
  it("does not let one tenant read another's events even though the relay reads both", async () => {
    const otherOrg = await seedOrg(pool, "gate-other");
    await resetOutbox(pool, otherOrg);
    await withTenantTransaction({ kind: "org", orgId }, (client) =>
      enqueueEvent({ kind: "org", orgId }, client, { topic: "reminder.due", payload: { mine: true } }),
    );
    await withTenantTransaction({ kind: "org", orgId: otherOrg }, (client) =>
      enqueueEvent({ kind: "org", orgId: otherOrg }, client, { topic: "reminder.due", payload: { mine: false } }),
    );

    const mine = await withTenantTransaction({ kind: "org", orgId }, (client) =>
      listEventsForOrg({ kind: "org", orgId }, client),
    );
    expect(mine.every((row) => row.orgId === orgId)).toBe(true);
    expect(mine.some((row) => row.payload.mine === false)).toBe(false);

    const recorder = recordingPublisher();
    await drain(recorder.publisher);
    const orgsOnTheWire = new Set(recorder.sent.map((m) => m.attributes.orgId));
    expect(orgsOnTheWire.has(orgId)).toBe(true);
    expect(orgsOnTheWire.has(otherOrg)).toBe(true);
  });
});
