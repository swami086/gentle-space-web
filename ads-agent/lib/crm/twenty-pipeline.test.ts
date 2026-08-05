// ads-agent/lib/crm/twenty-pipeline.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { callTwentyTool } = vi.hoisted(() => ({ callTwentyTool: vi.fn() }));
vi.mock("../bifrost/mcp-client", () => ({ callTwentyTool }));

import {
  PIPELINE_STAGES,
  getOpportunity,
  getPipelineValue,
  listOpportunities,
  maskPhone,
  updateOpportunityStage,
} from "./twenty-pipeline";

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env.TWENTY_API_KEY = "test-key";
  callTwentyTool.mockReset();
});

afterEach(() => {
  process.env = { ...originalEnv };
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
  it("calls the list_opportunities MCP tool and maps records into typed rows", async () => {
    callTwentyTool.mockResolvedValue({
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

    const rows = await listOpportunities();

    expect(callTwentyTool).toHaveBeenCalledWith("list_opportunities", { limit: 200 });
    expect(rows).toEqual([
      {
        id: "opp-1", name: "Office: Priya Sharma", stage: "SHORTLIST", tier: "HOT",
        amountInr: 15000, contactName: "Priya Sharma", maskedPhone: "+91 8XXXXX-1234",
        source: "WhatsApp", listingName: "Koramangala", createdAt: "2026-08-01T00:00:00.000Z",
      },
    ]);
  });

  it("returns an empty list when Twenty is not configured", async () => {
    delete process.env.TWENTY_API_KEY;
    expect(await listOpportunities()).toEqual([]);
    expect(callTwentyTool).not.toHaveBeenCalled();
  });

  it("returns an empty list when the MCP tool call throws, rather than throwing", async () => {
    callTwentyTool.mockRejectedValue(new Error('twenty mcp tool "list_opportunities" failed: 500'));
    expect(await listOpportunities()).toEqual([]);
  });
});

describe("getOpportunity", () => {
  it("calls get_opportunity with the id and maps the single record", async () => {
    callTwentyTool.mockResolvedValue({
      id: "opp-1", name: "Office: Priya Sharma", stage: "SHORTLIST", tier: "HOT",
      amount: null, pointOfContact: null, source: "WhatsApp", listingName: null,
      createdAt: "2026-08-01T00:00:00.000Z",
    });

    const row = await getOpportunity("opp-1");

    expect(callTwentyTool).toHaveBeenCalledWith("get_opportunity", { id: "opp-1" });
    expect(row?.id).toBe("opp-1");
    expect(row?.amountInr).toBeNull();
    expect(row?.contactName).toBeNull();
  });

  it("returns null when the MCP tool call throws", async () => {
    callTwentyTool.mockRejectedValue(new Error("not found"));
    expect(await getOpportunity("missing")).toBeNull();
  });
});

describe("updateOpportunityStage", () => {
  it("calls update_opportunity with id + stage and returns ok:true on success", async () => {
    callTwentyTool.mockResolvedValue({ id: "opp-1", stage: "TOUR" });

    const result = await updateOpportunityStage("opp-1", "TOUR");

    expect(result).toEqual({ ok: true });
    expect(callTwentyTool).toHaveBeenCalledWith("update_opportunity", { id: "opp-1", stage: "TOUR" });
  });

  it("returns ok:false with an error message when the MCP tool call throws", async () => {
    callTwentyTool.mockRejectedValue(new Error('twenty mcp tool "update_opportunity" failed: bad stage'));
    const result = await updateOpportunityStage("opp-1", "TOUR");
    expect(result).toEqual({ ok: false, error: expect.stringContaining("bad stage") });
  });
});

describe("getPipelineValue", () => {
  it("sums amountInr across all open opportunities", async () => {
    callTwentyTool.mockResolvedValue({
      records: [
        { id: "1", name: "A", stage: "NEW_BRIEF", tier: "HOT", amount: { amountMicros: 10000000000 }, pointOfContact: null, source: null, listingName: null, createdAt: "" },
        { id: "2", name: "B", stage: "RENEWAL", tier: "COLD", amount: { amountMicros: 5000000000 }, pointOfContact: null, source: null, listingName: null, createdAt: "" },
        { id: "3", name: "C", stage: "TOUR", tier: "WARM", amount: null, pointOfContact: null, source: null, listingName: null, createdAt: "" },
      ],
    });
    expect(await getPipelineValue()).toBe(15000);
  });
});
