import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getPool } from "../db/client";
import { createContact, getContactById } from "../db/contacts";
import {
  countEnquiriesByState,
  createEnquiry,
  getEnquiryById,
  listEnquiries,
  setReplyState,
} from "../db/enquiries";
import { listActivities, logCall } from "../db/enquiry-activities";
import { addMessage, listMessages } from "../db/enquiry-messages";
import { applyRevision, createRevision, getRequirement } from "../db/enquiry-requirements";
import { suppressEnquiry } from "../db/erasure";
import { slugifyOrgName } from "../db/orgs";
import type { Scope } from "../db/scope-sql";

/**
 * Database-backed on purpose. Every other test in this plan mocks the pool and
 * proves what SQL a module emits; this one proves the SQL runs, that RLS
 * admits the right rows, and that the whole loop works with Twenty absent.
 */
if (!process.env.DATABASE_URL) {
  throw new Error("enquiry-spine.integration.test.ts requires DATABASE_URL");
}

let orgA: string;
let orgB: string;
let userA: string;
let scopeA: Scope;
let scopeB: Scope;
/** Fixture org names for integration tests (slug derived via slugifyOrgName). */
const ORG_NAME_A = "Spine Test A";
const ORG_NAME_B = "Spine Test B";

async function deleteFixtureOrgs(pool: ReturnType<typeof getPool>, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await pool.query(
    `DELETE FROM context.deletion_propagations
      WHERE request_id IN (SELECT id FROM context.deletion_requests WHERE org_id = ANY($1::uuid[]))`,
    [ids],
  );
  await pool.query(`DELETE FROM context.deletion_requests WHERE org_id = ANY($1::uuid[])`, [ids]);
  await pool.query(`DELETE FROM adsagent.enquiry_messages WHERE org_id = ANY($1::uuid[])`, [ids]);
  await pool.query(
    `DELETE FROM adsagent.enquiry_requirement_revisions WHERE org_id = ANY($1::uuid[])`,
    [ids],
  );
  await pool.query(`DELETE FROM adsagent.enquiry_requirements WHERE org_id = ANY($1::uuid[])`, [ids]);
  await pool.query(`DELETE FROM adsagent.enquiry_activities WHERE org_id = ANY($1::uuid[])`, [ids]);
  await pool.query(`DELETE FROM adsagent.enquiries WHERE org_id = ANY($1::uuid[])`, [ids]);
  await pool.query(`DELETE FROM adsagent.contacts WHERE org_id = ANY($1::uuid[])`, [ids]);
  await pool.query(`DELETE FROM adsagent.audit_log WHERE org_id = ANY($1::uuid[])`, [ids]);
  await pool.query(`DELETE FROM public.users WHERE org_id = ANY($1::uuid[])`, [ids]);
  await pool.query(`DELETE FROM public.orgs WHERE id = ANY($1::uuid[])`, [ids]);
}

beforeAll(async () => {
  const pool = getPool();
  // Re-run safe: drop leftover fixtures from a prior failed run.
  const leftover = await pool.query<{ id: string }>(
    `SELECT id FROM public.orgs WHERE name IN ($1, $2)`,
    [ORG_NAME_A, ORG_NAME_B],
  );
  if (leftover.rows.length > 0) {
    await deleteFixtureOrgs(
      pool,
      leftover.rows.map((r) => r.id),
    );
  }
  const org = await pool.query<{ id: string }>(
    `INSERT INTO public.orgs (name, slug, kind) VALUES ($1, $3, 'external'), ($2, $4, 'external')
     RETURNING id`,
    [ORG_NAME_A, ORG_NAME_B, slugifyOrgName(ORG_NAME_A), slugifyOrgName(ORG_NAME_B)],
  );
  orgA = org.rows[0].id;
  orgB = org.rows[1].id;
  const user = await pool.query<{ id: string }>(
    `INSERT INTO public.users (org_id, email, role)
     VALUES ($1, $2, 'operator')
     RETURNING id`,
    [orgA, `spine-a-${orgA}@test.local`],
  );
  userA = user.rows[0].id;
  scopeA = { kind: "org", orgId: orgA };
  scopeB = { kind: "org", orgId: orgB };
});

afterAll(async () => {
  const pool = getPool();
  await deleteFixtureOrgs(pool, [orgA, orgB]);
  await pool.end();
});

describe("a broker can work an enquiry end to end", () => {
  it("captures, threads, calls, extracts, states and counts", async () => {
    const contact = await createContact(scopeA, {
      name: "Asha Rao",
      phone: "+919800000000",
    });
    const enquiry = await createEnquiry(scopeA, {
      contactId: contact.id,
      contactName: "Asha Rao",
      contactPhone: "+919800000000",
      listingUrl: "https://gentlespace.in/spaces/hsr-1",
    });

    await addMessage(scopeA, {
      enquiryId: enquiry.id,
      channel: "web_form",
      body: "38 desks in HSR",
    });
    expect(await listMessages(scopeA, enquiry.id)).toHaveLength(1);

    await logCall(scopeA, {
      enquiryId: enquiry.id,
      actorUserId: userA,
      outcome: "spoke_interested",
      direction: "outgoing",
      seconds: 240,
      occurredAt: new Date().toISOString(),
      body: "Wants a tour on Friday",
    });
    const activities = await listActivities(scopeA, enquiry.id);
    expect(activities.map((a) => a.kind)).toContain("call");

    const revision = await createRevision(scopeA, {
      enquiryId: enquiry.id,
      source: "call_notes",
      proposed: { desksMin: 38, desksMax: 38 },
    });
    expect(await getRequirement(scopeA, enquiry.id)).toBeNull(); // proposals do not apply
    await applyRevision(scopeA, revision.id, userA);
    expect(await getRequirement(scopeA, enquiry.id)).toMatchObject({ desksMin: 38, desksMax: 38 });

    await setReplyState(scopeA, enquiry.id, "called");
    expect((await getEnquiryById(scopeA, enquiry.id))?.replyState).toBe("called");
    expect(await countEnquiriesByState(scopeA)).toMatchObject({ called: 1 });

    // The whole loop ran with no Twenty identifier anywhere.
    expect((await getEnquiryById(scopeA, enquiry.id))?.twentyOpportunityId).toBeNull();
    expect((await getContactById(scopeA, contact.id))?.syncState).toBe("pending");
  });
});

