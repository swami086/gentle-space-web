import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import type { Proposal } from "@/lib/types";

const TEST_SCOPE = { kind: "org" as const, orgId: "org-1" };
const ID_A = "00000000-0000-0000-0000-000000000001";
const ID_B = "00000000-0000-0000-0000-000000000002";
const BATCH_ID = "11111111-1111-1111-1111-111111111111";

const {
  getProposalById,
  scheduleProposal,
  decideProposal,
  getOrgSettings,
  guard,
  randomUUID,
} = vi.hoisted(() => ({
  getProposalById: vi.fn(),
  scheduleProposal: vi.fn(),
  decideProposal: vi.fn(),
  getOrgSettings: vi.fn(),
  guard: vi.fn(),
  randomUUID: vi.fn(() => BATCH_ID),
}));

vi.mock("node:crypto", () => ({ randomUUID }));
vi.mock("@/lib/db/proposals", () => ({ getProposalById, scheduleProposal, decideProposal }));
vi.mock("@/lib/db/org-settings", () => ({ getOrgSettings }));
vi.mock("@/lib/auth/guard", () => ({ guard }));

import { POST } from "./route";

function pendingProposal(id: string): Proposal {
  return {
    id,
    kind: "pause",
    campaignId: "camp-1",
    payload: {},
    triggeredRule: "kill_rule",
    rationale: null,
    status: "pending",
    error: null,
    createdAt: "2026-08-03T00:00:00.000Z",
    decidedAt: null,
    executedAt: null,
    scheduledFor: null,
    undoUntil: null,
    batchId: null,
  };
}

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/proposals/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  guard.mockResolvedValue({
    ok: true,
    session: { userId: "u-1", email: "a@b.com", orgId: "org-1", role: "operator" },
    scope: TEST_SCOPE,
  });
  getOrgSettings.mockResolvedValue({
    cronEnabled: false,
    lastRunAt: null,
    undoWindowSeconds: 120,
    approvalThresholdInr: null,
  });
});

describe("POST /api/proposals/bulk", () => {
  it("returns guard response when unauthenticated", async () => {
    guard.mockResolvedValue({
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    const res = await post({ action: "approve", ids: [ID_A] });
    expect(res.status).toBe(401);
  });

  it("returns 400 for an invalid action", async () => {
    const res = await post({ action: "maybe", ids: [ID_A] });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "action must be approve or reject" });
  });

  it("returns 400 when ids fail validation", async () => {
    const res = await post({ action: "approve", ids: [] });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "ids must not be empty" });
  });

  it("normalizes uppercase UUIDs before validating", async () => {
    const upper = ID_A.toUpperCase();
    getProposalById.mockResolvedValue(pendingProposal(ID_A));
    scheduleProposal.mockResolvedValue({ ...pendingProposal(ID_A), status: "scheduled" });

    const res = await post({ action: "approve", ids: [upper] });
    expect(res.status).toBe(200);
    expect(getProposalById).toHaveBeenCalledWith(TEST_SCOPE, ID_A);
    expect(await res.json()).toEqual({
      batchId: BATCH_ID,
      results: [{ id: ID_A, ok: true, status: "scheduled" }],
    });
  });

  it("bulk approve schedules pending proposals with one batchId", async () => {
    getProposalById.mockImplementation(async (_scope, id: string) => pendingProposal(id));
    scheduleProposal.mockImplementation(async (_scope, id: string) => ({
      ...pendingProposal(id),
      status: "scheduled" as const,
    }));

    const res = await post({ action: "approve", ids: [ID_A, ID_B] });

    expect(getOrgSettings).toHaveBeenCalledWith(TEST_SCOPE);
    expect(scheduleProposal).toHaveBeenCalledWith(TEST_SCOPE, ID_A, {
      decidedBy: "u-1",
      decidedVia: "bulk",
      undoWindowSeconds: 120,
      batchId: BATCH_ID,
    });
    expect(scheduleProposal).toHaveBeenCalledWith(TEST_SCOPE, ID_B, expect.objectContaining({ batchId: BATCH_ID }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      batchId: BATCH_ID,
      results: [
        { id: ID_A, ok: true, status: "scheduled" },
        { id: ID_B, ok: true, status: "scheduled" },
      ],
    });
  });

  it("returns 200 with per-item errors on partial failure", async () => {
    getProposalById.mockImplementation(async (_scope, id: string) => {
      if (id === ID_A) return pendingProposal(ID_A);
      return { ...pendingProposal(ID_B), status: "executed" as const };
    });
    scheduleProposal.mockResolvedValue({ ...pendingProposal(ID_A), status: "scheduled" });

    const res = await post({ action: "approve", ids: [ID_A, ID_B] });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      batchId: BATCH_ID,
      results: [
        { id: ID_A, ok: true, status: "scheduled" },
        { id: ID_B, ok: false, error: "proposal is executed, not pending" },
      ],
    });
    expect(scheduleProposal).toHaveBeenCalledTimes(1);
  });

  it("bulk reject decides rejected with decidedVia bulk and null batchId", async () => {
    getProposalById.mockResolvedValue(pendingProposal(ID_A));

    const res = await post({ action: "reject", ids: [ID_A] });

    expect(decideProposal).toHaveBeenCalledWith(TEST_SCOPE, ID_A, "rejected", "u-1", "bulk");
    expect(scheduleProposal).not.toHaveBeenCalled();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      batchId: null,
      results: [{ id: ID_A, ok: true, status: "rejected" }],
    });
  });
});
