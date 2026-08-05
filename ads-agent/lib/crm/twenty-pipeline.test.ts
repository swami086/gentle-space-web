// ads-agent/lib/crm/twenty-pipeline.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PIPELINE_STAGES,
  getOpportunity,
  getPipelineValue,
  listOpportunities,
  maskPhone,
  updateOpportunityStage,
} from "./twenty-pipeline";

const originalFetch = global.fetch;
const originalEnv = { ...process.env };

beforeEach(() => {
  process.env.TWENTY_API_KEY = "test-key";
  process.env.TWENTY_BASE_URL = "http://localhost:3020";
});

afterEach(() => {
  global.fetch = originalFetch;
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

describe("PIPELINE_STAGES", () => {
  it("has the 7 real configured Twenty stages, in order", () => {
    expect(PIPELINE_STAGES.map((s) => s.value)).toEqual([
      "NEW_BRIEF",
      "SHORTLIST",
      "TOUR",
      "NEGOTIATE",
      "LEGAL",
      "HANDOVER",
      "RENEWAL",
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
  it("maps Twenty's opportunities response into typed rows", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          opportunities: [
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
        },
      }),
    });

    const rows = await listOpportunities();
    expect(rows).toEqual([
      {
        id: "opp-1",
        name: "Office: Priya Sharma",
        stage: "SHORTLIST",
        tier: "HOT",
        amountInr: 15000,
        contactName: "Priya Sharma",
        maskedPhone: "+91 8XXXXX-1234",
        source: "WhatsApp",
        listingName: "Koramangala",
        createdAt: "2026-08-01T00:00:00.000Z",
      },
    ]);
  });

  it("returns an empty list when Twenty is not configured", async () => {
    delete process.env.TWENTY_API_KEY;
    global.fetch = vi.fn();
    expect(await listOpportunities()).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns an empty list on a non-ok response rather than throwing", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    expect(await listOpportunities()).toEqual([]);
  });
});

describe("getOpportunity", () => {
  it("fetches a single opportunity by id", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          opportunity: {
            id: "opp-1",
            name: "Office: Priya Sharma",
            stage: "SHORTLIST",
            tier: "HOT",
            amount: null,
            pointOfContact: null,
            source: "WhatsApp",
            listingName: null,
            createdAt: "2026-08-01T00:00:00.000Z",
          },
        },
      }),
    });

    const row = await getOpportunity("opp-1");
    expect(row?.id).toBe("opp-1");
    expect(row?.amountInr).toBeNull();
    expect(row?.contactName).toBeNull();
    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:3020/rest/opportunities/opp-1",
      expect.objectContaining({ headers: { Authorization: "Bearer test-key" } }),
    );
  });

  it("returns null on a 404", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    expect(await getOpportunity("missing")).toBeNull();
  });
});

describe("updateOpportunityStage", () => {
  it("PATCHes the stage field and returns ok:true on success", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { opportunity: { id: "opp-1" } } }) });

    const result = await updateOpportunityStage("opp-1", "TOUR");
    expect(result).toEqual({ ok: true });
    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:3020/rest/opportunities/opp-1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ stage: "TOUR" }),
      }),
    );
  });

  it("returns ok:false with an error message on failure", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => "bad stage" });
    const result = await updateOpportunityStage("opp-1", "TOUR");
    expect(result).toEqual({ ok: false, error: expect.stringContaining("400") });
  });
});

describe("getPipelineValue", () => {
  it("sums amountInr across all open opportunities", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          opportunities: [
            { id: "1", name: "A", stage: "NEW_BRIEF", tier: "HOT", amount: { amountMicros: 10000000000 }, pointOfContact: null, source: null, listingName: null, createdAt: "" },
            { id: "2", name: "B", stage: "RENEWAL", tier: "COLD", amount: { amountMicros: 5000000000 }, pointOfContact: null, source: null, listingName: null, createdAt: "" },
            { id: "3", name: "C", stage: "TOUR", tier: "WARM", amount: null, pointOfContact: null, source: null, listingName: null, createdAt: "" },
          ],
        },
      }),
    });

    expect(await getPipelineValue()).toBe(15000);
  });
});
