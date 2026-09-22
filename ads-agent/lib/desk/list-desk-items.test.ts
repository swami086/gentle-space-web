import { beforeEach, describe, expect, it, vi } from "vitest";

const { listProposals } = vi.hoisted(() => ({ listProposals: vi.fn() }));
vi.mock("@/lib/db/proposals", () => ({ listProposals }));

import type { ProposalListItem } from "@/lib/db/proposals";
import type { Scope } from "@/lib/db/scope-sql";
import {
  deskKindFromProposal,
  deskUrgency,
  listDeskItems,
  mapProposalToDeskItem,
} from "./list-desk-items";

const ORG: Scope = { kind: "org", orgId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" };
const NOW = Date.parse("2026-09-20T12:00:00.000Z");

function proposal(overrides: Partial<ProposalListItem> = {}): ProposalListItem {
  return {
    id: "prop-1",
    kind: "pause",
    campaignId: "camp-1",
    payload: { campaignId: "camp-1" },
    triggeredRule: "kill_rule",
    rationale: "CPL over breakeven.",
    status: "pending",
    error: null,
    createdAt: "2026-09-20T11:30:00.000Z",
    decidedAt: null,
    executedAt: null,
    scheduledFor: null,
    undoUntil: null,
    batchId: null,
    currentDailyBudgetInr: 500,
    ...overrides,
  };
}

beforeEach(() => listProposals.mockReset());

describe("deskKindFromProposal", () => {
  it("maps budget_change to spend_change", () => {
    expect(deskKindFromProposal("budget_change")).toBe("spend_change");
  });

  it("maps other proposal kinds to campaign_proposal", () => {
    expect(deskKindFromProposal("pause")).toBe("campaign_proposal");
    expect(deskKindFromProposal("create_campaign")).toBe("campaign_proposal");
  });
});

describe("deskUrgency", () => {
  it("classifies age bands", () => {
    expect(deskUrgency("2026-09-20T11:00:00.000Z", NOW)).toBe("now");
    expect(deskUrgency("2026-09-20T01:00:00.000Z", NOW)).toBe("today");
    expect(deskUrgency("2026-09-18T12:00:00.000Z", NOW)).toBe("later");
  });
});

describe("mapProposalToDeskItem", () => {
  it("maps one pending proposal", () => {
    const item = mapProposalToDeskItem(proposal(), NOW);
    expect(item).toEqual({
      id: "prop-1",
      kind: "campaign_proposal",
      title: "Pause campaign",
      summary: "CPL over breakeven.",
      urgency: "now",
      agent: "performance",
      createdAt: "2026-09-20T11:30:00.000Z",
      hrefSurface: "/proposals/prop-1",
      status: "needs_approval",
      proposalId: "prop-1",
      proposalKind: "pause",
    });
  });

  it("excludes resolved proposals", () => {
    expect(mapProposalToDeskItem(proposal({ status: "approved" }), NOW)).toBeNull();
    expect(mapProposalToDeskItem(proposal({ status: "rejected" }), NOW)).toBeNull();
    expect(mapProposalToDeskItem(proposal({ status: "executed" }), NOW)).toBeNull();
  });

  it("keeps scheduled proposals as running", () => {
    const item = mapProposalToDeskItem(proposal({ status: "scheduled" }), NOW);
    expect(item?.status).toBe("running");
  });

  it("maps budget_change as spend_change", () => {
    const item = mapProposalToDeskItem(proposal({ kind: "budget_change" }), NOW);
    expect(item?.kind).toBe("spend_change");
    expect(item?.title).toBe("Change budget");
  });

  it("maps agent dotted pause kind", () => {
    const item = mapProposalToDeskItem(proposal({ kind: "campaign.pause" as ProposalListItem["kind"] }), NOW);
    expect(item?.kind).toBe("campaign_proposal");
    expect(item?.title).toBe("Pause campaign");
  });
});

describe("listDeskItems", () => {
  it("returns empty when no pending proposals", async () => {
    listProposals.mockResolvedValue([]);
    await expect(listDeskItems(ORG, NOW)).resolves.toEqual([]);
    expect(listProposals).toHaveBeenCalledWith(ORG, "pending");
    expect(listProposals).toHaveBeenCalledWith(ORG, "scheduled");
    expect(listProposals).toHaveBeenCalledWith(ORG, "executing");
  });

  it("returns mapped pending items only", async () => {
    listProposals.mockImplementation((_scope: unknown, status?: string) => {
      if (status === "pending") {
        return Promise.resolve([
          proposal(),
          proposal({ id: "prop-2", kind: "budget_change", rationale: null }),
        ]);
      }
      return Promise.resolve([]);
    });
    const items = await listDeskItems(ORG, NOW);
    expect(items).toHaveLength(2);
    expect(items[0].proposalId).toBe("prop-1");
    expect(items[1]).toMatchObject({
      id: "prop-2",
      kind: "spend_change",
      summary: "kill_rule",
    });
  });
});
