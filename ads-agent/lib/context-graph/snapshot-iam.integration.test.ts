/**
 * Datastore §12.3: snapshot storage is a tenancy boundary. This proves it at the
 * credential layer rather than the application layer -- tenant A's own access
 * key is refused by the object store when pointed at tenant B's bucket.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { getPool } from "../db/client";
import { ObjectStore } from "../objectstore/client";
import { deleteBucket, garageAdminFromEnv, getBucketByAlias } from "../objectstore/garage-admin";
import type { Scope } from "../db/scope-sql";
import { openBytes, sealBytes } from "./snapshot-export";
import {
  destroyTenantSnapshotKey,
  provisionSnapshotStorage,
  readerCredentials,
  snapshotBucketName,
  tenantDataKey,
} from "./snapshot-iam";

if (!process.env.DATABASE_URL) {
  throw new Error("snapshot-iam.integration.test.ts requires DATABASE_URL");
}

const ORG_A = randomUUID();
const ORG_B = randomUUID();
const scopeA: Scope = { kind: "org", orgId: ORG_A };
const pool = getPool();
const server = ObjectStore.fromEnv();

beforeAll(async () => {
  for (const orgId of [ORG_A, ORG_B]) {
    await pool.query(
      `INSERT INTO public.orgs (id, name, kind, slug)
       VALUES ($1, $2, 'external', $3)
       ON CONFLICT (id) DO NOTHING`,
      [orgId, `iam-${orgId.slice(0, 8)}`, `iam-${orgId.slice(0, 8)}`],
    );
    await pool.query("SELECT public.set_tenant($1)", [orgId]);
    await provisionSnapshotStorage({ kind: "org", orgId });
  }
});

afterAll(async () => {
  const admin = garageAdminFromEnv();
  for (const orgId of [ORG_A, ORG_B]) {
    const bucketName = snapshotBucketName(orgId);
    const bucket = await getBucketByAlias(admin, bucketName);
    if (bucket) {
      for await (const object of server.list(bucketName, "")) {
        await server.remove(bucketName, object.key);
      }
      await deleteBucket(admin, bucket.id);
    }
    await pool.query(`DELETE FROM context.snapshot_storage WHERE org_id = $1`, [orgId]);
    await pool.query(`DELETE FROM public.orgs WHERE id = $1`, [orgId]);
  }
});

describe("snapshot storage is a tenancy boundary at the credential layer", () => {
  it("gives each tenant its own bucket", () => {
    expect(snapshotBucketName(ORG_A)).not.toBe(snapshotBucketName(ORG_B));
  });

  it("lets a tenant's own key read its own snapshot", async () => {
    await pool.query("SELECT public.set_tenant($1)", [ORG_A]);
    await server.put(
      snapshotBucketName(ORG_A),
      "s.duckdb.enc",
      new TextEncoder().encode("A bytes"),
      "application/octet-stream",
    );

    const readerA = new ObjectStore(await readerCredentials(scopeA));
    const bytes = await readerA.get(snapshotBucketName(ORG_A), "s.duckdb.enc");
    expect(new TextDecoder().decode(bytes!)).toBe("A bytes");
  });

  it("REFUSES tenant A's key against tenant B's bucket, at the object store", async () => {
    await pool.query("SELECT public.set_tenant($1)", [ORG_B]);
    await server.put(
      snapshotBucketName(ORG_B),
      "s.duckdb.enc",
      new TextEncoder().encode("B bytes"),
      "application/octet-stream",
    );

    await pool.query("SELECT public.set_tenant($1)", [ORG_A]);
    const readerA = new ObjectStore(await readerCredentials(scopeA));

    // Not a 404 and not an application check: Garage refuses the credential.
    await expect(readerA.get(snapshotBucketName(ORG_B), "s.duckdb.enc")).rejects.toThrow(/403/);
  });

  it("refuses a write with a read-only tenant key", async () => {
    await pool.query("SELECT public.set_tenant($1)", [ORG_A]);
    const readerA = new ObjectStore(await readerCredentials(scopeA));
    await expect(
      readerA.put(snapshotBucketName(ORG_A), "nope", new Uint8Array([1]), "text/plain"),
    ).rejects.toThrow(/403/);
  });

  it("crypto-shreds every snapshot when the tenant data key is destroyed", async () => {
    await pool.query("SELECT public.set_tenant($1)", [ORG_A]);
    const key = await tenantDataKey(scopeA);
    const sealed = sealBytes(new TextEncoder().encode("snapshot"), key);
    expect(openBytes(sealed, key).toString("utf8")).toBe("snapshot");

    await destroyTenantSnapshotKey(scopeA);
    await expect(tenantDataKey(scopeA)).rejects.toThrow(/destroyed/);
  });
});
