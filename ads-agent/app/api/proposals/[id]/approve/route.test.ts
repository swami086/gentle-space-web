import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import type { Campaign, Proposal } from "@/lib/types";

const TEST_SCOPE = { kind: "org" as const, orgId: "org-1" };

const {
  getProposalById,
  scheduleProposal,
  guard,
  getOrgSettings,
  getOrgBalance,
  getConnectorStatus,
  getCampaignById,
  executeProposal,
  probeGoogleAdsReadMcp,
} = vi.hoisted(() => ({
  getProposalById: vi.fn(),
  scheduleProposal: vi.fn(),
  guard: vi.fn(),
  getOrgSettings: vi.fn(),
  getOrgBalance: vi.fn(),
  getConnectorStatus: vi.fn(),
  getCampaignById: vi.fn(),
  executeProposal: vi.fn(),
  probeGoogleAdsReadMcp: vi.fn(),
}));

vi.mock("@/lib/db/proposals", () => ({ getProposalById, scheduleProposal }));
vi.mock("@/lib/db/org-settings", () => ({ getOrgSettings }));
vi.mock("@/lib/metering/ledger", () => ({ getOrgBalance }));
vi.mock("@/lib/env-status", () => ({ getConnectorStatus }));
vi.mock("@/lib/connectors/google-ads-health", () => ({ probeGoogleAdsReadMcp }));
vi.mock("@/lib/db/campaigns", () => ({ getCampaignById }));
vi.mock("@/lib/executor/execute", () => ({ executeProposal }));
vi.mock("@/lib/auth/guard", async () => {
  const { NextResponse } = await import("next/server");
  return {
    guard,
    ownedOr404: async (loader: (s: typeof TEST_SCOPE) => Promise<unknown>, scope: typeof TEST_SCOPE) => {
      const entity = await loader(scope);
      if (!entity) return { ok: false, response: NextResponse.json({ error: "not found" }, { status: 404 }) };
      return { ok: true, entity };
    },
  };
});

import { POST } from "./route";

function pendingProposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    id: "prop-1",
    kind: "pause",
    campaignId: "camp-1",
    payload: { platform: "google" },
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
    ...overrides,
  };
}

function googleCampaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: "camp-1",
    platform: "google",
    externalId: "ext-1",
    name: "Whitefield offices",
    status: "active",
    dailyBudget: 500,
    corridor: "Whitefield",
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
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
    undoWindowSeconds: 90,
    approvalThresholdInr: null,
  });
  getOrgBalance.mockResolvedValue(250);
  getConnectorStatus.mockReturnValue({
    googleAds: true,
    meta: true,
    twenty: false,
    bifrost: false,
  });
  getCampaignById.mockResolvedValue(googleCampaign());
  probeGoogleAdsReadMcp.mockResolvedValue({ configured: true, reachable: true });
});

describe("POST /api/proposals/[id]/approve", () => {
  it("returns 404 when the proposal does not exist", async () => {
    getProposalById.mockResolvedValue(null);
    const res = await POST(new Request("http://localhost"), { params: Promise.resolve({ id: "missing" }) });
    expect(res.status).toBe(404);
  });

  it("returns 409 when the proposal is not pending", async () => {
    getProposalById.mockResolvedValue({ ...pendingProposal(), status: "executed" });
    const res = await POST(new Request("http://localhost"), { params: Promise.resolve({ id: "prop-1" }) });
    expect(res.status).toBe(409);
    expect(scheduleProposal).not.toHaveBeenCalled();
    expect(executeProposal).not.toHaveBeenCalled();
  });

  it("returns 422 when Google read MCP is unreachable for a google proposal", async () => {
    getProposalById.mockResolvedValue(pendingProposal());
    probeGoogleAdsReadMcp.mockResolvedValue({
      configured: true,
      reachable: false,
      error: "connection refused",
    });

    const res = await POST(new Request("http://localhost"), { params: Promise.resolve({ id: "prop-1" }) });

    expect(probeGoogleAdsReadMcp).toHaveBeenCalledWith({ timeoutMs: 2000 });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.preflight.checks.find((c: { id: string }) => c.id === "connector_health")).toMatchObject({
      ok: false,
      message: "Google Ads MCP read surface unreachable",
    });
    expect(scheduleProposal).not.toHaveBeenCalled();
  });

  it("returns 422 when preflight fails", async () => {
    getProposalById.mockResolvedValue(
      pendingProposal({
        kind: "budget_change",
        payload: { campaignId: "camp-1", platform: "google", newDailyBudgetInr: 2000 },
      }),
    );
    getOrgSettings.mockResolvedValue({
      cronEnabled: false,
      lastRunAt: null,
      undoWindowSeconds: 60,
      approvalThresholdInr: 1000,
    });

    const res = await POST(new Request("http://localhost"), { params: Promise.resolve({ id: "prop-1" }) });

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("preflight_failed");
    expect(body.preflight.ok).toBe(false);
    expect(scheduleProposal).not.toHaveBeenCalled();
    expect(executeProposal).not.toHaveBeenCalled();
  });

  it("derives platform from campaign before preflight", async () => {
    getProposalById.mockResolvedValue(pendingProposal({ payload: {} }));
    getConnectorStatus.mockReturnValue({
      googleAds: false,
      meta: true,
      twenty: false,
      bifrost: false,
    });

    const res = await POST(new Request("http://localhost"), { params: Promise.resolve({ id: "prop-1" }) });

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.preflight.checks.find((c: { id: string }) => c.id === "connector_health")).toMatchObject({
      ok: false,
    });
    expect(scheduleProposal).not.toHaveBeenCalled();
  });

  it("schedules into undo window and returns preflight, diff, broker copy, and budget delta", async () => {
    const scheduled = {
      ...pendingProposal(),
      status: "scheduled" as const,
      scheduledFor: "2026-08-03T00:01:00.000Z",
      undoUntil: "2026-08-03T00:02:30.000Z",
    };
    getProposalById.mockResolvedValue(pendingProposal());
    scheduleProposal.mockResolvedValue(scheduled);

    const res = await POST(new Request("http://localhost"), { params: Promise.resolve({ id: "prop-1" }) });

    expect(scheduleProposal).toHaveBeenCalledWith(TEST_SCOPE, "prop-1", {
      decidedBy: "u-1",
      decidedVia: "ui",
      undoWindowSeconds: 90,
    });
    expect(executeProposal).not.toHaveBeenCalled();
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.proposal).toEqual(scheduled);
    expect(body.preflight.ok).toBe(true);
    expect(body.diff).toEqual([{ field: "status", before: "active", after: "paused" }]);
    expect(body.brokerCopy).toMatch(/pause/i);
    expect(body.budgetDeltaInr).toBe(-500);
  });
});
