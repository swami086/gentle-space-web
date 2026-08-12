import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { withTenantTransaction } from "./tx";
import type { Scope } from "./scope-sql";

const url = process.env.TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

const ORG_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

// max: 1 means the pool holds exactly one physical connection, so a second
// connect() after release() is guaranteed to hand back the same one. That is
// what makes this test a real test of the pooling hazard rather than a
// coincidence.
let pool: Pool;

beforeAll(() => {
  if (url) {
    process.env.DATABASE_URL = url;
    pool = new Pool({ connectionString: url, max: 1 });
  }
});
afterAll(async () => {
  if (pool) await pool.end();
});

suite("tenant context is transaction-local on a pooled connection", () => {
  it("does not survive COMMIT on the same physical connection", async () => {
    const first = await pool.connect();
    const firstPid = (await first.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    await first.query("BEGIN");
    await first.query("SELECT public.set_tenant($1)", [ORG_A]);
    const inside = await first.query<{ t: string | null }>("SELECT public.current_tenant() AS t");
    expect(inside.rows[0].t).toBe(ORG_A);
    await first.query("COMMIT");
    first.release();

    const second = await pool.connect();
    const secondPid = (await second.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    expect(secondPid, "pool must reuse the same backend for this test to mean anything").toBe(firstPid);
    const after = await second.query<{ t: string | null }>("SELECT public.current_tenant() AS t");
    second.release();

    expect(after.rows[0].t, "tenant leaked across requests on a reused connection").toBeNull();
  });

  it("leaks when set_config omits the transaction-local flag — the control case", async () => {
    const first = await pool.connect();
    await first.query("BEGIN");
    // Deliberately the wrong form: two arguments, session-scoped.
    await first.query("SELECT set_config('app.current_tenant_id', $1, false)", [ORG_A]);
    await first.query("COMMIT");
    first.release();

    const second = await pool.connect();
    const after = await second.query<{ t: string | null }>("SELECT public.current_tenant() AS t");
    await second.query("SELECT set_config('app.current_tenant_id', '', false)");
    second.release();

    // Proves the assertion above has teeth: with the wrong form it really does leak.
    expect(after.rows[0].t).toBe(ORG_A);
  });

  it("withTenantTransaction sets the tenant inside the transaction and clears it after", async () => {
    const scope: Scope = { kind: "org", orgId: ORG_B };
    const seen = await withTenantTransaction(scope, async (client) => {
      const { rows } = await client.query<{ t: string | null }>("SELECT public.current_tenant() AS t");
      return rows[0].t;
    });
    expect(seen).toBe(ORG_B);

    const after = await withTenantTransaction({ kind: "org", orgId: ORG_A }, async (client) => {
      const { rows } = await client.query<{ t: string | null }>("SELECT public.current_tenant() AS t");
      return rows[0].t;
    });
    expect(after, "the previous transaction's tenant must not survive").toBe(ORG_A);
  });

  it("withTenantTransaction rolls back and rethrows when the callback throws", async () => {
    await expect(
      withTenantTransaction({ kind: "org", orgId: ORG_A }, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    // The connection must be usable afterwards, i.e. not left in a failed transaction.
    const ok = await withTenantTransaction({ kind: "org", orgId: ORG_A }, async (client) => {
      const { rows } = await client.query<{ one: number }>("SELECT 1 AS one");
      return rows[0].one;
    });
    expect(ok).toBe(1);
  });

  it("platform scope raises the read flag only inside its own transaction", async () => {
    const inside = await withTenantTransaction({ kind: "platform", orgId: ORG_A }, async (client) => {
      const { rows } = await client.query<{ p: boolean }>("SELECT public.is_platform_read() AS p");
      return rows[0].p;
    });
    expect(inside).toBe(true);

    const outside = await withTenantTransaction({ kind: "org", orgId: ORG_A }, async (client) => {
      const { rows } = await client.query<{ p: boolean }>("SELECT public.is_platform_read() AS p");
      return rows[0].p;
    });
    expect(outside, "platform read flag leaked into an org-scoped transaction").toBe(false);
  });

  it("uses the pool passed as the third argument, not the app pool", async () => {
    // The local pool has max: 1, so its single physical backend has one stable
    // pid. Any connection from the app pool is a different physical connection
    // and therefore a different pid -- that is what proves the third argument is
    // honoured rather than ignored. S5a's relay passes a pool built from
    // OUTBOX_RELAY_DATABASE_URL this way.
    const direct = await pool.connect();
    const explicitPid = (await direct.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    direct.release();

    const scope: Scope = { kind: "org", orgId: ORG_B };
    const onExplicit = await withTenantTransaction(
      scope,
      async (client) => {
        const { rows } = await client.query<{ pid: number; t: string | null }>(
          "SELECT pg_backend_pid() AS pid, public.current_tenant() AS t",
        );
        return rows[0];
      },
      pool,
    );

    expect(onExplicit.pid, "callback did not run on the supplied pool").toBe(explicitPid);
    expect(onExplicit.t, "tenant was not set on the supplied pool's connection").toBe(ORG_B);

    const onDefault = await withTenantTransaction(scope, async (client) => {
      const { rows } = await client.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
      return rows[0].pid;
    });

    expect(onDefault, "the app pool must not be the one the explicit call used").not.toBe(explicitPid);
  });
});
