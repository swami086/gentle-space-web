import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("./tx", () => ({
  withTenantTransaction: async (_scope: unknown, fn: (c: unknown) => Promise<unknown>) =>
    fn({ query }),
}));

import {
  countUnread,
  createNotification,
  listNotifications,
  markNotificationRead,
} from "./notifications";

const scope = { kind: "org", orgId: "org-1" } as const;

const row = {
  id: "note-1",
  org_id: "org-1",
  user_id: "user-7",
  kind: "reminder_due",
  enquiry_id: "enq-1",
  title: "Reminder due: call Asha Rao",
  body: null,
  read_at: null,
  created_at: new Date("2026-08-14T04:30:00.000Z"),
};

beforeEach(() => query.mockReset().mockResolvedValue({ rows: [row] }));

describe("createNotification", () => {
  it("stores an unread notification for one user", async () => {
    const notification = await createNotification(scope, {
      userId: "user-7",
      kind: "reminder_due",
      enquiryId: "enq-1",
      title: "Reminder due: call Asha Rao",
    });
    expect(notification.readAt).toBeNull();
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("INSERT INTO adsagent.notifications");
    expect(params).toEqual([
      "org-1",
      "user-7",
      "reminder_due",
      "enq-1",
      "Reminder due: call Asha Rao",
      null,
    ]);
  });

  it("accepts a caller-supplied client so it can commit with what caused it", async () => {
    const clientQuery = vi.fn().mockResolvedValue({ rows: [row] });
    await createNotification(
      scope,
      { userId: "user-7", kind: "no_contact", title: "No contact for 7 days" },
      { query: clientQuery } as never,
    );
    expect(clientQuery).toHaveBeenCalledOnce();
    expect(query).not.toHaveBeenCalled();
  });
});

describe("listNotifications", () => {
  it("filters to unread when asked and always scopes to one user", async () => {
    await listNotifications(scope, "user-7", { unreadOnly: true });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("read_at IS NULL");
    expect(sql).toContain("user_id = $2");
    expect(params).toEqual(["org-1", "user-7", 50]);
  });
});

describe("markNotificationRead", () => {
  it("requires the notification to belong to that user, not just that org", async () => {
    query.mockResolvedValue({ rows: [] });
    await expect(markNotificationRead(scope, "note-1", "user-9")).resolves.toBeNull();
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("user_id = $3");
    expect(params).toEqual(["org-1", "note-1", "user-9"]);
  });

  it("is idempotent: a second read does not move the timestamp", async () => {
    await markNotificationRead(scope, "note-1", "user-7");
    expect(String(query.mock.calls[0][0])).toContain("read_at = COALESCE(read_at, now())");
  });
});

describe("countUnread", () => {
  it("returns a number, not a string", async () => {
    query.mockResolvedValue({ rows: [{ n: "3" }] });
    await expect(countUnread(scope, "user-7")).resolves.toBe(3);
  });
});
