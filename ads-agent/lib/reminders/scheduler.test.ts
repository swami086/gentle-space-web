import { beforeEach, describe, expect, it, vi } from "vitest";

const { claimDueReminders, createNotification, query } = vi.hoisted(() => ({
  claimDueReminders: vi.fn(),
  createNotification: vi.fn(),
  query: vi.fn(),
}));

vi.mock("../db/cross-tenant", () => ({
  withCrossTenantRead: async (_actor: string, fn: (c: unknown) => Promise<unknown>) => fn({ query }),
}));
vi.mock("../db/reminders", () => ({ claimDueReminders }));
vi.mock("../db/notifications", () => ({ createNotification }));
vi.mock("../db/tx", () => ({
  withTenantTransaction: async (_scope: unknown, fn: (c: unknown) => Promise<unknown>) =>
    fn({ query }),
}));

import { fireDueReminders } from "./scheduler";

const reminder = {
  id: "rem-1",
  orgId: "org-1",
  enquiryId: "enq-1",
  userId: "user-7",
  dueAt: "2026-08-14T04:00:00.000Z",
  note: "Call back about the tour",
  state: "pending" as const,
  createdAt: "2026-08-12T04:00:00.000Z",
};

beforeEach(() => {
  claimDueReminders.mockReset().mockResolvedValue([]);
  createNotification.mockReset().mockResolvedValue({ id: "note-1" });
  query.mockReset().mockResolvedValue({ rows: [], rowCount: 1 });
});

describe("fireDueReminders", () => {
  it("notifies the owning user and marks the reminder fired in one transaction", async () => {
    claimDueReminders.mockResolvedValue([reminder]);
    await expect(fireDueReminders(new Date("2026-08-14T05:00:00.000Z"))).resolves.toEqual({
      fired: 1,
    });
    expect(createNotification).toHaveBeenCalledWith(
      { kind: "org", orgId: "org-1" },
      {
        userId: "user-7",
        kind: "reminder_due",
        enquiryId: "enq-1",
        title: "Reminder due",
        body: "Call back about the tour",
      },
      expect.anything(),
    );
    const statements = query.mock.calls.map((c) => String(c[0]));
    expect(statements.some((s) => s.includes("state = 'fired'"))).toBe(true);
  });

  it("does nothing when nothing is due", async () => {
    await expect(fireDueReminders()).resolves.toEqual({ fired: 0 });
    expect(createNotification).not.toHaveBeenCalled();
  });

  it("keeps going after one org fails, so one bad tenant cannot stall the rest", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    claimDueReminders.mockResolvedValue([reminder, { ...reminder, id: "rem-2", orgId: "org-2" }]);
    createNotification.mockRejectedValueOnce(new Error("boom"));
    await expect(fireDueReminders()).resolves.toEqual({ fired: 1 });
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
