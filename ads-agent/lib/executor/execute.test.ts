import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Campaign, Proposal } from "../types";

const {
  getProposalById,
  markProposalExecuted,
  markProposalFailed,
  createCampaignRecord,
  markCampaignActive,
  updateCampaignBudget,
  updateCampaignStatus,
  getCampaignById,
  createMetaCampaign,
  pauseMetaCampaign,
  updateMetaCampaignBudget,
  createFullGoogleCampaign,
  pauseGoogleCampaign,
  updateGoogleCampaignBudget,
  addGoogleNegativeKeyword,
  createGoogleShareCampaign,
  createMetaListingShares,
  callGoogleAdsTool,
  unifiedSandboxConfigured,
  createPausedUnifiedCampaign,
  pauseUnifiedCampaign,
  updateUnifiedCampaignBudget,
  addUnifiedNegativeKeyword,
  withTenantTransaction,
  listCurrent,
  campaignUpdateMock,
  adSetUpdateMock,
  adUpdateMock,
} = vi.hoisted(() => ({
  getProposalById: vi.fn(),
  markProposalExecuted: vi.fn(),
  markProposalFailed: vi.fn(),
  createCampaignRecord: vi.fn(),
  markCampaignActive: vi.fn(),
  updateCampaignBudget: vi.fn(),
  updateCampaignStatus: vi.fn(),
  getCampaignById: vi.fn(),
  createMetaCampaign: vi.fn(),
  pauseMetaCampaign: vi.fn(),
  updateMetaCampaignBudget: vi.fn(),
  createFullGoogleCampaign: vi.fn(),
  pauseGoogleCampaign: vi.fn(),
  updateGoogleCampaignBudget: vi.fn(),
  addGoogleNegativeKeyword: vi.fn(),
  createGoogleShareCampaign: vi.fn(),
  createMetaListingShares: vi.fn(),
  callGoogleAdsTool: vi.fn(),
  unifiedSandboxConfigured: vi.fn(() => false),
  createPausedUnifiedCampaign: vi.fn(),
  pauseUnifiedCampaign: vi.fn(),
  updateUnifiedCampaignBudget: vi.fn(),
  addUnifiedNegativeKeyword: vi.fn(),
  withTenantTransaction: vi.fn(),
  listCurrent: vi.fn(),
  campaignUpdateMock: vi.fn(),
  adSetUpdateMock: vi.fn(),
  adUpdateMock: vi.fn(),
}));

vi.mock("../db/proposals", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db/proposals")>();
  return {
    ...actual,
    getProposalById,
    markProposalExecuted,
    markProposalFailed,
  };
});
vi.mock("../db/campaigns", () => ({
  createCampaignRecord,
  markCampaignActive,
  updateCampaignBudget,
  updateCampaignStatus,
  getCampaignById,
}));
vi.mock("../connectors/meta", () => ({
  createMetaCampaign,
  pauseMetaCampaign,
  updateMetaCampaignBudget,
  createMetaListingShares,
}));
vi.mock("../connectors/unified-sandbox", () => ({
  unifiedSandboxConfigured,
  createPausedUnifiedCampaign,
  pauseUnifiedCampaign,
  updateUnifiedCampaignBudget,
  addUnifiedNegativeKeyword,
}));
vi.mock("../connectors/google-ads", () => ({
  createFullGoogleCampaign,
  pauseGoogleCampaign,
  updateGoogleCampaignBudget,
  addGoogleNegativeKeyword,
  createGoogleShareCampaign,
}));
vi.mock("../bifrost/google-ads-mcp-client", () => ({ callGoogleAdsTool }));
vi.mock("../db/tx", () => ({ withTenantTransaction }));
vi.mock("../connections/store", () => ({ listCurrent }));
vi.mock("../tracing/otlp-sink", () => ({
  otlpSpanSink: () => ({ emit: vi.fn().mockResolvedValue(undefined) }),
}));
vi.mock("facebook-nodejs-business-sdk", () => ({
  FacebookAdsApi: vi.fn(function FacebookAdsApi(this: unknown) {
    return this;
  }),
  Campaign: Object.assign(
    vi.fn(function Campaign() {
      return { update: campaignUpdateMock };
    }),
    { Fields: { status: "status" }, Status: { active: "ACTIVE" } },
  ),
  AdSet: Object.assign(
    vi.fn(function AdSet() {
      return { update: adSetUpdateMock };
    }),
    { Fields: { status: "status" }, Status: { active: "ACTIVE" } },
  ),
  Ad: Object.assign(
    vi.fn(function Ad() {
      return { update: adUpdateMock };
    }),
    { Fields: { status: "status" }, Status: { active: "ACTIVE" } },
  ),
}));

