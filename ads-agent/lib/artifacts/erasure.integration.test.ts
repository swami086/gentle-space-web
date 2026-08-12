/**
 * The S8a gate. Runs against a live Garage and a live Postgres:
 *   docker compose -f docker-compose.garage.yml up -d && ./scripts/garage/bootstrap.sh
 *
 * The load-bearing assertion is "LEAVES NO BYTES BEHIND". Everything else could
 * pass while the bytes were still sitting in the bucket.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { getPool } from "../db/client";
import { ObjectStore } from "../objectstore/client";
import type { Scope } from "../db/scope-sql";
import { eraseArtifactsForSubject, eraseArtifactsForTenant } from "./erase";
import { artifactStorageKey } from "./key";
import { ARTIFACT_BUCKET, getArtifact, putArtifact } from "./store";
import { danglingSweep, orphanSweep } from "./sweeps";

if (!process.env.DATABASE_URL) {
  throw new Error("erasure.integration.test.ts requires DATABASE_URL");
}

const ORG_A = randomUUID();
const ORG_B = randomUUID();
const SUBJECT = randomUUID();
const REQUEST_A = randomUUID();
const REQUEST_B = randomUUID();
const scopeA: Scope = { kind: "org", orgId: ORG_A };
const scopeB: Scope = { kind: "org", orgId: ORG_B };

const store = ObjectStore.fromEnv();
const pool = getPool();

/** Every call runs with the tenant set, because RLS is FORCEd on these tables. */
async function asTenant<T>(scope: Scope, fn: () => Promise<T>): Promise<T> {
  await pool.query("SELECT public.set_tenant($1)", [scope.orgId]);
  return fn();
}

beforeAll(async () => {
  for (const [orgId, requestId] of [
    [ORG_A, REQUEST_A],
    [ORG_B, REQUEST_B],
  ] as const) {
    await pool.query(
      `INSERT INTO public.orgs (id, name, kind, slug)
       VALUES ($1, $2, 'external', $3)
       ON CONFLICT (id) DO NOTHING`,
      [orgId, `gate-${orgId.slice(0, 8)}`, `gate-${orgId.slice(0, 8)}`],
    );
    await pool.query("SELECT public.set_tenant($1)", [orgId]);
    await pool.query(
      `INSERT INTO context.deletion_requests
         (id, org_id, subject_kind, subject_ref, erase_after, respond_by)
       VALUES ($1, $2, 'enquirer', $3, current_date + 366, current_date + 90)
       ON CONFLICT (id) DO NOTHING`,
      [requestId, orgId, SUBJECT],
    );
  }
});

afterAll(async () => {
  for (const orgId of [ORG_A, ORG_B]) {
    await pool.query("SELECT public.set_tenant($1)", [orgId]);
    for await (const object of store.list(ARTIFACT_BUCKET, `artifacts/${orgId}/`)) {
      await store.remove(ARTIFACT_BUCKET, object.key);
    }
    await pool.query(`DELETE FROM context.artifact_dangling_flags WHERE org_id = $1`, [orgId]);
    await pool.query(`DELETE FROM context.artifacts WHERE org_id = $1`, [orgId]);
    await pool.query(
      `DELETE FROM context.deletion_propagations
        WHERE request_id IN (SELECT id FROM context.deletion_requests WHERE org_id = $1)`,
      [orgId],
    );
    await pool.query(`DELETE FROM context.outbox_events WHERE org_id = $1`, [orgId]);
    await pool.query(`DELETE FROM context.deletion_requests WHERE org_id = $1`, [orgId]);
    await pool.query(`DELETE FROM public.orgs WHERE id = $1`, [orgId]);
  }
});

