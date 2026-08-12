// ads-agent/lib/crm/twenty-pipeline.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const listOpportunitiesMock = vi.fn();
const getOpportunityMock = vi.fn();
const updateOpportunityStageMock = vi.fn();
vi.mock("./twenty-client", () => ({
  getTwentyClient: async () => ({
    orgId: "org-1",
    version: "1.9.0",
    listOpportunities: listOpportunitiesMock,
    getOpportunity: getOpportunityMock,
    updateOpportunityStage: updateOpportunityStageMock,
  }),
}));

import {
  PIPELINE_STAGES,
  fetchLeadSignal,
  formatAmountLabelInr,
  getOpportunity,
  getPipelineValue,
  listOpportunities,
  maskPhone,
  reshapeTwentyOpportunityToolResult,
  toOpenUiOpportunityCard,
  updateOpportunityStage,
} from "./twenty-pipeline";

const scope = { kind: "org", orgId: "org-1" } as const;
const PLATFORM = { kind: "platform" as const, orgId: "00000000-0000-0000-0000-000000000001" };

beforeEach(() => {
  listOpportunitiesMock.mockReset();
  getOpportunityMock.mockReset();
  updateOpportunityStageMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PIPELINE_STAGES", () => {
  it("has the 7 real configured Twenty stages, in order", () => {
    expect(PIPELINE_STAGES.map((s) => s.value)).toEqual([
      "NEW_BRIEF", "SHORTLIST", "TOUR", "NEGOTIATE", "LEGAL", "HANDOVER", "RENEWAL",
    ]);
    expect(PIPELINE_STAGES[0].label).toBe("New Brief");
  });
});

describe("maskPhone", () => {
  it("masks all but the last 4 digits, keeping the country code visible", () => {
    expect(maskPhone("+918800001234")).toBe("+91 8XXXXX-1234");
  });
  it("returns an empty-safe placeholder for a missing/short number", () => {
    expect(maskPhone("")).toBe("—");
    expect(maskPhone("123")).toBe("—");
  });
});

