import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPool } from "../db/client";
import { revealContact } from "../db/contact-reveal";
import { createContact } from "../db/contacts";
import { createEnquiry } from "../db/enquiries";
import { addMessage } from "../db/enquiry-messages";
import { applyRevision, createRevision, getRequirement } from "../db/enquiry-requirements";
import { listSignals, refreshEnquirySignals } from "../db/enquiry-signals";
import { listNotifications } from "../db/notifications";
import { createReminder, listPendingReminders } from "../db/reminders";
import { getTodayFeed } from "../db/today-feed";
import { fireDueReminders } from "../reminders/scheduler";
import type { Scope } from "../db/scope-sql";

if (!process.env.DATABASE_URL) {
  throw new Error("enquiry-loop.integration.test.ts requires DATABASE_URL");
}

const ORG_NAME = "Loop Test";

let orgId: string;
let userId: string;
let scope: Scope;

async function deleteLoopFixture(pool: ReturnType<typeof getPool>, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  await pool.query(
    `DELETE FROM context.deletion_propagations
      WHERE request_id IN (SELECT id FROM context.deletion_requests WHERE org_id = ANY($1::uuid[]))`,
    [ids],
  );
  await pool.query(`DELETE FROM context.deletion_requests WHERE org_id = ANY($1::uuid[])`, [ids]);
  await pool.query(`DELETE FROM context.access_log WHERE org_id = ANY($1::uuid[])`, [ids]);
  await pool.query(`DELETE FROM adsagent.notifications WHERE org_id = ANY($1::uuid[])`, [ids]);
  await pool.query(`DELETE FROM adsagent.reminders WHERE org_id = ANY($1::uuid[])`, [ids]);
  await pool.query(`DELETE FROM adsagent.enquiry_signals WHERE org_id = ANY($1::uuid[])`, [ids]);
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
  const leftover = await pool.query<{ id: string }>(
    `SELECT id FROM public.orgs WHERE name = $1`,
    [ORG_NAME],
  );
  if (leftover.rows.length > 0) {
    await deleteLoopFixture(
      pool,
      leftover.rows.map((r) => r.id),
    );
  }
  const org = await pool.query<{ id: string }>(
    `INSERT INTO public.orgs (name, kind) VALUES ($1, 'external') RETURNING id`,
    [ORG_NAME],
  );
  orgId = org.rows[0].id;
  const user = await pool.query<{ id: string }>(
    `INSERT INTO public.users (org_id, email, role) VALUES ($1, $2, 'operator')
     RETURNING id`,
    [orgId, `loop-${orgId}@test.local`],
  );
  userId = user.rows[0].id;
  scope = { kind: "org", orgId };
});

afterAll(async () => {
  const pool = getPool();
  await deleteLoopFixture(pool, [orgId]);
  await pool.end();
});

async function seedEnquiry(name: string) {
  const contact = await createContact(scope, {
    name,
    phone: `+9198000${Math.floor(Math.random() * 100000).toString().padStart(5, "0")}`,
  });
  const enquiry = await createEnquiry(scope, {
    contactId: contact.id,
    contactName: name,
    contactPhone: contact.phone,
  });
  return { contact, enquiry };
}

describe("reminders work end to end (C4, C5)", () => {
  it("fires a due reminder into the notification feed exactly once", async () => {
    const { enquiry } = await seedEnquiry("Reminder Target");
    const reminder = await createReminder(scope, {
      enquiryId: enquiry.id,
      userId,
      dueAt: new Date(Date.now() + 60_000).toISOString(),
      note: "Call back about the tour",
    });
    expect(await listPendingReminders(scope, { userId })).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: reminder.id })]),
    );

    expect(await fireDueReminders(new Date())).toEqual({ fired: 0 });

    const after = new Date(Date.now() + 120_000);
    expect((await fireDueReminders(after)).fired).toBeGreaterThanOrEqual(1);

    const notifications = await listNotifications(scope, userId, { unreadOnly: true });
    expect(notifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "reminder_due", enquiryId: enquiry.id }),
      ]),
    );

    const before = notifications.length;
    await fireDueReminders(after);
    expect(await listNotifications(scope, userId, { unreadOnly: true })).toHaveLength(before);
  });
});

