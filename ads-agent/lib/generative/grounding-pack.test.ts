import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  getProposalById,
  getCampaignById,
  getEnquiryById,
  listActivities,
  query,
} = vi.hoisted(() => ({
  getProposalById: vi.fn(),
  getCampaignById: vi.fn(),
  getEnquiryById: vi.fn(),
  listActivities: vi.fn(),
  query: vi.fn(),
}));

vi.mock("../db/proposals", () => ({ getProposalById }));
vi.mock("../db/campaigns", () => ({ getCampaignById }));
vi.mock("../db/enquiries", () => ({ getEnquiryById }));
vi.mock("../db/enquiry-activities", () => ({ listActivities }));
vi.mock("../db/tx", () => ({
  withTenantTransaction: (_scope: unknown, fn: (c: { query: typeof query }) => unknown) =>
    fn({ query }),
}));

import type { Scope } from "../db/scope-sql";
import { buildGroundingPack } from "./grounding-pack";

const ORG: Scope = { kind: "org", orgId: "10101010-1010-1010-1010-101010101010" };
const PROPOSAL_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const CAMPAIGN_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const ENQUIRY_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const ACTIVITY_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const SPACE_ID = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
const CORRIDOR_ID = "ffffffff-ffff-ffff-ffff-ffffffffffff";

beforeEach(() => {
  getProposalById.mockReset();
  getCampaignById.mockReset();
  getEnquiryById.mockReset();
  listActivities.mockReset();
  query.mockReset();
});

describe("buildGroundingPack", () => {
  it("throws entity_not_found when the proposal is missing", async () => {
    getProposalById.mockResolvedValue(null);
    await expect(buildGroundingPack(ORG, "proposal", PROPOSAL_ID)).rejects.toThrow(
      "entity_not_found",
    );
  });

  it("builds a non-empty proposal pack with related campaign id", async () => {
    getProposalById.mockResolvedValue({
      id: PROPOSAL_ID,
      kind: "pause",
      campaignId: CAMPAIGN_ID,
      payload: { campaignId: CAMPAIGN_ID },
      triggeredRule: "kill_rule",
      rationale: "CPL high",
      status: "pending",
      error: null,
      createdAt: "2026-08-13T00:00:00.000Z",
      decidedAt: null,
      executedAt: null,
    });
    getCampaignById.mockResolvedValue({
      id: CAMPAIGN_ID,
      platform: "google",
      externalId: null,
      name: "Koramangala",
      status: "active",
      dailyBudget: 500,
      corridor: "koramangala",
      createdAt: "2026-08-01T00:00:00.000Z",
    });

    const pack = await buildGroundingPack(ORG, "proposal", PROPOSAL_ID);

    expect(pack.entity).toBe("proposal");
    expect(pack.id).toBe(PROPOSAL_ID);
    expect(pack.rowIds).toEqual([PROPOSAL_ID, CAMPAIGN_ID]);
    expect(pack.facts).toMatchObject({
      proposal: { id: PROPOSAL_ID },
      campaign: { id: CAMPAIGN_ID },
    });
    expect(pack.builtAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("builds an enquiry pack with activity row ids", async () => {
    getEnquiryById.mockResolvedValue({
      id: ENQUIRY_ID,
      orgId: ORG.orgId,
      contactId: null,
      twentyOpportunityId: null,
      listingId: SPACE_ID,
      listingUrl: null,
      corridorId: CORRIDOR_ID,
      replyState: "waiting",
      contactName: "Alex",
      contactPhone: null,
      contactEmail: null,
      firstSeenAt: "2026-08-01T00:00:00.000Z",
      lastActivityAt: "2026-08-02T00:00:00.000Z",
      lifecycle: "active",
      createdAt: "2026-08-01T00:00:00.000Z",
    });
    listActivities.mockResolvedValue([
      {
        id: ACTIVITY_ID,
        orgId: ORG.orgId,
        enquiryId: ENQUIRY_ID,
        kind: "call",
        actorUserId: "user-1",
        callOutcome: "spoke_interested",
        callDirection: "outgoing",
        callSeconds: 120,
        occurredAt: "2026-08-02T00:00:00.000Z",
        body: null,
        syncedToTwentyAt: null,
      },
    ]);

    const pack = await buildGroundingPack(ORG, "enquiry", ENQUIRY_ID);

    expect(pack.rowIds).toEqual([ENQUIRY_ID, ACTIVITY_ID, SPACE_ID, CORRIDOR_ID]);
    expect(pack.facts).toMatchObject({
      enquiry: { id: ENQUIRY_ID },
      activity: [{ id: ACTIVITY_ID }],
    });
  });

  it("throws entity_not_found when campaign is missing", async () => {
    getCampaignById.mockResolvedValue(null);
    await expect(
      buildGroundingPack(ORG, "campaign", CAMPAIGN_ID),
    ).rejects.toThrow("entity_not_found");
  });

  it("builds a campaign pack with the campaign id as the sole row id", async () => {
    getCampaignById.mockResolvedValue({
      id: CAMPAIGN_ID,
      platform: "meta",
      externalId: "ext-1",
      name: "Indiranagar",
      status: "active",
      dailyBudget: 300,
      corridor: "indiranagar",
      createdAt: "2026-08-01T00:00:00.000Z",
    });

    const pack = await buildGroundingPack(ORG, "campaign", CAMPAIGN_ID);

    expect(pack.rowIds).toEqual([CAMPAIGN_ID]);
    expect(pack.facts).toMatchObject({ campaign: { id: CAMPAIGN_ID } });
  });

  it("throws entity_not_found when space is not visible to the tenant", async () => {
    query.mockResolvedValue({ rows: [] });
    await expect(buildGroundingPack(ORG, "space", SPACE_ID)).rejects.toThrow(
      "entity_not_found",
    );
  });

  it("builds a space pack when the listing is tenant-visible", async () => {
    query.mockResolvedValue({
      rows: [
        {
          id: SPACE_ID,
          title: "Desk hub",
          amenities: ["wifi"],
          synced_at: new Date("2026-08-01T00:00:00.000Z"),
          corridor_id: CORRIDOR_ID,
        },
      ],
    });

    const pack = await buildGroundingPack(ORG, "space", SPACE_ID);

    expect(pack.rowIds).toEqual([SPACE_ID, CORRIDOR_ID]);
    expect(pack.facts).toMatchObject({
      space: { id: SPACE_ID, corridor_id: CORRIDOR_ID },
    });
  });
});