describe("listOpportunities", () => {
  it("calls the Twenty REST client and maps records into typed rows", async () => {
    listOpportunitiesMock.mockResolvedValue({
      records: [
        {
          id: "opp-1",
          name: "Office: Priya Sharma",
          stage: "SHORTLIST",
          tier: "HOT",
          amount: { amountMicros: 15000000000, currencyCode: "INR" },
          pointOfContact: { name: { firstName: "Priya", lastName: "Sharma" }, phones: { primaryPhoneNumber: "8800001234", primaryPhoneCallingCode: "+91" } },
          source: "WhatsApp",
          listingName: "Koramangala",
          createdAt: "2026-08-01T00:00:00.000Z",
        },
      ],
      pageInfo: {},
    });

    const rows = await listOpportunities(scope);

    expect(listOpportunitiesMock).toHaveBeenCalledWith(200);
    expect(rows).toEqual([
      {
        id: "opp-1", name: "Office: Priya Sharma", stage: "SHORTLIST", tier: "HOT",
        amountInr: 15000, contactName: "Priya Sharma", maskedPhone: "+91 8XXXXX-1234",
        source: "WhatsApp", listingName: "Koramangala", createdAt: "2026-08-01T00:00:00.000Z",
      },
    ]);
  });

  it("maps a bare array payload into typed rows", async () => {
    listOpportunitiesMock.mockResolvedValue([
      {
        id: "opp-1",
        name: "API Integration Deal",
        stage: "NEW_BRIEF",
        amount: { amountMicros: 75000000000, currencyCode: "USD" },
        pointOfContact: { name: { firstName: "Patrick", lastName: "Collison" } },
        createdAt: "2026-01-25T16:26:00.000Z",
      },
    ]);
    const rows = await listOpportunities(scope);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("API Integration Deal");
    expect(rows[0].amountInr).toBe(75000);
  });

  it("maps Twenty REST { data: { opportunities } } payloads", async () => {
    listOpportunitiesMock.mockResolvedValue({
      data: {
        opportunities: [
          { id: "opp-1", name: "REST Deal", stage: "TOUR", tier: "WARM", createdAt: "2026-08-01T00:00:00.000Z" },
        ],
      },
    });
    const rows = await listOpportunities(scope);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("REST Deal");
  });

  it("returns an empty board and logs the org when the client throws", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    listOpportunitiesMock.mockRejectedValue(new Error("no Twenty connection for org org-1"));
    await expect(listOpportunities(scope)).resolves.toEqual([]);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

describe("getOpportunity", () => {
  it("calls getOpportunity on the client and maps the single record", async () => {
    getOpportunityMock.mockResolvedValue({
      id: "opp-1", name: "Office: Priya Sharma", stage: "SHORTLIST", tier: "HOT",
      amount: null, pointOfContact: null, source: "WhatsApp", listingName: null,
      createdAt: "2026-08-01T00:00:00.000Z",
    });

    const row = await getOpportunity(scope, "opp-1");

    expect(getOpportunityMock).toHaveBeenCalledWith("opp-1");
    expect(row?.id).toBe("opp-1");
    expect(row?.amountInr).toBeNull();
    expect(row?.contactName).toBeNull();
  });

  it("returns null when the client throws", async () => {
    getOpportunityMock.mockRejectedValue(new Error("not found"));
    expect(await getOpportunity(scope, "missing")).toBeNull();
  });
});

describe("updateOpportunityStage", () => {
  it("calls updateOpportunityStage on the client and returns ok:true on success", async () => {
    updateOpportunityStageMock.mockResolvedValue(undefined);

    const result = await updateOpportunityStage(scope, "opp-1", "TOUR");

    expect(result).toEqual({ ok: true });
    expect(updateOpportunityStageMock).toHaveBeenCalledWith("opp-1", "TOUR");
  });

  it("returns ok:false with an error message when the client throws", async () => {
    updateOpportunityStageMock.mockRejectedValue(new Error("bad stage"));
    const result = await updateOpportunityStage(scope, "opp-1", "TOUR");
    expect(result).toEqual({ ok: false, error: expect.stringContaining("bad stage") });
  });
});

describe("getPipelineValue", () => {
  it("sums amountInr across all open opportunities", async () => {
    listOpportunitiesMock.mockResolvedValue({
      records: [
        { id: "1", name: "A", stage: "NEW_BRIEF", tier: "HOT", amount: { amountMicros: 10000000000 }, pointOfContact: null, source: null, listingName: null, createdAt: "" },
        { id: "2", name: "B", stage: "RENEWAL", tier: "COLD", amount: { amountMicros: 5000000000 }, pointOfContact: null, source: null, listingName: null, createdAt: "" },
        { id: "3", name: "C", stage: "TOUR", tier: "WARM", amount: null, pointOfContact: null, source: null, listingName: null, createdAt: "" },
      ],
    });
    expect(await getPipelineValue(PLATFORM)).toBe(15000);
  });
});

describe("fetchLeadSignal", () => {
  it("counts opportunities by tier from REST payloads", async () => {
    listOpportunitiesMock.mockResolvedValue({
      data: {
        opportunities: [
          { id: "1", name: "A", stage: "NEW_BRIEF", tier: "HOT", createdAt: "" },
          { id: "2", name: "B", stage: "NEW_BRIEF", tier: "HOT", createdAt: "" },
          { id: "3", name: "C", stage: "NEW_BRIEF", tier: "WARM", createdAt: "" },
          { id: "4", name: "D", stage: "NEW_BRIEF", tier: "COLD", createdAt: "" },
          { id: "5", name: "E", stage: "NEW_BRIEF", tier: "UNSCORED", createdAt: "" },
          { id: "6", name: "F", stage: "NEW_BRIEF", tier: null, createdAt: "" },
        ],
      },
    });
    await expect(fetchLeadSignal(scope)).resolves.toEqual({
      hotCount: 2,
      warmCount: 1,
      coldCount: 1,
      unscoredCount: 2,
    });
  });

  it("returns all zeros when readOpportunities fails", async () => {
    listOpportunitiesMock.mockRejectedValue(new Error("no connection"));
    await expect(fetchLeadSignal(scope)).resolves.toEqual({
      hotCount: 0,
      warmCount: 0,
      coldCount: 0,
      unscoredCount: 0,
    });
  });
});

describe("reshapeTwentyOpportunityToolResult", () => {
  const fatRecord = {
    id: "opp-1",
    name: "Office: Priya Sharma",
    stage: "SHORTLIST",
    tier: "HOT",
    amount: { amountMicros: 15000000000, currencyCode: "INR" },
    pointOfContact: {
      name: { firstName: "Priya", lastName: "Sharma" },
      phones: { primaryPhoneNumber: "8800001234", primaryPhoneCallingCode: "+91" },
    },
    source: "WhatsApp",
    listingName: "Koramangala",
    createdAt: "2026-08-01T00:00:00.000Z",
    companyId: "co-1",
    ownerId: "user-1",
    probability: 0.4,
    closeDate: "2026-09-01",
  };

  const openUiCard = {
    name: "Office: Priya Sharma",
    stage: "SHORTLIST",
    tier: "HOT",
    amountLabel: "₹15,000",
    maskedPhone: "+91 8XXXXX-1234",
    source: "WhatsApp",
  };

  it("maps list_opportunities {records} to OpenUI card rows only (preserves all records)", () => {
    const reshaped = reshapeTwentyOpportunityToolResult("list_opportunities", {
      records: [fatRecord, { ...fatRecord, id: "opp-2", name: "Office: Rohan", tier: null }],
      pageInfo: { hasNextPage: false },
    });
    expect(reshaped).toEqual([
      openUiCard,
      { ...openUiCard, name: "Office: Rohan", tier: "UNSCORED" },
    ]);
    expect(Object.keys((reshaped as object[])[0])).toEqual([
      "name", "stage", "tier", "amountLabel", "maskedPhone", "source",
    ]);
  });

  it("maps get_opportunity single record to one OpenUI card row", () => {
    expect(reshapeTwentyOpportunityToolResult("get_opportunity", fatRecord)).toEqual(openUiCard);
  });

  it("returns null for get_opportunity when the payload is empty", () => {
    expect(reshapeTwentyOpportunityToolResult("get_opportunity", null)).toBeNull();
  });

  it("passes through unknown tool payloads unchanged", () => {
    const raw = { ok: true };
    expect(reshapeTwentyOpportunityToolResult("update_opportunity", raw)).toBe(raw);
  });
});

describe("formatAmountLabelInr / toOpenUiOpportunityCard", () => {
  it("formats INR amounts and defaults null tier to UNSCORED", () => {
    expect(formatAmountLabelInr(15000)).toBe("₹15,000");
    expect(formatAmountLabelInr(null)).toBe("");
    expect(
      toOpenUiOpportunityCard({
        id: "1",
        name: "A",
        stage: "TOUR",
        tier: null,
        amountInr: null,
        contactName: null,
        maskedPhone: null,
        source: null,
        listingName: null,
        createdAt: "",
      }),
    ).toEqual({
      name: "A",
      stage: "TOUR",
      tier: "UNSCORED",
      amountLabel: "",
      maskedPhone: "",
      source: "",
    });
  });
});
