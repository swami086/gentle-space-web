import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireApiRole, updateCampaignStatus } = vi.hoisted(() => ({
  requireApiRole: vi.fn(),
  updateCampaignStatus: vi.fn(),
}));
vi.mock("@/lib/auth/dal", () => ({ requireApiRole }));
vi.mock("@/lib/db/campaigns", () => ({ updateCampaignStatus }));

import { PATCH } from "./route";

beforeEach(() => {
  requireApiRole.mockReset();
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
    updateCampaignStatus.mockResolvedValue(undefined);

    const res = await PATCH(req({ status: "active" }), { params: Promise.resolve({ id: "c1" }) });

    expect(updateCampaignStatus).toHaveBeenCalledWith("c1", "active");
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

    const res = await PATCH(req({ status: "not-a-status" }), { params: Promise.resolve({ id: "c1" }) });

    expect(res.status).toBe(400);
    expect(updateCampaignStatus).not.toHaveBeenCalled();
  });
});