import { executeProposal, executeShareMove } from "./execute";

function executingProposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    id: "prop-1",
    kind: "pause",
    campaignId: "camp-1",
    payload: { campaignId: "camp-1" },
    triggeredRule: "kill_rule",
    rationale: "over budget",
    status: "executing",
    error: null,
    createdAt: "2026-08-03T00:00:00.000Z",
    decidedAt: "2026-08-03T01:00:00.000Z",
    executedAt: null,
    scheduledFor: "2026-08-12T00:00:00.000Z",
    undoUntil: "2026-08-12T00:05:00.000Z",
    batchId: null,
    ...overrides,
  };
}

function googleCampaign(overrides: Partial<Campaign> = {}): Campaign {
  return {
    id: "camp-1",
    platform: "google",
    externalId: "customers/1/campaigns/999",
    name: "Whitefield Search",
    status: "active",
    dailyBudget: 500,
    corridor: "whitefield",
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

const ORG = { kind: "org" as const, orgId: "00000000-0000-0000-0000-000000000001" };

const listingPayload = {
  traceId: "trace-listing-1",
  market: "IN" as const,
  sector: "commercial_office" as const,
  approverPhone: "+919800000000",
  ceilings: [
    { platform: "meta" as const, ceilingMinor: 30_000 },
    { platform: "google" as const, ceilingMinor: 20_000 },
  ],
  shares: [
    { platform: "meta" as const, budgetMinor: 30_000 },
    { platform: "google" as const, budgetMinor: 20_000 },
  ],
  endTimeIso: "2026-12-01T00:00:00+0530",
  pageId: "page-1",
  campaignName: "Koramangala listing",
  google: {
    geoTargetConstant: "geoTargetConstants/2356",
    languageConstant: "languageConstants/1000",
    adGroupName: "Office Space",
    keywords: [{ text: "office koramangala", matchType: "phrase" as const }],
    negativeKeywords: ["sale"],
    headlines: ["Office in Koramangala"],
    descriptions: ["Verified listings."],
    finalUrl: "https://example.com/spaces",
  },
  metaShares: [
    {
      name: "prop-1 Share A",
      message: "Office space",
      imageHash: "img-1",
      link: "https://example.com/listing",
    },
  ],
};

function mockTenantDb(options: {
  googleCanActivate?: boolean;
  metaCanActivate?: boolean;
  writesEnabled?: boolean;
  failShareUpdate?: boolean;
} = {}) {
  const googleCanActivate = options.googleCanActivate ?? true;
  const metaCanActivate = options.metaCanActivate ?? true;
  const writesEnabled = options.writesEnabled ?? true;
  const failShareUpdate = options.failShareUpdate ?? false;
  let shareInserts = 0;
  withTenantTransaction.mockImplementation(async (_scope, fn) =>
    fn({
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        tenantQueries.push({ sql, params });
        if (sql.includes("INSERT INTO adsagent.listings")) {
          return { rows: [{ id: "listing-1" }] };
        }
        if (sql.includes("INSERT INTO adsagent.listing_shares")) {
          shareInserts += 1;
          return { rows: [{ id: `share-${shareInserts}` }] };
        }
        if (sql.includes("adsagent.connections")) {
          const platform = params?.[1];
          if (platform === "google") {
            return { rows: [{ id: "conn-google", can_activate: googleCanActivate }] };
          }
          return { rows: [{ id: "conn-meta", can_activate: metaCanActivate }] };
        }
        if (sql.includes("writes_enabled")) {
          return { rows: [{ writes_enabled: writesEnabled }] };
        }
        if (failShareUpdate && sql.includes("UPDATE adsagent.listing_shares")) {
          throw new Error("share id store failed");
        }
        return { rows: [] };
      }),
    }),
  );
}

