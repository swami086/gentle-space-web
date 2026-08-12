import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenUiOpportunityListResult } from "./crm-tools";

const PLATFORM = { kind: "platform" as const, orgId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" };

const { listOpportunities, getOpportunity, updateOpportunityStage, writeAudit, toOpenUiOpportunityCard } = vi.hoisted(
  () => ({
    listOpportunities: vi.fn(),
    getOpportunity: vi.fn(),
    updateOpportunityStage: vi.fn(),
    writeAudit: vi.fn(),
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
vi.mock("../db/audit-log", () => ({ writeAudit }));

import { crmToolHandlers, crmToolSpecs, crmReadToolSpecs } from "./crm-tools";

beforeEach(() => {
  listOpportunities.mockReset();
  getOpportunity.mockReset();
  updateOpportunityStage.mockReset();
  writeAudit.mockReset();
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

describe("crmToolHandlers.list_opportunities", () => {
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
    const result = (await crmToolHandlers.list_opportunities!(PLATFORM, {})) as OpenUiOpportunityListResult;
    expect(toOpenUiOpportunityCard).toHaveBeenCalled();
    expect(result).toEqual({
      opportunities: [
        { name: "Priya", stage: "SHORTLIST", tier: "HOT", amountLabel: "₹15000", maskedPhone: "", source: "WhatsApp" },
      ],
    });
    expect(result.opportunities[0]).not.toHaveProperty("id");
    expect(result.opportunities[0]).not.toHaveProperty("amountInr");
  });
});

describe("crmToolHandlers.search_opportunities", () => {
  it("filters by case-insensitive name substring then maps to OpenUI rows", async () => {
    listOpportunities.mockResolvedValue([
      { id: "1", name: "Priya Sharma", stage: "TOUR", tier: null, amountInr: null, contactName: null, maskedPhone: null, source: null, listingName: null, createdAt: "" },
      { id: "2", name: "Rohan Mehta", stage: "TOUR", tier: null, amountInr: null, contactName: null, maskedPhone: null, source: null, listingName: null, createdAt: "" },
    ]);
    const result = (await crmToolHandlers.search_opportunities!(PLATFORM, { query: "priya" })) as OpenUiOpportunityListResult;
    expect(result.opportunities).toHaveLength(1);
    expect(result.opportunities[0]!.name).toBe("Priya Sharma");
  });
});

describe("crmToolHandlers.get_opportunity", () => {
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
    const result = await crmToolHandlers.get_opportunity!(PLATFORM, { id: "1" });
    expect(getOpportunity).toHaveBeenCalledWith(PLATFORM, "1");
    expect(result).toMatchObject({ name: "Priya", stage: "NEW_BRIEF" });
    expect(result).not.toHaveProperty("id");
  });
});

describe("crmToolHandlers.advance_opportunity_stage", () => {
  it("updates the stage and writes an audit entry on success", async () => {
    getOpportunity.mockResolvedValue({ id: "1", stage: "NEW_BRIEF" });
    updateOpportunityStage.mockResolvedValue({ ok: true });
    const result = await crmToolHandlers.advance_opportunity_stage!(PLATFORM, {
      id: "1",
      opportunityName: "Priya Sharma",
      toStage: "SHORTLIST",
    });
    expect(result).toEqual({ ok: true });
    expect(updateOpportunityStage).toHaveBeenCalledWith(PLATFORM, "1", "SHORTLIST");
    expect(writeAudit).toHaveBeenCalledWith(PLATFORM, {
      actorType: "agent",
      action: "opportunity.stage_changed",
      entityType: "opportunity",
      before: { stage: "NEW_BRIEF" },
      after: { stage: "SHORTLIST", opportunityName: "Priya Sharma" },
    });
  });

  it("does not audit when the update fails", async () => {
    getOpportunity.mockResolvedValue({ id: "1", stage: "NEW_BRIEF" });
    updateOpportunityStage.mockResolvedValue({ ok: false, error: "boom" });
    const result = await crmToolHandlers.advance_opportunity_stage!(PLATFORM, {
      id: "1",
      opportunityName: "Priya Sharma",
      toStage: "SHORTLIST",
    });
    expect(result).toEqual({ ok: false, error: "boom" });
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("rejects an unknown stage value rather than calling updateOpportunityStage", async () => {
    const result = await crmToolHandlers.advance_opportunity_stage!(PLATFORM, {
      id: "1",
      opportunityName: "Priya Sharma",
      toStage: "NOT_A_REAL_STAGE",
    });
    expect(result).toEqual({ ok: false, error: expect.stringContaining("unknown stage") });
    expect(updateOpportunityStage).not.toHaveBeenCalled();
  });
});
