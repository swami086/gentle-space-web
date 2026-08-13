import { beforeEach, describe, expect, it, vi } from "vitest";

const { createDraft } = vi.hoisted(() => ({
  createDraft: vi.fn(),
}));
vi.mock("../db/campaign-drafts", () => ({ createDraft }));

import { campaignToolHandlers, campaignToolSpecs, createCampaignToolProvider } from "./campaign-tools";

const ORG = { kind: "org" as const, orgId: "org-1" };
const SESSION_SCOPE = {
  kind: "org" as const,
  orgId: "10101010-1010-1010-1010-101010101010",
};
const OTHER_ORG = "20202020-2020-2020-2020-202020202020";

beforeEach(() => {
  createDraft.mockReset();
});

describe("campaignToolHandlers.start_campaign_draft", () => {
  it("creates a draft and returns id + path", async () => {
    createDraft.mockResolvedValue({ id: "draft-abc" });
    const result = await campaignToolHandlers.start_campaign_draft(ORG, {});
    expect(createDraft).toHaveBeenCalledWith(ORG);
    expect(result).toEqual({ id: "draft-abc", path: "/campaigns/drafts/draft-abc" });
  });
});

describe("createCampaignToolProvider", () => {
  it("binds the provided scope, not ADS_AGENT_ORG_ID", async () => {
    createDraft.mockResolvedValue({ id: "draft-abc" });
    const provider = createCampaignToolProvider(SESSION_SCOPE);
    await provider.start_campaign_draft({});
    expect(createDraft).toHaveBeenCalledWith(SESSION_SCOPE);
  });

  it("ignores orgId in tool args", async () => {
    createDraft.mockResolvedValue({ id: "draft-abc" });
    const provider = createCampaignToolProvider(SESSION_SCOPE);
    await provider.start_campaign_draft({ orgId: OTHER_ORG });
    expect(createDraft).toHaveBeenCalledWith(SESSION_SCOPE);
    expect(createDraft).not.toHaveBeenCalledWith({ kind: "org", orgId: OTHER_ORG });
  });
});

describe("campaignToolSpecs", () => {
  it("registers start_campaign_draft", () => {
    expect(campaignToolSpecs.map((s) => s.name)).toEqual(["start_campaign_draft"]);
  });
});
