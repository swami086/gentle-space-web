import { beforeEach, describe, expect, it, vi } from "vitest";

const { listOpportunities, getOpportunity, updateOpportunityStage, logAiAction } = vi.hoisted(() => ({
  listOpportunities: vi.fn(),
  getOpportunity: vi.fn(),
  updateOpportunityStage: vi.fn(),
  logAiAction: vi.fn(),
}));
vi.mock("../crm/twenty-pipeline", () => ({
  listOpportunities,
  getOpportunity,
  updateOpportunityStage,
  PIPELINE_STAGES: [
    { value: "NEW_BRIEF", label: "New Brief" },
    { value: "SHORTLIST", label: "Shortlist" },
  ],
}));
vi.mock("../db/ai-action-log", () => ({ logAiAction }));

import { crmToolProvider, crmToolSpecs } from "./crm-tools";

beforeEach(() => {
  listOpportunities.mockReset();
  getOpportunity.mockReset();
  updateOpportunityStage.mockReset();
  logAiAction.mockReset();
});

describe("crmToolSpecs", () => {
  it("declares the four CRM tools by name", () => {
    expect(crmToolSpecs.map((s) => s.name).sort()).toEqual(
      ["advance_opportunity_stage", "get_opportunity", "list_opportunities", "search_opportunities"].sort(),
    );
  });
});

describe("crmToolProvider.list_opportunities", () => {
  it("returns every opportunity when no filter is given", async () => {
    listOpportunities.mockResolvedValue([{ id: "1", name: "Priya" }]);
    const result = await crmToolProvider.list_opportunities({});
    expect(result).toEqual([{ id: "1", name: "Priya" }]);
  });
});

describe("crmToolProvider.search_opportunities", () => {
  it("filters by case-insensitive name substring", async () => {
    listOpportunities.mockResolvedValue([{ id: "1", name: "Priya Sharma" }, { id: "2", name: "Rohan Mehta" }]);
    const result = await crmToolProvider.search_opportunities({ query: "priya" });
    expect(result).toEqual([{ id: "1", name: "Priya Sharma" }]);
  });
});

describe("crmToolProvider.get_opportunity", () => {
  it("delegates to getOpportunity by id", async () => {
    getOpportunity.mockResolvedValue({ id: "1", name: "Priya" });
    const result = await crmToolProvider.get_opportunity({ id: "1" });
    expect(result).toEqual({ id: "1", name: "Priya" });
    expect(getOpportunity).toHaveBeenCalledWith("1");
  });
});

describe("crmToolProvider.advance_opportunity_stage", () => {
  it("updates the stage and logs an ai_action_log entry on success", async () => {
    updateOpportunityStage.mockResolvedValue({ ok: true });
    const result = await crmToolProvider.advance_opportunity_stage({
      id: "1",
      opportunityName: "Priya Sharma",
      toStage: "SHORTLIST",
    });
    expect(result).toEqual({ ok: true });
    expect(updateOpportunityStage).toHaveBeenCalledWith("1", "SHORTLIST");
    expect(logAiAction).toHaveBeenCalledWith({ domain: "crm", summary: "Advanced Priya Sharma to Shortlist" });
  });

  it("does not log when the update fails", async () => {
    updateOpportunityStage.mockResolvedValue({ ok: false, error: "boom" });
    const result = await crmToolProvider.advance_opportunity_stage({
      id: "1",
      opportunityName: "Priya Sharma",
      toStage: "SHORTLIST",
    });
    expect(result).toEqual({ ok: false, error: "boom" });
    expect(logAiAction).not.toHaveBeenCalled();
  });

  it("rejects an unknown stage value rather than calling updateOpportunityStage", async () => {
    const result = await crmToolProvider.advance_opportunity_stage({
      id: "1",
      opportunityName: "Priya Sharma",
      toStage: "NOT_A_REAL_STAGE",
    });
    expect(result).toEqual({ ok: false, error: expect.stringContaining("unknown stage") });
    expect(updateOpportunityStage).not.toHaveBeenCalled();
  });
});
