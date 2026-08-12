import { beforeEach, describe, expect, it, vi } from "vitest";

const PLATFORM = { kind: "platform" as const, orgId: "00000000-0000-0000-0000-000000000001" };

const { guard, getOpportunity, updateOpportunityStage, writeAudit } = vi.hoisted(() => ({
  guard: vi.fn(),
  getOpportunity: vi.fn(),
  updateOpportunityStage: vi.fn(),
  writeAudit: vi.fn(),
}));

vi.mock("@/lib/auth/guard", () => ({ guard }));
vi.mock("@/lib/crm/twenty-pipeline", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/crm/twenty-pipeline")>();
  return { ...actual, getOpportunity, updateOpportunityStage };
});
vi.mock("@/lib/db/audit-log", () => ({ writeAudit }));

import { PATCH } from "./route";

beforeEach(() => {
  guard.mockReset();
  getOpportunity.mockReset();
  updateOpportunityStage.mockReset();
  writeAudit.mockReset();
});

function req(body: unknown) {
  return new Request("http://localhost/api/crm/opportunities/opp-1/stage", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/crm/opportunities/[id]/stage", () => {
  it("updates the stage, writes an audit row, and returns ok:true", async () => {
    guard.mockResolvedValue({ ok: true, session: { userId: "user-1" }, scope: PLATFORM });
    getOpportunity.mockResolvedValue({ id: "opp-1", stage: "NEW_BRIEF" });
    updateOpportunityStage.mockResolvedValue({ ok: true });

    const res = await PATCH(req({ toStage: "TOUR", opportunityName: "Priya Sharma" }), {
      params: Promise.resolve({ id: "opp-1" }),
    });

    expect(updateOpportunityStage).toHaveBeenCalledWith(PLATFORM, "opp-1", "TOUR");
    expect(writeAudit).toHaveBeenCalledWith(PLATFORM, {
      actorType: "human",
      actorUserId: "user-1",
      action: "opportunity.stage_changed",
      entityType: "opportunity",
      before: { stage: "NEW_BRIEF" },
      after: { stage: "TOUR", opportunityName: "Priya Sharma" },
    });
    expect(res.status).toBe(200);
  });

  it("returns 404 for non-platform scope without touching Twenty", async () => {
    guard.mockResolvedValue({
      ok: true,
      session: { userId: "user-1" },
      scope: { kind: "org", orgId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" },
    });

    const res = await PATCH(req({ toStage: "TOUR", opportunityName: "Priya Sharma" }), {
      params: Promise.resolve({ id: "opp-1" }),
    });

    expect(res.status).toBe(404);
    expect(getOpportunity).not.toHaveBeenCalled();
    expect(updateOpportunityStage).not.toHaveBeenCalled();
  });

  it("returns 502 with the Twenty error when the update fails, without logging", async () => {
    guard.mockResolvedValue({ ok: true, session: { userId: "user-1" }, scope: PLATFORM });
    getOpportunity.mockResolvedValue({ id: "opp-1", stage: "NEW_BRIEF" });
    updateOpportunityStage.mockResolvedValue({ ok: false, error: "Twenty down" });

    const res = await PATCH(req({ toStage: "TOUR", opportunityName: "Priya Sharma" }), {
      params: Promise.resolve({ id: "opp-1" }),
    });

    expect(res.status).toBe(502);
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("rejects a stage value not in PIPELINE_STAGES with 400", async () => {
    guard.mockResolvedValue({ ok: true, session: { userId: "user-1" }, scope: PLATFORM });

    const res = await PATCH(req({ toStage: "NOT_REAL", opportunityName: "X" }), {
      params: Promise.resolve({ id: "opp-1" }),
    });

    expect(res.status).toBe(400);
    expect(updateOpportunityStage).not.toHaveBeenCalled();
  });
});
