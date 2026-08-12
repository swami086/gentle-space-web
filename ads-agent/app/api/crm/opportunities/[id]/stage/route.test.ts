import { beforeEach, describe, expect, it, vi } from "vitest";

const ORG = { kind: "org" as const, orgId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" };

const { requireApiRole, scopeForSession, getOpportunity, updateOpportunityStage, writeAudit } = vi.hoisted(() => ({
  requireApiRole: vi.fn(),
  scopeForSession: vi.fn(),
  getOpportunity: vi.fn(),
  updateOpportunityStage: vi.fn(),
  writeAudit: vi.fn(),
}));
vi.mock("@/lib/auth/dal", () => ({ requireApiRole }));
vi.mock("@/lib/auth/scope-interim", () => ({ scopeForSession }));
vi.mock("@/lib/crm/twenty-pipeline", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/crm/twenty-pipeline")>();
  return { ...actual, getOpportunity, updateOpportunityStage };
});
vi.mock("@/lib/db/audit-log", () => ({ writeAudit }));

import { PATCH } from "./route";

beforeEach(() => {
  requireApiRole.mockReset();
  scopeForSession.mockReset();
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
    requireApiRole.mockResolvedValue({ ok: true, session: { userId: "user-1" } });
    scopeForSession.mockResolvedValue(ORG);
    getOpportunity.mockResolvedValue({ id: "opp-1", stage: "NEW_BRIEF" });
    updateOpportunityStage.mockResolvedValue({ ok: true });

    const res = await PATCH(req({ toStage: "TOUR", opportunityName: "Priya Sharma" }), {
      params: Promise.resolve({ id: "opp-1" }),
    });

    expect(updateOpportunityStage).toHaveBeenCalledWith("opp-1", "TOUR");
    expect(writeAudit).toHaveBeenCalledWith(ORG, {
      actorType: "human",
      actorUserId: "user-1",
      action: "opportunity.stage_changed",
      entityType: "opportunity",
      before: { stage: "NEW_BRIEF" },
      after: { stage: "TOUR", opportunityName: "Priya Sharma" },
    });
    expect(res.status).toBe(200);
  });

  it("returns 502 with the Twenty error when the update fails, without logging", async () => {
    requireApiRole.mockResolvedValue({ ok: true, session: { userId: "user-1" } });
    scopeForSession.mockResolvedValue(ORG);
    getOpportunity.mockResolvedValue({ id: "opp-1", stage: "NEW_BRIEF" });
    updateOpportunityStage.mockResolvedValue({ ok: false, error: "Twenty down" });

    const res = await PATCH(req({ toStage: "TOUR", opportunityName: "Priya Sharma" }), {
      params: Promise.resolve({ id: "opp-1" }),
    });

    expect(res.status).toBe(502);
    expect(writeAudit).not.toHaveBeenCalled();
  });

  it("rejects a stage value not in PIPELINE_STAGES with 400", async () => {
    requireApiRole.mockResolvedValue({ ok: true, session: { userId: "user-1" } });
    scopeForSession.mockResolvedValue(ORG);

    const res = await PATCH(req({ toStage: "NOT_REAL", opportunityName: "X" }), {
      params: Promise.resolve({ id: "opp-1" }),
    });

    expect(res.status).toBe(400);
    expect(updateOpportunityStage).not.toHaveBeenCalled();
  });
});
