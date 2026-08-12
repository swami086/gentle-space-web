import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { closeTestPool, seedOrg, testPool } from "../db/test-support";
import { withTenantTransaction } from "../db/tx";
import { consumeOnce } from "./idempotency";

const pool = testPool();
let orgId: string;
const EVENT = "018f3c1a-0000-7000-8000-0000000000f1";

beforeEach(async () => {
  orgId ??= await seedOrg(pool, "idem");
  // UNIQUE (consumer, event_id) is global — purge the fixture event, not just this org.
  await pool.query(`DELETE FROM context.consumed_events WHERE event_id = $1`, [EVENT]);
});

afterAll(async () => {
  await closeTestPool();
});

describe("consumeOnce", () => {
  it("runs the handler the first time", async () => {
    let calls = 0;
    const result = await withTenantTransaction({ kind: "org", orgId }, (client) =>
      consumeOnce({ kind: "org", orgId }, client, "twenty-sync", EVENT, async () => {
        calls += 1;
      }),
    );
    expect(result).toEqual({ skipped: false });
    expect(calls).toBe(1);
  });

  it("makes a redelivery a no-op", async () => {
    let calls = 0;
    const handler = async () => {
      calls += 1;
    };
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await withTenantTransaction({ kind: "org", orgId }, (client) =>
        consumeOnce({ kind: "org", orgId }, client, "twenty-sync", EVENT, handler),
      );
    }
    expect(calls).toBe(1);

    const countRows = await withTenantTransaction({ kind: "org", orgId }, (client) =>
      client
        .query<{ n: string }>(`SELECT count(*)::text AS n FROM context.consumed_events WHERE event_id = $1`, [EVENT])
        .then((r) => r.rows),
    );
    expect(countRows[0].n).toBe("1");
  });

  it("does not record consumption when the handler throws, so the retry still runs", async () => {
    await expect(
      withTenantTransaction({ kind: "org", orgId }, (client) =>
        consumeOnce({ kind: "org", orgId }, client, "graph-stale", EVENT, async () => {
          throw new Error("consumer blew up");
        }),
      ),
    ).rejects.toThrow("consumer blew up");

    let calls = 0;
    await withTenantTransaction({ kind: "org", orgId }, (client) =>
      consumeOnce({ kind: "org", orgId }, client, "graph-stale", EVENT, async () => {
        calls += 1;
      }),
    );
    expect(calls).toBe(1);
  });

  it("tracks consumers independently, because fan-out means many consumers per event", async () => {
    const seen: string[] = [];
    for (const consumer of ["local-persist", "twenty-sync", "notify"]) {
      await withTenantTransaction({ kind: "org", orgId }, (client) =>
        consumeOnce({ kind: "org", orgId }, client, consumer, EVENT, async () => {
          seen.push(consumer);
        }),
      );
    }
    expect(seen).toEqual(["local-persist", "twenty-sync", "notify"]);
  });
});
