import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("./client", () => ({ getPool: () => ({ query }) }));

import {
  createCampaignRecord,
  getCampaignById,
  listCampaigns,
  markCampaignActive,
  updateCampaignBudget,
  updateCampaignStatus,
} from "./campaigns";

const row = {
  id: "camp-1",
  platform: "google",
  external_id: null,
  name: "Whitefield Office Search",
  status: "proposed",
  daily_budget: "500",
  corridor: "whitefield",
  created_at: new Date("2026-08-03T00:00:00.000Z"),
};

beforeEach(() => query.mockReset());

describe("createCampaignRecord", () => {
  it("inserts and returns the mapped campaign", async () => {
    query.mockResolvedValue({ rows: [row] });
    const result = await createCampaignRecord({
      platform: "google",
      name: "Whitefield Office Search",
      dailyBudget: 500,
      corridor: "whitefield",
    });
    expect(result).toEqual({
      id: "camp-1",
      platform: "google",
      externalId: null,
      name: "Whitefield Office Search",
      status: "proposed",
      dailyBudget: 500,
      corridor: "whitefield",
      createdAt: "2026-08-03T00:00:00.000Z",
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO campaigns"), [
      "google",
      "Whitefield Office Search",
      500,
      "whitefield",
    ]);
  });
});

describe("listCampaigns", () => {
  it("maps every row", async () => {
    query.mockResolvedValue({ rows: [row, { ...row, id: "camp-2" }] });
    const result = await listCampaigns();
    expect(result).toHaveLength(2);
    expect(result[1].id).toBe("camp-2");
  });
});

describe("getCampaignById", () => {
  it("returns null when no row matches", async () => {
    query.mockResolvedValue({ rows: [] });
    await expect(getCampaignById("missing")).resolves.toBeNull();
  });

  it("returns the mapped campaign when found", async () => {
    query.mockResolvedValue({ rows: [row] });
    await expect(getCampaignById("camp-1")).resolves.toMatchObject({ id: "camp-1" });
  });
});

describe("markCampaignActive", () => {
  it("sets external_id and status to active", async () => {
    query.mockResolvedValue({ rows: [] });
    await markCampaignActive("camp-1", "ext-123");
    expect(query).toHaveBeenCalledWith(expect.stringContaining("UPDATE campaigns"), [
      "camp-1",
      "ext-123",
    ]);
    expect(query.mock.calls[0][0]).toContain("status = 'active'");
  });
});

describe("updateCampaignBudget", () => {
  it("updates daily_budget", async () => {
    query.mockResolvedValue({ rows: [] });
    await updateCampaignBudget("camp-1", 750);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("daily_budget = $2"), [
      "camp-1",
      750,
    ]);
  });
});

describe("updateCampaignStatus", () => {
  it("updates status", async () => {
    query.mockResolvedValue({ rows: [] });
    await updateCampaignStatus("camp-1", "paused");
    expect(query).toHaveBeenCalledWith(expect.stringContaining("status = $2"), [
      "camp-1",
      "paused",
    ]);
  });
});
