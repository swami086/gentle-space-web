import { beforeEach, describe, expect, it, vi } from "vitest";

const { query, logReminderSet } = vi.hoisted(() => ({
  query: vi.fn(),
  logReminderSet: vi.fn(),
}));
vi.mock("./tx", () => ({
  withTenantTransaction: async (_scope: unknown, fn: (c: unknown) => Promise<unknown>) =>
    fn({ query }),
}));
vi.mock("./enquiry-activities", () => ({ logReminderSet }));

import { createReminder, listPendingReminders, setReminderState } from "./reminders";

const scope = { kind: "org", orgId: "org-1" } as const;

const row = {
  id: "rem-1",
  org_id: "org-1",
  enquiry_id: "enq-1",
  user_id: "user-7",
  due_at: new Date("2026-08-14T04:30:00.000Z"),
  note: "Call back about the tour",
  state: "pending",
  created_at: new Date("2026-08-12T04:30:00.000Z"),
};

beforeEach(() => {
  query.mockReset().mockResolvedValue({ rows: [row] });
  logReminderSet.mockReset().mockResolvedValue(undefined);
});

describe("createReminder", () => {
  it("stores the reminder and logs it on the enquiry's timeline", async () => {
    const reminder = await createReminder(scope, {
      enquiryId: "enq-1",
      userId: "user-7",
      dueAt: "2026-08-14T04:30:00.000Z",
      note: "Call back about the tour",
    });
    expect(reminder.state).toBe("pending");
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("INSERT INTO adsagent.reminders");
    expect(params).toEqual([
      "org-1",
      "enq-1",
      "user-7",
      "2026-08-14T04:30:00.000Z",
      "Call back about the tour",
    ]);
    expect(logReminderSet).toHaveBeenCalledWith(scope, {
      enquiryId: "enq-1",
      actorUserId: "user-7",
      body: "Reminder set for 2026-08-14T04:30:00.000Z",
    });
  });

  it("does not log a timeline entry for a reminder with no enquiry", async () => {
    await createReminder(scope, {
      enquiryId: null,
      userId: "user-7",
      dueAt: "2026-08-14T04:30:00.000Z",
    });
    expect(logReminderSet).not.toHaveBeenCalled();
  });

  it("rejects a due date in the past, which would fire immediately and look broken", async () => {
    await expect(
      createReminder(scope, {
        enquiryId: null,
        userId: "user-7",
        dueAt: "2020-01-01T00:00:00.000Z",
      }),
    ).rejects.toThrow(/dueAt must be in the future/i);
  });
});

describe("listPendingReminders", () => {
  it("uses the partial-index predicate and orders by due date", async () => {
    await listPendingReminders(scope, { userId: "user-7" });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("state = 'pending'");
    expect(sql).toContain("ORDER BY due_at");
    expect(params).toEqual(["org-1", "user-7"]);
  });
});

describe("setReminderState", () => {
  it("returns null when nothing matched, which the route turns into a 404", async () => {
    query.mockResolvedValue({ rows: [] });
    await expect(setReminderState(scope, "rem-other", "done")).resolves.toBeNull();
  });

  it("rejects a state outside the vocabulary", async () => {
    await expect(setReminderState(scope, "rem-1", "snoozed" as never)).rejects.toThrow(
      /state must be one of/i,
    );
  });
});