describe("the Today feed answers all three questions (C6)", () => {
  it("lists waiting enquiries and enquiries with no contact since the window", async () => {
    const { enquiry } = await seedEnquiry("Stale Target");
    await getPool().query(
      `UPDATE adsagent.enquiries SET last_activity_at = now() - interval '30 days'
        WHERE id = $1`,
      [enquiry.id],
    );

    const feed = await getTodayFeed(scope, { userId, noContactDays: 7 });
    expect(feed.waitingEnquiries.map((e) => e.id)).toContain(enquiry.id);
    const stale = feed.noContactSince.find((e) => e.id === enquiry.id);
    expect(stale?.daysSince).toBeGreaterThanOrEqual(29);

    const wide = await getTodayFeed(scope, { userId, noContactDays: 90 });
    expect(wide.noContactSince.map((e) => e.id)).not.toContain(enquiry.id);
  });
});

describe("extraction proposes and only a human applies (C3)", () => {
  it("leaves the live requirement untouched until a revision is confirmed", async () => {
    const { enquiry } = await seedEnquiry("Extraction Target");
    const revision = await createRevision(scope, {
      enquiryId: enquiry.id,
      source: "call_notes",
      proposed: { desksMin: 38, desksMax: 38 },
    });

    expect(await getRequirement(scope, enquiry.id)).toBeNull();

    const applied = await applyRevision(scope, revision.id, userId);
    expect(applied).toMatchObject({ desksMin: 38, desksMax: 38 });

    expect(await applyRevision(scope, revision.id, userId)).toBeNull();

    const stored = await getPool().query<{ confirmed_by: string; applied: boolean }>(
      `SELECT confirmed_by, applied FROM adsagent.enquiry_requirement_revisions WHERE id = $1`,
      [revision.id],
    );
    expect(stored.rows[0]).toEqual({ confirmed_by: userId, applied: true });
  });

  it("refuses an applied revision with no confirming human at the database level", async () => {
    const { enquiry } = await seedEnquiry("Constraint Target");
    const revision = await createRevision(scope, {
      enquiryId: enquiry.id,
      source: "agent",
      proposed: { desksMin: 10 },
    });
    const client = await getPool().connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT public.set_tenant($1)", [orgId]);
      await expect(
        client.query(
          `UPDATE adsagent.enquiry_requirement_revisions SET applied = true WHERE id = $1`,
          [revision.id],
        ),
      ).rejects.toThrow(/requirement_revision_confirmed/);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});

describe("signals and reveal", () => {
  it("derives a countable signal from the thread (A6)", async () => {
    const { enquiry } = await seedEnquiry("Signal Target");
    await addMessage(scope, {
      enquiryId: enquiry.id,
      channel: "web_form",
      body: "What is the price per desk?",
    });
    await addMessage(scope, {
      enquiryId: enquiry.id,
      channel: "email",
      body: "Any discount on that pricing?",
      externalId: "loop-1",
    });
    await refreshEnquirySignals(scope, enquiry.id);
    const signals = await listSignals(scope, enquiry.id);
    expect(signals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "asked_about_pricing", occurrences: 2 }),
      ]),
    );
  });

  it("writes an access-log row for every reveal (A5)", async () => {
    const { enquiry, contact } = await seedEnquiry("Reveal Target");
    const revealed = await revealContact(scope, enquiry.id, userId);
    expect(revealed?.phone).toBe(contact.phone);
    expect(revealed?.source).toBe("captured");

    const audit = await getPool().query<{ n: string }>(
      `SELECT count(*) AS n FROM context.access_log
        WHERE org_id = $1 AND action = 'contact.reveal' AND subject_ref = $2`,
      [orgId, enquiry.id],
    );
    expect(Number(audit.rows[0].n)).toBe(1);
  });
});
