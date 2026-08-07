import { beforeEach, describe, expect, it, vi } from "vitest";

const { listOpportunities, getOpportunity, updateOpportunityStage, logAiAction, toOpenUiOpportunityCard } = vi.hoisted(
  () => ({
    listOpportunities: vi.fn(),
    getOpportunity: vi.fn(),
    updateOpportunityStage: vi.fn(),
    logAiAction: vi.fn(),
    toOpenUiOpportunityCard: vi.fn((o: {
      name: string;
      stage?: string;
      tier?: string | null;
      amountInr?: number | null;
      maskedPhone?: string | null;
      source?: string | null;
    }) => ({
      name: o.name,
      stage: o.stage ?? "NEW_BRIEF",
      tier: o.tier ?? "UNSCORED",
      amountLabel: o.amountInr != null ? `₹${o.amountInr}` : "",
      maskedPhone: o.maskedPhone ?? "",
      source: o.source ?? "",
    })),
  }),
);
vi.mock("../crm/twenty-pipeline", () => ({
  listOpportunities,
  getOpportunity,
  updateOpportunityStage,
  toOpenUiOpportunityCard,
  PIPELINE_STAGES: [
    { value: "NEW_BRIEF", label: "New Brief" },
    { value: "SHORTLIST", label: "Shortlist" },
  ],
}));
vi.mock("../db/ai-action-log", () => ({ logAiAction }));

import { crmToolProvider, crmToolSpecs, crmReadToolSpecs } from "./crm-tools";

beforeEach(() => {
  listOpportunities.mockReset();
  getOpportunity.mockReset();
  updateOpportunityStage.mockReset();
  logAiAction.mockReset();
  toOpenUiOpportunityCard.mockClear();
});

describe("crmToolSpecs", () => {
  it("declares the four CRM tools by name", () => {
    expect(crmToolSpecs.map((s) => s.name).sort()).toEqual(
      ["advance_opportunity_stage", "get_opportunity", "list_opportunities", "search_opportunities"].sort(),
    );
  });

  it("exposes read-only specs without the stage mutation", () => {
    expect(crmReadToolSpecs.map((s) => s.name).sort()).toEqual(
      ["get_opportunity", "list_opportunities", "search_opportunities"].sort(),
    );
  });
});

describe("crmToolProvider.list_opportunities", () => {
  it("returns OpenUI OpportunityCard rows (not raw Twenty/board fields)", async () => {
    listOpportunities.mockResolvedValue([
      {
        id: "1",
        name: "Priya",
        stage: "SHORTLIST",
        tier: "HOT",
        amountInr: 15000,
        contactName: null,
        maskedPhone: null,
        source: "WhatsApp",
        listingName: null,
        createdAt: "",
      },
    ]);
    const result = await crmToolProvider.list_opportunities({});
    expect(toOpenUiOpportunityCard).toHaveBeenCalled();
    expect(result).toEqual([
      { name: "Priya", stage: "SHORTLIST", tier: "HOT", amountLabel: "₹15000", maskedPhone: "", source: "WhatsApp" },
    ]);
    expect(result[0]).not.toHaveProperty("id");
    expect(result[0]).not.toHaveProperty("amountInr");
  });
});

describe("crmToolProvider.search_opportunities", () => {
  it("filters by case-insensitive name substring then maps to OpenUI rows", async () => {
    listOpportunities.mockResolvedValue([
      { id: "1", name: "Priya Sharma", stage: "TOUR", tier: null, amountInr: null, contactName: null, maskedPhone: null, source: null, listingName: null, createdAt: "" },
      { id: "2", name: "Rohan Mehta", stage: "TOUR", tier: null, amountInr: null, contactName: null, maskedPhone: null, source: null, listingName: null, createdAt: "" },
    ]);
    const result = await crmToolProvider.search_opportunities({ query: "priya" });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Priya Sharma");
  });
});

describe("crmToolProvider.get_opportunity", () => {
  it("delegates to getOpportunity by id and returns an OpenUI card row", async () => {
    getOpportunity.mockResolvedValue({
      id: "1",
      name: "Priya",
      stage: "NEW_BRIEF",
      tier: null,
      amountInr: null,
      contactName: null,
      maskedPhone: null,
      source: null,
      listingName: null,
      createdAt: "",
    });
    const result = await crmToolProvider.get_opportunity({ id: "1" });
    expect(getOpportunity).toHaveBeenCalledWith("1");
    expect(result).toMatchObject({ name: "Priya", stage: "NEW_BRIEF" });
    expect(result).not.toHaveProperty("id");
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
