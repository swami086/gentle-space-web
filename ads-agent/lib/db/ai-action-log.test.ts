import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("./client", () => ({ getPool: () => ({ query }) }));

import { countAiActionsToday, listRecentAiActions, logAiAction } from "./ai-action-log";

beforeEach(() => query.mockReset());

describe("logAiAction", () => {
  it("inserts a domain + summary row", async () => {
    query.mockResolvedValue({ rows: [] });
    await logAiAction({ domain: "crm", summary: "Advanced Priya Sharma to Tour" });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO ai_action_log"),
      ["crm", "Advanced Priya Sharma to Tour"],
    );
  });
});

describe("countAiActionsToday", () => {
  it("returns the count of rows created since midnight", async () => {
    query.mockResolvedValue({ rows: [{ count: "3" }] });
    expect(await countAiActionsToday()).toBe(3);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("date_trunc('day'"));
  });
});

describe("listRecentAiActions", () => {
  it("maps rows to typed entries, most recent first", async () => {
    query.mockResolvedValue({
      rows: [
        { id: "1", domain: "marketing", summary: "Created 2 proposals", created_at: new Date("2026-08-05T10:00:00Z") },
        { id: "2", domain: "crm", summary: "Advanced Priya Sharma to Tour", created_at: new Date("2026-08-05T09:00:00Z") },
      ],
    });
    const rows = await listRecentAiActions(5);
    expect(rows).toEqual([
      { id: "1", domain: "marketing", summary: "Created 2 proposals", createdAt: "2026-08-05T10:00:00.000Z" },
      { id: "2", domain: "crm", summary: "Advanced Priya Sharma to Tour", createdAt: "2026-08-05T09:00:00.000Z" },
    ]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("ORDER BY created_at DESC"), [5]);
  });
});