const tenantQueries: { sql: string; params?: unknown[] }[] = [];

beforeEach(() => {
  tenantQueries.length = 0;
  vi.clearAllMocks();
  process.env.GOOGLE_ADS_CUSTOMER_ID = "1234567890";
  process.env.META_ACCESS_TOKEN = "meta-token";
  listCurrent.mockResolvedValue([]);
  mockTenantDb();
  campaignUpdateMock.mockResolvedValue(undefined);
  adSetUpdateMock.mockResolvedValue(undefined);
  adUpdateMock.mockResolvedValue(undefined);
  callGoogleAdsTool.mockResolvedValue({ ok: true });
  pauseGoogleCampaign.mockResolvedValue(undefined);
  pauseMetaCampaign.mockResolvedValue(undefined);
  createFullGoogleCampaign.mockResolvedValue("customers/1/campaigns/999");
  createMetaCampaign.mockResolvedValue("ext-meta-new");
  createGoogleShareCampaign.mockResolvedValue(501);
  createMetaListingShares.mockResolvedValue({
    campaignId: "meta-camp-1",
    formId: "form-1",
    shares: [{ adSetId: "set-1", adId: "ad-1" }],
  });
  unifiedSandboxConfigured.mockReturnValue(false);
});

describe("executeProposal", () => {
  it("throws when the proposal does not exist", async () => {
    getProposalById.mockResolvedValue(null);
    await expect(executeProposal(ORG, "missing")).rejects.toThrow("proposal missing not found");
  });

  it("throws when the proposal is not executing", async () => {
    getProposalById.mockResolvedValue(executingProposal({ status: "scheduled" }));
    await expect(executeProposal(ORG, "prop-1")).rejects.toThrow("not executing");
  });

  it("pauses the correct platform campaign and marks the proposal executed", async () => {
    getProposalById.mockResolvedValue(executingProposal());
    getCampaignById.mockResolvedValue(googleCampaign());
    process.env.UNIFIED_GOOGLE_ADS_CONNECTION_ID = "google-sandbox";

    const result = await executeProposal(ORG, "prop-1");

    expect(pauseUnifiedCampaign).toHaveBeenCalledWith(
      "google-sandbox",
      "customers/1/campaigns/999",
      "test",
    );
    expect(pauseGoogleCampaign).not.toHaveBeenCalled();
    expect(updateCampaignStatus).toHaveBeenCalledWith(ORG, "camp-1", "paused");
    expect(markProposalExecuted).toHaveBeenCalledWith(ORG, "prop-1");
    expect(result).toEqual({ status: "executed" });
  });

  it("routes pause to the Meta connector for a meta campaign", async () => {
    getProposalById.mockResolvedValue(executingProposal());
    getCampaignById.mockResolvedValue(googleCampaign({ platform: "meta", externalId: "ext-meta-1" }));
    process.env.UNIFIED_META_ADS_CONNECTION_ID = "meta-sandbox";

    await executeProposal(ORG, "prop-1");
    expect(pauseUnifiedCampaign).toHaveBeenCalledWith("meta-sandbox", "ext-meta-1", "test");
    expect(pauseMetaCampaign).not.toHaveBeenCalled();
  });

  it("creates a paused Unified campaign for a corridor payload", async () => {
    getProposalById.mockResolvedValue(
      executingProposal({
        kind: "create_campaign",
        campaignId: null,
        payload: {
          corridor: "whitefield",
          platform: "google",
          dailyBudgetInr: 500,
          geoTargetConstant: "geoTargetConstants/2356",
          languageConstant: "languageConstants/1000",
          adGroupName: "Whitefield Office Space",
          keywords: [{ text: "office space whitefield", matchType: "phrase" }],
          negativeKeywords: ["residential"],
          headlines: ["Office Space in Whitefield", "Verified Listings Only", "Tour in 5 Days"],
          descriptions: ["Skip the broker games.", "AI-matched, human-verified commercial space."],
          finalUrl: "https://www.gentlespacesolutions.com/spaces",
        },
      }),
    );
    createCampaignRecord.mockResolvedValue(googleCampaign({ status: "proposed", externalId: null }));
    process.env.UNIFIED_GOOGLE_ADS_CONNECTION_ID = "google-sandbox";
    createPausedUnifiedCampaign.mockResolvedValue("unified-camp-1");

    const result = await executeProposal(ORG, "prop-1");

    expect(createCampaignRecord).toHaveBeenCalledWith(ORG, {
      platform: "google",
      name: expect.stringContaining("whitefield"),
      dailyBudget: 500,
      corridor: "whitefield",
    });
    expect(createFullGoogleCampaign).not.toHaveBeenCalled();
    expect(createPausedUnifiedCampaign).toHaveBeenCalledWith(
      {
        connectionId: "google-sandbox",
        name: expect.stringContaining("whitefield"),
        budgetAmount: 500,
        budgetPeriod: "DAILY",
        advertisingChannelType: "SEARCH",
      },
      "test",
    );
    expect(markCampaignActive).toHaveBeenCalledWith(ORG, "camp-1", "unified-camp-1");
    expect(result).toEqual({ status: "executed" });
  });

  it("updates budget on the correct campaign", async () => {
    getProposalById.mockResolvedValue(
      executingProposal({
        kind: "budget_change",
        payload: { campaignId: "camp-1", newDailyBudgetInr: 600 },
      }),
    );
    getCampaignById.mockResolvedValue(googleCampaign());
    process.env.UNIFIED_GOOGLE_ADS_CONNECTION_ID = "google-sandbox";

    await executeProposal(ORG, "prop-1");
    expect(updateUnifiedCampaignBudget).toHaveBeenCalledWith(
      "google-sandbox",
      "customers/1/campaigns/999",
      600,
      "test",
    );
    expect(updateGoogleCampaignBudget).not.toHaveBeenCalled();
    expect(updateCampaignBudget).toHaveBeenCalledWith(ORG, "camp-1", 600);
  });

  it("adds a negative keyword on the correct campaign", async () => {
    getProposalById.mockResolvedValue(
      executingProposal({
        kind: "add_negative_keyword",
        payload: { campaignId: "camp-1", keywordText: "residential" },
      }),
    );
    getCampaignById.mockResolvedValue(googleCampaign());
    process.env.UNIFIED_GOOGLE_ADS_CONNECTION_ID = "google-sandbox";

    await executeProposal(ORG, "prop-1");
    expect(addUnifiedNegativeKeyword).toHaveBeenCalledWith(
      "google-sandbox",
      "customers/1/campaigns/999",
      "residential",
      "test",
    );
    expect(addGoogleNegativeKeyword).not.toHaveBeenCalled();
  });

  it("no-ops a campaign_strategy proposal and marks it executed without touching any connector", async () => {
    getProposalById.mockResolvedValue(
      executingProposal({
        kind: "campaign_strategy",
        campaignId: null,
        payload: { summary: "Shift budget toward Whitefield", recommendations: [] },
      }),
    );

    const result = await executeProposal(ORG, "prop-1");

    expect(getCampaignById).not.toHaveBeenCalled();
    expect(pauseGoogleCampaign).not.toHaveBeenCalled();
    expect(markProposalExecuted).toHaveBeenCalledWith(ORG, "prop-1");
    expect(result).toEqual({ status: "executed" });
  });

  it("executes agent dotted campaign.pause like snake_case pause", async () => {
    getProposalById.mockResolvedValue(
      executingProposal({ kind: "campaign.pause" as never }),
    );
    getCampaignById.mockResolvedValue(googleCampaign());
    process.env.UNIFIED_GOOGLE_ADS_CONNECTION_ID = "google-sandbox";

    const result = await executeProposal(ORG, "prop-1");

    expect(pauseUnifiedCampaign).toHaveBeenCalledWith(
      "google-sandbox",
      "customers/1/campaigns/999",
      "test",
    );
    expect(markProposalExecuted).toHaveBeenCalledWith(ORG, "prop-1");
    expect(result).toEqual({ status: "executed" });
  });

  it("marks an unrecognized proposal kind as failed instead of silently executing it", async () => {
    getProposalById.mockResolvedValue(executingProposal({ kind: "future_kind" as never }));

    const result = await executeProposal(ORG, "prop-1");

    expect(markProposalExecuted).not.toHaveBeenCalled();
    expect(markProposalFailed).toHaveBeenCalledWith(
      ORG,
      "prop-1",
      expect.stringContaining("future_kind"),
    );
    expect(result).toEqual({ status: "failed", error: expect.stringContaining("future_kind") });
  });

  it("marks the proposal failed (never retried) when the connector call throws", async () => {
    getProposalById.mockResolvedValue(executingProposal());
    getCampaignById.mockResolvedValue(googleCampaign());
    process.env.UNIFIED_GOOGLE_ADS_CONNECTION_ID = "google-sandbox";
    pauseUnifiedCampaign.mockRejectedValue(new Error("unified campaign was not paused"));

    const result = await executeProposal(ORG, "prop-1");

    expect(markProposalFailed).toHaveBeenCalledWith(ORG, "prop-1", "unified campaign was not paused");
    expect(markProposalExecuted).not.toHaveBeenCalled();
    expect(result).toEqual({ status: "failed", error: "unified campaign was not paused" });
  });

  it("builds listing shares on Unified and does not switch them on", async () => {
    unifiedSandboxConfigured.mockReturnValue(true);
    process.env.UNIFIED_GOOGLE_ADS_CONNECTION_ID = "google-sandbox";
    process.env.UNIFIED_META_ADS_CONNECTION_ID = "meta-sandbox";
    createPausedUnifiedCampaign
      .mockResolvedValueOnce("meta-camp-1")
      .mockResolvedValueOnce("google-camp-1");
    getProposalById.mockResolvedValue(
      executingProposal({
        kind: "create_campaign",
        campaignId: null,
        payload: listingPayload,
      }),
    );

    const result = await executeProposal(ORG, "prop-1");

    expect(createGoogleShareCampaign).not.toHaveBeenCalled();
    expect(createMetaListingShares).not.toHaveBeenCalled();
    expect(callGoogleAdsTool).not.toHaveBeenCalled();
    expect(campaignUpdateMock).not.toHaveBeenCalled();
    expect(createPausedUnifiedCampaign).toHaveBeenNthCalledWith(
      1,
      {
        connectionId: "meta-sandbox",
        name: "prop-1 meta share 1",
        budgetAmount: 300,
        budgetPeriod: "LIFETIME",
        goal: "LEADS",
      },
      "test",
    );
    expect(createPausedUnifiedCampaign).toHaveBeenNthCalledWith(
      2,
      {
        connectionId: "google-sandbox",
        name: "prop-1 google share 1",
        budgetAmount: 200,
        budgetPeriod: "TOTAL",
        advertisingChannelType: "SEARCH",
      },
      "test",
    );
    expect(result.result).toEqual({
      traceId: "trace-listing-1",
      activated: false,
      sandbox: { googleCampaignIds: ["google-camp-1"], metaCampaignIds: ["meta-camp-1"] },
    });
  });

  it("fault after_claim makes no platform calls", async () => {
    getProposalById.mockResolvedValue(
      executingProposal({ kind: "create_campaign", campaignId: null, payload: listingPayload }),
    );

    const result = await executeProposal(ORG, "prop-1", "after_claim");

    expect(createGoogleShareCampaign).not.toHaveBeenCalled();
    expect(createMetaListingShares).not.toHaveBeenCalled();
    expect(markProposalFailed).toHaveBeenCalledWith(ORG, "prop-1", expect.stringContaining("after_claim"));
    expect(createPausedUnifiedCampaign).not.toHaveBeenCalled();
    expect(result.status).toBe("failed");
  });

  it("stores the campaign id when the payload has no ad fields", async () => {
    unifiedSandboxConfigured.mockReturnValue(true);
    process.env.UNIFIED_META_ADS_CONNECTION_ID = "meta-sandbox";
    createPausedUnifiedCampaign.mockResolvedValueOnce("meta-camp-1");
    getProposalById.mockResolvedValue(
      executingProposal({
        kind: "create_campaign",
        campaignId: null,
        payload: {
          traceId: "trace-listing-2",
          market: "IN",
          sector: "residential",
          approverPhone: "+919800000000",
          ceilings: [{ platform: "meta", ceilingMinor: 15_000 }],
          shares: [{ platform: "meta", budgetMinor: 15_000 }],
        },
      }),
    );

    const result = await executeProposal(ORG, "prop-1");

    expect(result.result).toMatchObject({ activated: false, traceId: "trace-listing-2" });
    expect(createPausedUnifiedCampaign).toHaveBeenCalledTimes(1);
    expect(
      tenantQueries.some(
        (query) => query.sql.includes("UPDATE adsagent.listing_shares") && query.params?.[1] === "meta-camp-1",
      ),
    ).toBe(true);
  });

  it("does not call Unified when writes_enabled is false", async () => {
    mockTenantDb({ writesEnabled: false });
    process.env.UNIFIED_META_ADS_CONNECTION_ID = "meta-sandbox";
    getProposalById.mockResolvedValue(
      executingProposal({
        kind: "create_campaign",
        campaignId: null,
        payload: {
          traceId: "trace-listing-2",
          market: "IN",
          sector: "residential",
          approverPhone: "+919800000000",
          ceilings: [{ platform: "meta", ceilingMinor: 15_000 }],
          shares: [{ platform: "meta", budgetMinor: 15_000 }],
        },
      }),
    );

    const result = await executeProposal(ORG, "prop-1");

    expect(result).toMatchObject({
      status: "failed",
      error: expect.stringMatching(/writes_enabled is false/),
    });
    expect(createPausedUnifiedCampaign).not.toHaveBeenCalled();
  });

  it("does not call Unified when the connection id is outside the allowlist", async () => {
    const customer = { kind: "org" as const, orgId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" };
    listCurrent.mockResolvedValue([
      {
        id: "conn-1",
        orgId: customer.orgId,
        platform: "meta",
        externalAccountId: "meta-sandbox",
        environment: "test",
        credentialsSealed: Buffer.from(""),
        canWrite: true,
        canActivate: false,
        allowlist: ["other-connection"],
        currency: "INR",
        timeZone: "Asia/Kolkata",
        status: "current",
        createdAt: "2026-11-02T00:00:00.000Z",
      },
    ]);
    getProposalById.mockResolvedValue(
      executingProposal({
        kind: "create_campaign",
        campaignId: null,
        payload: {
          traceId: "trace-listing-2",
          market: "IN",
          sector: "residential",
          approverPhone: "+919800000000",
          ceilings: [{ platform: "meta", ceilingMinor: 15_000 }],
          shares: [{ platform: "meta", budgetMinor: 15_000 }],
        },
      }),
    );

    const result = await executeProposal(customer, "prop-1");

    expect(result).toMatchObject({
      status: "failed",
      error: expect.stringMatching(/outside the allowlist/),
    });
    expect(createPausedUnifiedCampaign).not.toHaveBeenCalled();
  });

  it("calls Unified when the connection allowlist is empty", async () => {
    const customer = { kind: "org" as const, orgId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" };
    createPausedUnifiedCampaign.mockResolvedValueOnce("meta-camp-1");
    listCurrent.mockResolvedValue([
      {
        id: "conn-1",
        orgId: customer.orgId,
        platform: "meta",
        externalAccountId: "meta-sandbox",
        environment: "test",
        credentialsSealed: Buffer.from(""),
        canWrite: true,
        canActivate: false,
        allowlist: [],
        currency: "INR",
        timeZone: "Asia/Kolkata",
        status: "current",
        createdAt: "2026-11-02T00:00:00.000Z",
      },
    ]);
    getProposalById.mockResolvedValue(
      executingProposal({
        kind: "create_campaign",
        campaignId: null,
        payload: {
          traceId: "trace-listing-2",
          market: "IN",
          sector: "residential",
          approverPhone: "+919800000000",
          ceilings: [{ platform: "meta", ceilingMinor: 15_000 }],
          shares: [{ platform: "meta", budgetMinor: 15_000 }],
        },
      }),
    );

    const result = await executeProposal(customer, "prop-1");

    expect(result.status).toBe("executed");
    expect(createPausedUnifiedCampaign).toHaveBeenCalledTimes(1);
  });

  it("pauses a created campaign when storing its id fails", async () => {
    mockTenantDb({ failShareUpdate: true });
    process.env.UNIFIED_META_ADS_CONNECTION_ID = "meta-sandbox";
    pauseUnifiedCampaign.mockResolvedValue(undefined);
    createPausedUnifiedCampaign.mockResolvedValueOnce("meta-camp-1");
    getProposalById.mockResolvedValue(
      executingProposal({
        kind: "create_campaign",
        campaignId: null,
        payload: {
          traceId: "trace-listing-2",
          market: "IN",
          sector: "residential",
          approverPhone: "+919800000000",
          ceilings: [{ platform: "meta", ceilingMinor: 15_000 }],
          shares: [{ platform: "meta", budgetMinor: 15_000 }],
        },
      }),
    );

    const result = await executeProposal(ORG, "prop-1");

    expect(result).toMatchObject({ status: "failed", error: "share id store failed" });
    expect(pauseUnifiedCampaign).toHaveBeenCalledWith("meta-sandbox", "meta-camp-1", "test");
    expect(markProposalExecuted).not.toHaveBeenCalled();
  });
});

describe("executeShareMove", () => {
  it("throws when writes_enabled is false and does not call updateUnifiedCampaignBudget", async () => {
    mockTenantDb({ writesEnabled: false });
    await expect(executeShareMove(ORG, "listing-1")).rejects.toThrow(/writes_enabled is false/);
    expect(updateUnifiedCampaignBudget).not.toHaveBeenCalled();
  });
});

describe("execute.ts listing guardrails", () => {
  it("does not reference legacy Meta or Google listing share helpers", () => {
    const executePath = join(dirname(fileURLToPath(import.meta.url)), "execute.ts");
    const source = readFileSync(executePath, "utf8");
    for (const forbidden of [
      "createMetaListingShares",
      "updateMetaAdSetLifetimeBudget",
      "createGoogleShareCampaign",
      "updateGoogleShareBudget",
      "enableGoogleShareCampaign",
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });
});

describe("listing budget_change", () => {
  it("throws before Unified PUT when a share would fall below spend", async () => {
    getProposalById.mockResolvedValue(
      executingProposal({
        kind: "budget_change",
        campaignId: null,
        payload: {
          listingId: "listing-1",
          ceilings: [{ platform: "meta", ceilingMinor: 3_000 }],
        },
      }),
    );
    withTenantTransaction.mockImplementation(async (_scope, fn) =>
      fn({
        query: vi.fn(async (sql: string) => {
          if (sql.includes("listing_shares")) {
            return {
              rows: [
                {
                  id: "share-a",
                  platform: "meta",
                  external_campaign_id: "meta-camp-1",
                  budget_minor: 10_000,
                  spend_minor: 5_000,
                  lead_count: 0,
                  last_share_move_on: null,
                },
              ],
            };
          }
          if (sql.includes("listing_ceilings")) {
            return { rows: [{ platform: "meta", ceiling_minor: 10_000 }] };
          }
          if (sql.includes("writes_enabled")) {
            return { rows: [{ writes_enabled: true }] };
          }
          return { rows: [] };
        }),
      }),
    );
    process.env.UNIFIED_META_ADS_CONNECTION_ID = "meta-sandbox";

    const result = await executeProposal(ORG, "prop-1");

    expect(updateUnifiedCampaignBudget).not.toHaveBeenCalled();
    expect(markProposalFailed).toHaveBeenCalledWith(
      ORG,
      "prop-1",
      expect.stringMatching(/below spend/),
    );
    expect(result.status).toBe("failed");
  });
});
