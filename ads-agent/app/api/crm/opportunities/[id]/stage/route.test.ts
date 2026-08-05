import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireApiRole, updateOpportunityStage, logAiAction } = vi.hoisted(() => ({
  requireApiRole: vi.fn(),
  updateOpportunityStage: vi.fn(),
  logAiAction: vi.fn(),
}));
vi.mock("@/lib/auth/dal", () => ({ requireApiRole }));
vi.mock("@/lib/crm/twenty-pipeline", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/crm/twenty-pipeline")>();
  return { ...actual, updateOpportunityStage };
});
vi.mock("@/lib/db/ai-action-log", () => ({ logAiAction }));

import { PATCH } from "./route";

beforeEach(() => {
  requireApiRole.mockReset();
  updateOpportunityStage.mockReset();
  logAiAction.mockReset();
});

function req(body: unknown) {
  return new Request("http://localhost/api/crm/opportunities/opp-1/stage", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/crm/opportunities/[id]/stage", () => {
  it("updates the stage, logs an ai_action_log row, and returns ok:true", async () => {
    requireApiRole.mockResolvedValue({ ok: true, session: {} });
    updateOpportunityStage.mockResolvedValue({ ok: true });

    const res = await PATCH(req({ toStage: "TOUR", opportunityName: "Priya Sharma" }), {
      params: Promise.resolve({ id: "opp-1" }),
    });

    expect(updateOpportunityStage).toHaveBeenCalledWith("opp-1", "TOUR");
    expect(logAiAction).toHaveBeenCalledWith({ domain: "crm", summary: "Advanced Priya Sharma to Tour" });
    expect(res.status).toBe(200);
  });

  it("returns 502 with the Twenty error when the update fails, without logging", async () => {
    requireApiRole.mockResolvedValue({ ok: true, session: {} });
    updateOpportunityStage.mockResolvedValue({ ok: false, error: "Twenty down" });

    const res = await PATCH(req({ toStage: "TOUR", opportunityName: "Priya Sharma" }), {
      params: Promise.resolve({ id: "opp-1" }),
    });

    expect(res.status).toBe(502);
    expect(logAiAction).not.toHaveBeenCalled();
  });

  it("rejects a stage value not in PIPELINE_STAGES with 400", async () => {
    requireApiRole.mockResolvedValue({ ok: true, session: {} });

    const res = await PATCH(req({ toStage: "NOT_REAL", opportunityName: "X" }), {
      params: Promise.resolve({ id: "opp-1" }),
    });

    expect(res.status).toBe(400);
    expect(updateOpportunityStage).not.toHaveBeenCalled();
  });
});