describe("S8a gate: write, read, erase with no bytes behind", () => {
  it("survives a write", async () => {
    const row = await asTenant(scopeA, () =>
      putArtifact(scopeA, {
        contentType: "context_pack",
        body: new TextEncoder().encode(JSON.stringify({ pack: "hello" })),
        subjectRefs: [SUBJECT],
      }),
    );

    expect(row.storageKey).toBe(artifactStorageKey(scopeA, "context_pack", row.id));
    expect(await store.head(ARTIFACT_BUCKET, row.storageKey)).not.toBeNull();
  });

  it("survives a read, and the bytes match the recorded checksum", async () => {
    const written = await asTenant(scopeA, () =>
      putArtifact(scopeA, {
        contentType: "draft",
        body: new TextEncoder().encode("draft body"),
        subjectRefs: [SUBJECT],
      }),
    );

    const read = await asTenant(scopeA, () => getArtifact(scopeA, written.id));
    expect(new TextDecoder().decode(read!.body!)).toBe("draft body");
    expect(read!.row.checksum).toBe(written.checksum);
  });

  it("returns null, not 403-shaped data, for another tenant's artifact", async () => {
    const written = await asTenant(scopeA, () =>
      putArtifact(scopeA, { contentType: "draft", body: new TextEncoder().encode("secret") }),
    );
    await expect(asTenant(scopeB, () => getArtifact(scopeB, written.id))).resolves.toBeNull();
  });

  it("LEAVES NO BYTES BEHIND after a per-subject erasure", async () => {
    const written = await asTenant(scopeA, () =>
      putArtifact(scopeA, {
        contentType: "talking_points",
        body: new TextEncoder().encode("talking points"),
        subjectRefs: [SUBJECT],
      }),
    );
    // Precondition: the object really is there before we erase it, otherwise
    // the assertion below would pass vacuously.
    expect(await store.head(ARTIFACT_BUCKET, written.storageKey)).not.toBeNull();

    const result = await asTenant(scopeA, () =>
      eraseArtifactsForSubject(scopeA, SUBJECT, REQUEST_A),
    );
    expect(result.erasedIds).toContain(written.id);

    // THE GATE. Asked of the object store itself, not of Postgres.
    expect(await store.head(ARTIFACT_BUCKET, written.storageKey)).toBeNull();
  });

  it("keeps the row as a tombstone so a dangling reference renders 'content erased'", async () => {
    const { rows } = await asTenant(scopeA, () =>
      pool.query<{ erased_at: Date | null }>(
        `SELECT erased_at FROM context.artifacts
          WHERE org_id = $1 AND subject_refs @> ARRAY[$2]::uuid[]`,
        [ORG_A, SUBJECT],
      ),
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.erased_at).not.toBeNull();
  });

  it("records the erasure in the deletion ledger under store = objectstore", async () => {
    const { rows } = await asTenant(scopeA, () =>
      pool.query<{ state: string }>(
        `SELECT state FROM context.deletion_propagations
          WHERE request_id = $1 AND store = 'objectstore'`,
        [REQUEST_A],
      ),
    );
    expect(rows[0]?.state).toBe("erased");
  });

  it("leaves no bytes under the tenant prefix after offboarding", async () => {
    await asTenant(scopeA, () =>
      putArtifact(scopeA, { contentType: "draft", body: new TextEncoder().encode("last one") }),
    );
    await asTenant(scopeA, () => eraseArtifactsForTenant(scopeA, REQUEST_A));

    const remaining: string[] = [];
    for await (const object of store.list(ARTIFACT_BUCKET, `artifacts/${ORG_A}/`)) {
      remaining.push(object.key);
    }
    expect(remaining).toEqual([]);
  });
});

describe("the two sweeps are two different sweeps", () => {
  it("orphan sweep reclaims bytes with no row, and only once past the grace window", async () => {
    const orphanKey = `artifacts/${ORG_A}/draft/${randomUUID()}`;
    await store.put(ARTIFACT_BUCKET, orphanKey, new TextEncoder().encode("orphan"), "text/plain");

    // Inside the window it is a write in flight, not residue.
    const spared = await orphanSweep({ graceSeconds: 3600 });
    expect(spared.deleted).not.toContain(orphanKey);
    expect(await store.head(ARTIFACT_BUCKET, orphanKey)).not.toBeNull();

    const swept = await orphanSweep({ graceSeconds: 0 });
    expect(swept.deleted).toContain(orphanKey);
    expect(await store.head(ARTIFACT_BUCKET, orphanKey)).toBeNull();
  });

  it("dangling sweep flags a row whose bytes vanished out of band, and deletes nothing", async () => {
    const written = await asTenant(scopeB, () =>
      putArtifact(scopeB, { contentType: "draft", body: new TextEncoder().encode("vanishing") }),
    );
    // Delete the object behind the index's back -- the case §13.1 calls a bug.
    await store.remove(ARTIFACT_BUCKET, written.storageKey);

    const flags = await danglingSweep();
    expect(flags.find((f) => f.artifactId === written.id)?.classification).toBe("unexplained");

    // The row is still there: flagging, not deleting.
    const { rowCount } = await pool.query(
      `SELECT 1 FROM context.artifacts WHERE id = $1`,
      [written.id],
    );
    expect(rowCount).toBe(1);
  });
});
