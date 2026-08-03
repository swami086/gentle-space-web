import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/crm/twenty", () => ({
  createLeadInTwenty: vi.fn(),
}));
vi.mock("@/lib/ai/client", () => ({
  qualifyLead: vi.fn(),
}));

import { createLeadInTwenty } from "@/lib/crm/twenty";
import { qualifyLead } from "@/lib/ai/client";
import { POST } from "./route";

function postLead(body: unknown) {
  return POST(
    new Request("http://localhost/api/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(qualifyLead).mockResolvedValue({ tier: "unscored", cheatSheet: "" });
});

describe("POST /api/leads", () => {
  it("returns 400 for invalid json", async () => {
    const res = await postLead("{bad");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid json" });
  });

  it("returns 400 when required fields missing", async () => {
    const res = await postLead({ name: "A", phone: "", need: "office", brief: "x" });
    expect(res.status).toBe(400);
    expect(createLeadInTwenty).not.toHaveBeenCalled();
  });

  it("qualifies the lead before creating it in the CRM", async () => {
    vi.mocked(qualifyLead).mockResolvedValue({ tier: "hot", cheatSheet: "Ask about move-in." });
    vi.mocked(createLeadInTwenty).mockResolvedValue({
      status: "created",
      personId: "p1",
      opportunityId: "o1",
    });

    const res = await postLead({
      name: "Ada",
      phone: "9876543210",
      need: "office",
      brief: "desks",
      step2Answers: { teamSize: "15 desks" },
    });

    expect(qualifyLead).toHaveBeenCalledWith({
      need: "office",
      step2Answers: { teamSize: "15 desks" },
      notes: "desks",
    });
    expect(createLeadInTwenty).toHaveBeenCalledWith(
      expect.objectContaining({ step2Answers: { teamSize: "15 desks" } }),
      { tier: "hot", cheatSheet: "Ask about move-in." },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, crm: "created", tier: "hot" });
  });

  it("returns ok + crm created with tier unscored when no step2Answers are sent", async () => {
    vi.mocked(createLeadInTwenty).mockResolvedValue({ status: "created", personId: "p1", opportunityId: "o1" });

    const res = await postLead({ name: "Ada", phone: "9876543210", need: "retail", brief: "shop" });

    expect(qualifyLead).toHaveBeenCalledWith({ need: "retail", step2Answers: {}, notes: "shop" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, crm: "created", tier: "unscored" });
  });

  it("returns ok + crm failed (soft-fail)", async () => {
    vi.mocked(createLeadInTwenty).mockResolvedValue({ status: "failed", error: "down" });
    const res = await postLead({ name: "Ada", phone: "9876543210", need: "retail", brief: "shop" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, crm: "failed", tier: "unscored" });
  });
});
