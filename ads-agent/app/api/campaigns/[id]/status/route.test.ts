import { beforeEach, describe, expect, it, vi } from "vitest";

const ORG = { kind: "org" as const, orgId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" };

const { guard, getCampaignById, updateCampaignStatus } = vi.hoisted(() => ({
  guard: vi.fn(),
  getCampaignById: vi.fn(),
  updateCampaignStatus: vi.fn(),
}));

vi.mock("@/lib/auth/guard", async () => {
  const { NextResponse } = await import("next/server");
  return {
    guard,
    ownedOr404: async (loader: (s: typeof ORG) => Promise<unknown>, scope: typeof ORG) => {
      const entity = await loader(scope);
      if (!entity) return { ok: false, response: NextResponse.json({ error: "not found" }, { status: 404 }) };
      return { ok: true, entity };
    },
  };
});
vi.mock("@/lib/db/campaigns", () => ({ getCampaignById, updateCampaignStatus }));

import { PATCH } from "./route";

beforeEach(() => {
  guard.mockReset();
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
    guard.mockResolvedValue({ ok: true, session: {}, scope: ORG });
    getCampaignById.mockResolvedValue({ id: "c1", status: "proposed" });
    updateCampaignStatus.mockResolvedValue(undefined);

    const res = await PATCH(req({ status: "active" }), { params: Promise.resolve({ id: "c1" }) });

    expect(getCampaignById).toHaveBeenCalledWith(ORG, "c1");
    expect(updateCampaignStatus).toHaveBeenCalledWith(ORG, "c1", "active");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("returns the guard response for an unauthorized caller", async () => {
    const forbidden = new Response(null, { status: 403 });
    guard.mockResolvedValue({ ok: false, response: forbidden });

    const res = await PATCH(req({ status: "active" }), { params: Promise.resolve({ id: "c1" }) });

    expect(res).toBe(forbidden);
    expect(updateCampaignStatus).not.toHaveBeenCalled();
  });

  it("rejects an invalid status value with 400", async () => {
    guard.mockResolvedValue({ ok: true, session: {}, scope: ORG });

    const res = await PATCH(req({ status: "not-a-status" }), { params: Promise.resolve({ id: "c1" }) });

    expect(res.status).toBe(400);
    expect(getCampaignById).not.toHaveBeenCalled();
    expect(updateCampaignStatus).not.toHaveBeenCalled();
  });
});
