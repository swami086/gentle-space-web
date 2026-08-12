import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { listEventsForOrg } from "../db/outbox";
import { closeTestPool, resetAllOutbox, seedOrg, testPool } from "../db/test-support";
import { withTenantTransaction } from "../db/tx";
import { reconcileDeletions } from "./deletion-reconciler";
import { closeRelayPool } from "./relay-pool";

const pool = testPool();
let orgId: string;
let requestId: string;

async function seedPendingErasure(): Promise<void> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO context.deletion_requests (org_id, subject_kind, subject_ref, erase_after, respond_by)
     VALUES ($1, 'enquirer', 'enquiry-1', current_date + 365, current_date + 90)
     RETURNING id`,
    [orgId],
  );
  requestId = rows[0].id;
  await pool.query(
    `INSERT INTO context.deletion_propagations (request_id, store, state)
     VALUES ($1, 'clickhouse', 'pending'), ($1, 'twenty', 'pending')`,
    [requestId],
  );
}

beforeEach(async () => {
  orgId ??= await seedOrg(pool, "deletion");
  // Reconciler is cross-tenant; purge the whole ledger between tests.
  await pool.query(`DELETE FROM context.deletion_propagations`);
  await pool.query(`DELETE FROM context.deletion_requests`);
  await resetAllOutbox(pool);
  await seedPendingErasure();
});

afterAll(async () => {
  await closeRelayPool();
  await closeTestPool();
});

async function deletionEvents(): Promise<Record<string, unknown>[]> {
  const rows = await withTenantTransaction({ kind: "org", orgId }, (client) =>
    listEventsForOrg({ kind: "org", orgId }, client),
  );
  return rows.filter((row) => row.topic === "deletion.requested").map((row) => row.payload);
}

describe("reconcileDeletions", () => {
  it("publishes one event per unfinished store", async () => {
    const result = await reconcileDeletions({ republishAfterMinutes: 10, alertAfterHours: 24 });

    expect(result.republished).toBe(2);
    const payloads = await deletionEvents();
    expect(payloads).toHaveLength(2);
    expect(payloads.map((p) => p.store).sort()).toEqual(["clickhouse", "twenty"]);
    expect(payloads.every((p) => p.requestId === requestId && p.subjectRef === "enquiry-1")).toBe(true);
  });

  it("does not republish again inside the threshold", async () => {
    await reconcileDeletions({ republishAfterMinutes: 10, alertAfterHours: 24 });
    const second = await reconcileDeletions({ republishAfterMinutes: 10, alertAfterHours: 24 });

    expect(second.republished).toBe(0);
    expect(await deletionEvents()).toHaveLength(2);
  });

  it("republishes a lost message once the threshold has passed", async () => {
    await reconcileDeletions({ republishAfterMinutes: 10, alertAfterHours: 24 });
    // The relay published it and the consumer never acted: state is still
    // pending. Age the ledger rather than the clock.
    await pool.query(
      `UPDATE context.deletion_propagations SET last_published_at = now() - interval '20 minutes'
        WHERE request_id = $1`,
      [requestId],
    );

    const third = await reconcileDeletions({ republishAfterMinutes: 10, alertAfterHours: 24 });

    expect(third.republished).toBe(2);
    expect(await deletionEvents()).toHaveLength(4);
  });

  it("stops republishing once a store reports erased", async () => {
    await pool.query(
      `UPDATE context.deletion_propagations SET state = 'erased' WHERE request_id = $1 AND store = 'twenty'`,
      [requestId],
    );

    const result = await reconcileDeletions({ republishAfterMinutes: 10, alertAfterHours: 24 });

    expect(result.republished).toBe(1);
    expect((await deletionEvents()).map((p) => p.store)).toEqual(["clickhouse"]);
  });

  it("reports a stalled erasure so it can be alerted on separately", async () => {
    await pool.query(
      `UPDATE context.deletion_requests SET requested_at = now() - interval '48 hours' WHERE id = $1`,
      [requestId],
    );

    const result = await reconcileDeletions({ republishAfterMinutes: 10, alertAfterHours: 24 });

    expect(result.stalled).toContain(`${requestId}:clickhouse`);
    expect(result.stalled).toContain(`${requestId}:twenty`);
  });
});
