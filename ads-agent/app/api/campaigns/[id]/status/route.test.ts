import { beforeEach, describe, expect, it, vi } from "vitest";

const ORG = { kind: "org" as const, orgId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" };

const { requireApiRole, scopeForSession, getCampaignById, updateCampaignStatus } = vi.hoisted(() => ({
  requireApiRole: vi.fn(),
  scopeForSession: vi.fn(),
  getCampaignById: vi.fn(),
  updateCampaignStatus: vi.fn(),
}));
vi.mock("@/lib/auth/dal", () => ({ requireApiRole }));
vi.mock("@/lib/auth/scope-interim", () => ({ scopeForSession }));
vi.mock("@/lib/db/campaigns", () => ({ getCampaignById, updateCampaignStatus }));

import { PATCH } from "./route";

beforeEach(() => {
  requireApiRole.mockReset();
  scopeForSession.mockReset();
  getCampaignById.mockReset();
  updateCampaignStatus.mockReset();
});

function req(body: unknown) {
  return new Request("http://localhost/api/campaigns/c1/status", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/campaigns/[id]/status", () => {
  it("updates status and returns ok:true for an authorized operator", async () => {
    requireApiRole.mockResolvedValue({ ok: true, session: {} });
    scopeForSession.mockResolvedValue(ORG);
    getCampaignById.mockResolvedValue({ id: "c1", status: "proposed" });
    updateCampaignStatus.mockResolvedValue(undefined);

    const res = await PATCH(req({ status: "active" }), { params: Promise.resolve({ id: "c1" }) });

    expect(scopeForSession).toHaveBeenCalledWith({});
    expect(getCampaignById).toHaveBeenCalledWith(ORG, "c1");
    expect(updateCampaignStatus).toHaveBeenCalledWith(ORG, "c1", "active");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("returns the requireApiRole response for an unauthorized caller", async () => {
    const forbidden = new Response(null, { status: 403 });
    requireApiRole.mockResolvedValue({ ok: false, response: forbidden });

    const res = await PATCH(req({ status: "active" }), { params: Promise.resolve({ id: "c1" }) });

    expect(res).toBe(forbidden);
    expect(updateCampaignStatus).not.toHaveBeenCalled();
  });

  it("rejects an invalid status value with 400", async () => {
    requireApiRole.mockResolvedValue({ ok: true, session: {} });
    scopeForSession.mockResolvedValue(ORG);

    const res = await PATCH(req({ status: "not-a-status" }), { params: Promise.resolve({ id: "c1" }) });

    expect(res.status).toBe(400);
    expect(getCampaignById).not.toHaveBeenCalled();
    expect(updateCampaignStatus).not.toHaveBeenCalled();
  });
});
