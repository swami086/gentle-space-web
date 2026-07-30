import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();

vi.mock("./client", () => ({
  getPool: () => ({ query }),
}));

import { finishSyncRun, getLatestSuccessfulSync } from "./sync-runs";

beforeEach(() => {
  query.mockReset();
  delete process.env.DATABASE_URL;
});

describe("getLatestSuccessfulSync", () => {
  it("returns null when DATABASE_URL is unset", async () => {
    await expect(getLatestSuccessfulSync()).resolves.toBeNull();
    expect(query).not.toHaveBeenCalled();
  });

  it("falls back to empty source outcomes when absent", async () => {
    process.env.DATABASE_URL = "postgres://local/test";
    query.mockResolvedValue({
      rows: [
        {
          id: "run-1",
          started_at: new Date("2026-07-30T00:00:00.000Z"),
          finished_at: new Date("2026-07-30T00:05:00.000Z"),
          status: "success",
          count: 10,
          error: null,
          sources: null,
        },
      ],
    });

    await expect(getLatestSuccessfulSync()).resolves.toMatchObject({
      id: "run-1",
      status: "success",
      count: 10,
      sources: {},
    });
  });
});

describe("finishSyncRun", () => {
  it("serializes per-source outcomes into sync_runs", async () => {
    query.mockResolvedValue({ rows: [] });

    await finishSyncRun("run-1", "success", 12, null, {
      coworker: {
        status: "success",
        discovered: 12,
        scraped: 5,
        inserted: 2,
        updated: 2,
        unchanged: 1,
        hidden: 0,
        error: null,
      },
    });

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("sources = $5::jsonb"),
      [
        "run-1",
        "success",
        12,
        null,
        JSON.stringify({
          coworker: {
            status: "success",
            discovered: 12,
            scraped: 5,
            inserted: 2,
            updated: 2,
            unchanged: 1,
            hidden: 0,
            error: null,
          },
        }),
      ],
    );
  });
});
