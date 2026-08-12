import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("./tx", () => ({
  withTenantTransaction: async (_scope: unknown, fn: (c: unknown) => Promise<unknown>) =>
    fn({ query }),
}));

import type { Scope } from "./scope-sql";
import {
  CALL_OUTCOMES,
  addNote,
  listActivities,
  logCall,
  markActivitySynced,
} from "./enquiry-activities";

const scope: Scope = { kind: "org", orgId: "org-1" };

const row = {
  id: "act-1",
  org_id: "org-1",
  enquiry_id: "enq-1",
  kind: "call",
  actor_user_id: "user-7",
  call_outcome: "spoke_interested",
  call_direction: "outgoing",
  call_seconds: 240,
  occurred_at: new Date("2026-08-12T05:00:00.000Z"),
  body: "Wants a tour on Friday",
  synced_to_twenty_at: null,
};

beforeEach(() => query.mockReset());

describe("the outcome vocabulary", () => {
  it("is a fixed list, so it can drive reporting (C2)", () => {
    expect(CALL_OUTCOMES).toEqual([
      "spoke_interested",
      "spoke_not_interested",
      "no_answer",
      "voicemail",
      "wrong_number",
      "callback_requested",
    ]);
  });
});

describe("logCall", () => {
  it("writes the call and advances the enquiry's activity clock in one transaction", async () => {
    query.mockResolvedValue({ rows: [row] });
    const activity = await logCall(scope, {
      enquiryId: "enq-1",
      actorUserId: "user-7",
      outcome: "spoke_interested",
      direction: "outgoing",
      seconds: 240,
      occurredAt: "2026-08-12T05:00:00.000Z",
      body: "Wants a tour on Friday",
    });
    expect(activity.kind).toBe("call");
    expect(activity.syncedToTwentyAt).toBeNull();

    const statements = query.mock.calls.map((c) => String(c[0]));
    expect(statements[0]).toContain("INSERT INTO adsagent.enquiry_activities");
    expect(statements[1]).toContain("UPDATE adsagent.enquiries");
    expect(statements[1]).toMatch(/last_activity_at\s*=\s*now\(\)/);
    expect(query.mock.calls[0][1]).toEqual([
      "org-1",
      "enq-1",
      "call",
      "user-7",
      "spoke_interested",
      "outgoing",
      240,
      "2026-08-12T05:00:00.000Z",
      "Wants a tour on Friday",
    ]);
  });

  it("rejects a negative duration before it reaches the database", async () => {
    await expect(
      logCall(scope, {
        enquiryId: "enq-1",
        actorUserId: "user-7",
        outcome: "no_answer",
        direction: "outgoing",
        seconds: -1,
        occurredAt: "2026-08-12T05:00:00.000Z",
      }),
    ).rejects.toThrow(/seconds must be zero or greater/i);
  });

  it("leaves the row unsynced, so the projection worker picks it up (C7)", async () => {
    query.mockResolvedValue({ rows: [row] });
    await logCall(scope, {
      enquiryId: "enq-1",
      actorUserId: "user-7",
      outcome: "no_answer",
      direction: "outgoing",
      seconds: 0,
      occurredAt: "2026-08-12T05:00:00.000Z",
    });
    const insertSql = String(query.mock.calls[0][0]);
    expect(insertSql).not.toMatch(/synced_to_twenty_at\s*=/i);
  });
});

describe("addNote", () => {
  it("stores a note with no call fields", async () => {
    query.mockResolvedValue({ rows: [{ ...row, kind: "note", call_outcome: null }] });
    const note = await addNote(scope, {
      enquiryId: "enq-1",
      actorUserId: "user-7",
      body: "Sent the shortlist",
    });
    expect(note.kind).toBe("note");
    expect(query.mock.calls[0][1]).toEqual([
      "org-1",
      "enq-1",
      "note",
      "user-7",
      null,
      null,
      null,
      expect.any(String),
      "Sent the shortlist",
    ]);
  });
});

describe("listActivities", () => {
  it("returns the log newest first", async () => {
    query.mockResolvedValue({ rows: [row] });
    await listActivities(scope, "enq-1");
    expect(String(query.mock.calls[0][0])).toContain("ORDER BY occurred_at DESC");
  });
});

describe("markActivitySynced", () => {
  it("stamps the Twenty write-back time", async () => {
    query.mockResolvedValue({ rows: [] });
    await markActivitySynced(scope, "act-1");
    expect(String(query.mock.calls[0][0])).toMatch(/synced_to_twenty_at\s*=\s*now\(\)/);
  });
});
