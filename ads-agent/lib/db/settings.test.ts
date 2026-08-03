import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("./client", () => ({ getPool: () => ({ query }) }));

import { getCronSettings, setCronEnabled, touchLastRunAt } from "./settings";

beforeEach(() => query.mockReset());

describe("getCronSettings", () => {
  it("maps the single settings row", async () => {
    query.mockResolvedValue({
      rows: [{ enabled: false, last_run_at: null }],
    });
    await expect(getCronSettings()).resolves.toEqual({ enabled: false, lastRunAt: null });
  });

  it("maps a set last_run_at", async () => {
    query.mockResolvedValue({
      rows: [{ enabled: true, last_run_at: new Date("2026-08-03T06:00:00.000Z") }],
    });
    await expect(getCronSettings()).resolves.toEqual({
      enabled: true,
      lastRunAt: "2026-08-03T06:00:00.000Z",
    });
  });
});

describe("setCronEnabled", () => {
  it("updates the enabled flag on row id=1", async () => {
    query.mockResolvedValue({ rows: [] });
    await setCronEnabled(true);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("WHERE id = 1"), [true]);
  });
});

describe("touchLastRunAt", () => {
  it("sets last_run_at to now", async () => {
    query.mockResolvedValue({ rows: [] });
    await touchLastRunAt();
    expect(query).toHaveBeenCalledWith(expect.stringContaining("last_run_at = NOW()"));
  });
});
