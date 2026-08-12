import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { enqueueEvent } from "./outbox";
import { withTenantTransaction } from "./tx";

// The listings app has no test-support module of its own; this file owns its
// pool because it is the only database test in this app.
const pool = new Pool({
  connectionString:
    process.env.TEST_DATABASE_URL ??
    (() => {
      throw new Error("TEST_DATABASE_URL is not set — see docs/superpowers/plans/2026-08-12-s5a-event-backbone.md");
    })(),
  max: 1,
});

let orgId: string;

beforeAll(async () => {
  const name = `listings-outbox-${Date.now()}`;
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO public.orgs (name, kind, slug) VALUES ($1, 'external', $2) RETURNING id`,
    [name, slug],
  );
  orgId = rows[0].id;
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
});

afterAll(async () => {
  await pool.end();
});

describe("listings enqueueEvent", () => {
  it("writes a portal.event row inside the caller's transaction", async () => {
    const id = await withTenantTransaction({ kind: "org", orgId }, (client) =>
      enqueueEvent({ kind: "org", orgId }, client, {
        topic: "portal.event",
        payload: { sessionId: "s-1", kind: "page_view" },
      }),
    );

    const { rows } = await pool.query<{ id: string; ordering_key: string; topic: string }>(
      `SELECT id, ordering_key, topic FROM context.outbox_events WHERE id = $1`,
      [id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id, ordering_key: orgId, topic: "portal.event" });
  });

  it("leaves no event behind when the caller's transaction fails", async () => {
    await expect(
      withTenantTransaction({ kind: "org", orgId }, async (client) => {
        await enqueueEvent({ kind: "org", orgId }, client, {
          topic: "portal.event",
          payload: { sessionId: "s-2", kind: "page_view" },
        });
        throw new Error("consent check failed after enqueue");
      }),
    ).rejects.toThrow("consent check failed after enqueue");

    const { rows } = await pool.query(
      `SELECT id FROM context.outbox_events WHERE org_id = $1 AND payload->>'sessionId' = 's-2'`,
      [orgId],
    );
    expect(rows).toEqual([]);
  });
});
