/**
 * Datastore §12.2: "a bulk listings sync marks every tenant stale at once and
 * stampedes." This proves it does not. Live Postgres.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { getPool } from "../db/client";
import { claimRebuild, finishRebuild, markTenantStale, REBUILD_CEILING } from "./backpressure";

if (!process.env.DATABASE_URL) {
  throw new Error("backpressure.storm.test.ts requires DATABASE_URL");
}

const pool = getPool();
const ORGS = Array.from({ length: 50 }, () => randomUUID());

async function resetSlotsAndManifests(): Promise<void> {
  await pool.query(`UPDATE context.rebuild_slots SET org_id = NULL, leased_until = NULL`);
  await pool.query(`DELETE FROM context.graph_manifests WHERE org_id = ANY($1::uuid[])`, [ORGS]);
}

beforeAll(async () => {
  for (const orgId of ORGS) {
    await pool.query(
      `INSERT INTO public.orgs (id, name, kind, slug)
       VALUES ($1, $2, 'external', $3)
       ON CONFLICT (id) DO NOTHING`,
      [orgId, `storm-${orgId.slice(0, 8)}`, `storm-${orgId.slice(0, 8)}`],
    );
  }
});

afterAll(async () => {
  await resetSlotsAndManifests();
  await pool.query(`DELETE FROM context.outbox_events WHERE org_id = ANY($1::uuid[])`, [ORGS]);
  await pool.query(`DELETE FROM public.orgs WHERE id = ANY($1::uuid[])`, [ORGS]);
});

describe("a rebuild storm stays bounded", () => {
  it("never has more than the ceiling building at once, under 8 concurrent workers", async () => {
    await resetSlotsAndManifests();
    for (const orgId of ORGS) {
      await pool.query("SELECT public.set_tenant($1)", [orgId]);
      await markTenantStale({ kind: "org", orgId }, { byUser: false });
    }
    // Make every tenant eligible: the debounce is 300 s and the test will not wait.
    await pool.query(
      `UPDATE context.graph_manifests SET stale_since = now() - interval '1 hour'
        WHERE org_id = ANY($1::uuid[])`,
      [ORGS],
    );

    let peak = 0;
    const worker = async () => {
      for (let i = 0; i < 12; i++) {
        const claim = await claimRebuild();
        if (!claim) return;
        const { rows } = await pool.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM context.graph_manifests WHERE status = 'building'`,
        );
        peak = Math.max(peak, Number(rows[0].n));
        await finishRebuild(claim, { sourceWatermark: new Date(), cdcLagSeconds: 0 });
      }
    };

    await Promise.all(Array.from({ length: 8 }, worker));

    expect(REBUILD_CEILING).toBe(2);
    expect(peak).toBeGreaterThan(0);
    expect(peak).toBeLessThanOrEqual(REBUILD_CEILING);
  });

  it("does not claim a tenant inside the debounce window", async () => {
    await resetSlotsAndManifests();
    const fresh = ORGS[0];
    await pool.query("SELECT public.set_tenant($1)", [fresh]);
    await markTenantStale({ kind: "org", orgId: fresh }, { byUser: true });

    await expect(claimRebuild()).resolves.toBeNull();
  });

  it("coalesces repeated stale marks into one debounce clock", async () => {
    await resetSlotsAndManifests();
    const orgId = ORGS[1];
    await pool.query("SELECT public.set_tenant($1)", [orgId]);
    await markTenantStale({ kind: "org", orgId }, { byUser: false });
    const first = await pool.query<{ stale_since: Date }>(
      `SELECT stale_since FROM context.graph_manifests WHERE org_id = $1`,
      [orgId],
    );

    for (let i = 0; i < 5; i++) {
      await markTenantStale({ kind: "org", orgId }, { byUser: false });
    }
    const after = await pool.query<{ stale_since: Date }>(
      `SELECT stale_since FROM context.graph_manifests WHERE org_id = $1`,
      [orgId],
    );

    // Refreshing the clock on every mark would mean a bulk import never becomes
    // eligible at all.
    expect(after.rows[0].stale_since.getTime()).toBe(first.rows[0].stale_since.getTime());
  });

  it("builds a tenant with recent user activity before an older idle one", async () => {
    await resetSlotsAndManifests();
    const idle = ORGS[2];
    const active = ORGS[3];
    for (const [orgId, byUser] of [
      [idle, false],
      [active, true],
    ] as const) {
      await pool.query("SELECT public.set_tenant($1)", [orgId]);
      await markTenantStale({ kind: "org", orgId }, { byUser });
    }
    // The idle tenant went stale first, so only priority can reorder them.
    await pool.query(
      `UPDATE context.graph_manifests
          SET stale_since = CASE WHEN org_id = $1 THEN now() - interval '2 hours'
                                 ELSE now() - interval '1 hour' END
        WHERE org_id = ANY($2::uuid[])`,
      [idle, [idle, active]],
    );

    const claim = await claimRebuild();
    expect(claim?.orgId).toBe(active);
    if (claim) await finishRebuild(claim, { sourceWatermark: new Date(), cdcLagSeconds: 0 });
  });
});