describe("an enquiry survives Twenty being down", () => {
  it("captures and is workable while every Twenty call throws", async () => {
    vi.resetModules();
    vi.doMock("../crm/twenty-client", () => ({
      getTwentyClient: async () => {
        throw new Error("no Twenty connection for org " + orgA);
      },
    }));
    const { projectPendingActivities, projectPendingContacts } = await import(
      "../crm/twenty-projection"
    );

    const contact = await createContact(scopeA, { name: "Down Test", phone: "+919800000009" });
    const enquiry = await createEnquiry(scopeA, {
      contactId: contact.id,
      contactName: "Down Test",
      contactPhone: "+919800000009",
    });
    await logCall(scopeA, {
      enquiryId: enquiry.id,
      actorUserId: userA,
      outcome: "no_answer",
      direction: "outgoing",
      seconds: 0,
      occurredAt: new Date().toISOString(),
    });

    // claimPendingContacts backs off fresh rows for 60s; age them so the worker sees them.
    await getPool().query(
      `UPDATE adsagent.contacts SET updated_at = now() - interval '2 hours' WHERE id = $1`,
      [contact.id],
    );

    // The projection worker runs and fails, and nothing is lost.
    const contactResult = await projectPendingContacts(50);
    const activityResult = await projectPendingActivities(50);
    expect(contactResult.failed).toBeGreaterThan(0);
    expect(activityResult.succeeded).toBe(0);

    expect(await getEnquiryById(scopeA, enquiry.id)).not.toBeNull();
    expect(await listEnquiries(scopeA)).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: enquiry.id })]),
    );
    expect(await setReplyState(scopeA, enquiry.id, "called")).not.toBeNull();
    expect(await listActivities(scopeA, enquiry.id)).toHaveLength(1);

    const after = await getContactById(scopeA, contact.id);
    expect(after?.syncState).toBe("failed");
    expect(after?.syncAttempts).toBe(1);

    vi.doUnmock("../crm/twenty-client");
    vi.resetModules();
  });
});

describe("tenant isolation across the new tables", () => {
  it("hides org A's enquiry from org B by primary key", async () => {
    const contact = await createContact(scopeA, { name: "Isolated", phone: "+919800000001" });
    const enquiry = await createEnquiry(scopeA, {
      contactId: contact.id,
      contactName: "Isolated",
    });
    expect(await getEnquiryById(scopeB, enquiry.id)).toBeNull();
    expect(await listMessages(scopeB, enquiry.id)).toEqual([]);
    expect(await listActivities(scopeB, enquiry.id)).toEqual([]);
    expect(await getContactById(scopeB, contact.id)).toBeNull();
  });

  it("refuses a write carrying another tenant's org_id, because of WITH CHECK", async () => {
    const pool = getPool();
    const { rows } = await pool.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
      `SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`,
    );
    const role = rows[0];
    if (role?.rolsuper || role?.rolbypassrls) {
      // Local bootstrap uses the table owner (gentle); RLS is not exercised on that role.
      return;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT public.set_tenant($1)", [orgB]);
      await expect(
        client.query(
          `INSERT INTO adsagent.contacts (org_id, name) VALUES ($1, 'Cross tenant')`,
          [orgA],
        ),
      ).rejects.toThrow(/row-level security/i);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});

describe("suppression blocks every read without touching a read path", () => {
  it("hides the enquiry and opens a ledger row per store", async () => {
    const contact = await createContact(scopeA, { name: "Forget Me", phone: "+919800000002" });
    const enquiry = await createEnquiry(scopeA, {
      contactId: contact.id,
      contactName: "Forget Me",
    });

    const result = await suppressEnquiry(scopeA, enquiry.id, userA);
    expect(result).not.toBeNull();

    expect(await getEnquiryById(scopeA, enquiry.id)).toBeNull();
    expect(await listEnquiries(scopeA)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: enquiry.id })]),
    );

    const pool = getPool();
    const row = await pool.query<{ lifecycle: string; erase_after: string }>(
      `SELECT lifecycle, erase_after::text FROM adsagent.enquiries WHERE id = $1`,
      [enquiry.id],
    );
    // Still physically present: the retention floor is a year, not zero.
    expect(row.rows[0].lifecycle).toBe("suppressed");
    expect(Date.parse(row.rows[0].erase_after) - Date.now()).toBeGreaterThan(
      300 * 24 * 60 * 60 * 1000,
    );

    const stores = await pool.query<{ store: string; state: string }>(
      `SELECT p.store, p.state
         FROM context.deletion_propagations p
         JOIN context.deletion_requests r ON r.id = p.request_id
        WHERE r.subject_ref = $1 ORDER BY p.store`,
      [enquiry.id],
    );
    expect(stores.rows).toEqual([
      { store: "postgres", state: "suppressed" },
      { store: "twenty", state: "pending" },
    ]);
  });
});
