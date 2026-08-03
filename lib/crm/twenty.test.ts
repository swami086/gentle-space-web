import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LeadPayload } from "@/lib/whatsapp";
import type { LeadQualification } from "@/lib/leads/qualify-types";

const payload: LeadPayload = {
  name: "Ada Lovelace",
  phone: "+91 98765 43210",
  need: "office",
  brief: "10 desks in Koramangala",
  propertyName: "CoWrks",
  propertyUrl: "http://localhost:3000/spaces/cowrks",
};

const qualification: LeadQualification = { tier: "hot", cheatSheet: "Ask about move-in date." };

describe("createLeadInTwenty", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns skipped when API key missing", async () => {
    delete process.env.TWENTY_API_KEY;
    process.env.TWENTY_BASE_URL = "http://localhost:3020";
    const { createLeadInTwenty } = await import("./twenty");
    await expect(createLeadInTwenty(payload, qualification)).resolves.toEqual({ status: "skipped" });
  });

  it("creates person then opportunity with tier and cheatSheet", async () => {
    process.env.TWENTY_API_KEY = "test-key";
    process.env.TWENTY_BASE_URL = "http://localhost:3020";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { id: "person-1" }, id: "person-1" }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { id: "opp-1" }, id: "opp-1" }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { createLeadInTwenty } = await import("./twenty");
    const result = await createLeadInTwenty(payload, qualification);
    expect(result.status).toBe("created");
    expect(result.personId).toBeTruthy();
    expect(result.opportunityId).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/rest/people");
    expect(String(fetchMock.mock.calls[1][0])).toContain("/rest/opportunities");
    const opportunityBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(opportunityBody.tier).toBe("HOT");
    expect(opportunityBody.need).toBe("OFFICE");
    expect(opportunityBody.stage).toBe("NEW_BRIEF");
    expect(opportunityBody.cheatSheet).toBe("Ask about move-in date.");
    expect(opportunityBody.listingUrl).toBe("http://localhost:3000/spaces/cowrks");
  });

  it("extracts ids from Twenty createPerson/createOpportunity wrappers", async () => {
    process.env.TWENTY_API_KEY = "test-key";
    process.env.TWENTY_BASE_URL = "http://localhost:3020";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { createPerson: { id: "person-wrap" } } }), {
          status: 201,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { createOpportunity: { id: "opp-wrap" } } }), {
          status: 201,
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const { createLeadInTwenty } = await import("./twenty");
    await expect(createLeadInTwenty(payload, qualification)).resolves.toEqual({
      status: "created",
      personId: "person-wrap",
      opportunityId: "opp-wrap",
    });
  });

  it("folds step2Answers into the brief field instead of separate CRM fields", async () => {
    process.env.TWENTY_API_KEY = "test-key";
    process.env.TWENTY_BASE_URL = "http://localhost:3020";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "person-1" }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "opp-1" }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    const { createLeadInTwenty } = await import("./twenty");
    await createLeadInTwenty(
      { ...payload, step2Answers: { teamSize: "15 desks", preferredArea: "Koramangala" } },
      qualification,
    );
    const opportunityBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(opportunityBody.brief).toContain("Team size / desks: 15 desks");
    expect(opportunityBody.brief).toContain("Koramangala");
  });

  it("returns failed when person create errors", async () => {
    process.env.TWENTY_API_KEY = "test-key";
    process.env.TWENTY_BASE_URL = "http://localhost:3020";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 500 })));
    const { createLeadInTwenty } = await import("./twenty");
    const result = await createLeadInTwenty(payload, qualification);
    expect(result.status).toBe("failed");
    expect(result.error).toBeTruthy();
  });

  it("returns failed when fetch throws (network error)", async () => {
    process.env.TWENTY_API_KEY = "test-key";
    process.env.TWENTY_BASE_URL = "http://localhost:3020";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const { createLeadInTwenty } = await import("./twenty");
    const result = await createLeadInTwenty(payload, qualification);
    expect(result).toEqual({ status: "failed", error: "network down" });
  });

  it("returns failed with personId when opportunity create errors", async () => {
    process.env.TWENTY_API_KEY = "test-key";
    process.env.TWENTY_BASE_URL = "http://localhost:3020";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { id: "person-42" }, id: "person-42" }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(new Response("server error", { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    const { createLeadInTwenty } = await import("./twenty");
    const result = await createLeadInTwenty(payload, qualification);
    expect(result.status).toBe("failed");
    expect(result.personId).toBe("person-42");
    expect(result.error).toBeTruthy();
    expect(result.error).toContain("500");
  });

  it("returns failed with personId when opportunity fetch throws after person create", async () => {
    process.env.TWENTY_API_KEY = "test-key";
    process.env.TWENTY_BASE_URL = "http://localhost:3020";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { createPerson: { id: "person-77" } } }), {
          status: 201,
        }),
      )
      .mockRejectedValueOnce(new Error("socket hang up"));
    vi.stubGlobal("fetch", fetchMock);

    const { createLeadInTwenty } = await import("./twenty");
    const result = await createLeadInTwenty(payload, qualification);
    expect(result).toEqual({
      status: "failed",
      personId: "person-77",
      error: "socket hang up",
    });
  });
});
