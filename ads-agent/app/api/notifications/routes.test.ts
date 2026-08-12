import { beforeEach, describe, expect, it, vi } from "vitest";

const { guard, listNotifications, countUnread, markNotificationRead } = vi.hoisted(() => ({
  guard: vi.fn(),
  listNotifications: vi.fn(),
  countUnread: vi.fn(),
  markNotificationRead: vi.fn(),
}));

vi.mock("@/lib/auth/guard", () => ({ guard }));
vi.mock("@/lib/db/notifications", () => ({
  listNotifications,
  countUnread,
  markNotificationRead,
}));

const scope = { kind: "org", orgId: "org-1" } as const;
const session = { userId: "user-7", email: "a@b.c", orgId: "org-1", role: "viewer" as const };

beforeEach(() => {
  guard.mockReset().mockResolvedValue({ ok: true, session, scope });
  listNotifications.mockReset().mockResolvedValue([{ id: "note-1" }]);
  countUnread.mockReset().mockResolvedValue(1);
  markNotificationRead.mockReset().mockResolvedValue({ id: "note-1", readAt: "now" });
});

describe("GET /api/notifications", () => {
  it("returns this user's notifications and the unread count", async () => {
    const { GET } = await import("./route");
    const res = await GET(new Request("http://x/api/notifications?unread=1"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      notifications: [{ id: "note-1" }],
      unread: 1,
    });
    expect(listNotifications).toHaveBeenCalledWith(scope, "user-7", { unreadOnly: true });
  });
});

describe("POST /api/notifications/[id]/read", () => {
  it("404s when the notification is not this user's", async () => {
    markNotificationRead.mockResolvedValue(null);
    const { POST } = await import("./[id]/read/route");
    const res = await POST(new Request("http://x", { method: "POST" }), {
      params: Promise.resolve({ id: "note-other" }),
    });
    expect(res.status).toBe(404);
  });
});
