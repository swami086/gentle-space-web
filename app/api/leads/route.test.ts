import { beforeEach, describe, expect, it, vi } from "vitest";

const { captureEnquiry } = vi.hoisted(() => ({
  captureEnquiry: vi.fn(),
}));
vi.mock("@/lib/enquiries/capture", () => ({ captureEnquiry }));
vi.mock("@/lib/ai/client", () => ({
  qualifyLead: vi.fn(),
}));

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
  process.env.GENTLE_SPACE_ORG_ID = "org-gentle-space";
  vi.mocked(qualifyLead).mockResolvedValue({ tier: "unscored", cheatSheet: "" });
  captureEnquiry.mockResolvedValue({
    enquiryId: "enq-default",
    contactId: "contact-default",
    messageId: "msg-default",
  });
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
    expect(captureEnquiry).not.toHaveBeenCalled();
  });

  it("qualifies the lead before capturing it in Postgres", async () => {
    vi.mocked(qualifyLead).mockResolvedValue({ tier: "hot", cheatSheet: "Ask about move-in." });
    captureEnquiry.mockResolvedValue({
      enquiryId: "enq-1",
      contactId: "contact-1",
      messageId: "msg-1",
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
    expect(captureEnquiry).toHaveBeenCalledWith({
      orgId: "org-gentle-space",
      name: "Ada",
      phone: "9876543210",
      need: "office",
      brief: "Team size / desks: 15 desks. desks",
      listingUrl: null,
      listingName: null,
      tier: "hot",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      crm: "pending",
      tier: "hot",
      enquiryId: "enq-1",
    });
  });

  it("returns ok + crm pending with tier unscored when no step2Answers are sent", async () => {
    const res = await postLead({ name: "Ada", phone: "9876543210", need: "retail", brief: "shop" });

    expect(qualifyLead).toHaveBeenCalledWith({ need: "retail", step2Answers: {}, notes: "shop" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      ok: true,
      crm: "pending",
      tier: "unscored",
      enquiryId: "enq-default",
    });
  });

  it("still returns 200 and an enquiry id when the CRM is unreachable", async () => {
    // The point of the inversion: this route no longer knows Twenty exists.
    captureEnquiry.mockResolvedValue({
      enquiryId: "enq-1",
      contactId: "contact-1",
      messageId: "msg-1",
    });
    const res = await POST(
      new Request("http://x/api/leads", {
        method: "POST",
        body: JSON.stringify({ name: "Asha", phone: "+919800000000", brief: "hi", need: "office" }),
      }),
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ crm: "pending", enquiryId: "enq-1" });
  });

  it("uses the default org id when GENTLE_SPACE_ORG_ID is not set", async () => {
    delete process.env.GENTLE_SPACE_ORG_ID;
    const res = await postLead({
      name: "Asha",
      phone: "+919800000000",
      brief: "hi",
      need: "office",
    });
    expect(res.status).toBe(200);
    expect(captureEnquiry).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "00000000-0000-0000-0000-000000000001" }),
    );
  });
});
