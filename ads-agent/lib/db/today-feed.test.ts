import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("./tx", () => ({
  withTenantTransaction: async (_scope: unknown, fn: (c: unknown) => Promise<unknown>) =>
    fn({ query }),
}));

import { getTodayFeed } from "./today-feed";

const scope = { kind: "org", orgId: "org-1" } as const;

beforeEach(() => query.mockReset().mockResolvedValue({ rows: [] }));

describe("getTodayFeed", () => {
  it("asks three questions and returns three lists", async () => {
    query
      .mockResolvedValueOnce({
        rows: [
          {
            id: "rem-1",
            due_at: new Date("2026-08-14T04:00:00.000Z"),
            note: "Call back",
            enquiry_id: "enq-1",
            contact_name: "Asha Rao",
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "enq-2",
            contact_name: "Bala",
            listing_url: null,
            first_seen_at: new Date("2026-08-13T04:00:00.000Z"),
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: "enq-3",
            contact_name: "Chitra",
            last_activity_at: new Date("2026-08-01T04:00:00.000Z"),
            days_since: "13",
          },
        ],
      });

    const feed = await getTodayFeed(scope, { now: new Date("2026-08-14T05:00:00.000Z") });

    expect(feed.dueReminders).toEqual([
      {
        id: "rem-1",
        dueAt: "2026-08-14T04:00:00.000Z",
        note: "Call back",
        enquiryId: "enq-1",
        contactName: "Asha Rao",
      },
    ]);
    expect(feed.waitingEnquiries).toEqual([
      {
        id: "enq-2",
        contactName: "Bala",
        listingUrl: null,
        firstSeenAt: "2026-08-13T04:00:00.000Z",
      },
    ]);
    expect(feed.noContactSince).toEqual([
      {
        id: "enq-3",
        contactName: "Chitra",
        lastActivityAt: "2026-08-01T04:00:00.000Z",
        daysSince: 13,
      },
    ]);
  });

  it("computes no-contact from last_activity_at rather than storing it (C6)", async () => {
    await getTodayFeed(scope, { noContactDays: 14 });
    const staleQuery = String(query.mock.calls[2][0]);
    expect(staleQuery).toContain("last_activity_at");
    expect(staleQuery).toContain("interval");
    expect(query.mock.calls[2][1]).toContain(14);
  });

  it("defaults the no-contact window to seven days", async () => {
    await getTodayFeed(scope);
    expect(query.mock.calls[2][1]).toContain(7);
  });

  it("filters reminders to one user when asked", async () => {
    await getTodayFeed(scope, { userId: "user-7" });
    expect(String(query.mock.calls[0][0])).toContain("user_id = $2");
  });
});
