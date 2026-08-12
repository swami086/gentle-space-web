import { beforeEach, describe, expect, it, vi } from "vitest";

const { createDraft } = vi.hoisted(() => ({
  createDraft: vi.fn(),
}));
vi.mock("../db/campaign-drafts", () => ({ createDraft }));

import { campaignToolHandlers, campaignToolProvider, campaignToolSpecs } from "./campaign-tools";

const ORG = { kind: "org" as const, orgId: "org-1" };

beforeEach(() => {
  createDraft.mockReset();
  process.env.ADS_AGENT_ORG_ID = "org-1";
});

describe("campaignToolHandlers.start_campaign_draft", () => {
  it("creates a draft and returns id + path", async () => {
    createDraft.mockResolvedValue({ id: "draft-abc" });
    const result = await campaignToolHandlers.start_campaign_draft(ORG, {});
    expect(createDraft).toHaveBeenCalledWith(ORG);
    expect(result).toEqual({ id: "draft-abc", path: "/campaigns/drafts/draft-abc" });
  });
});

describe("campaignToolProvider.start_campaign_draft", () => {
  it("binds ADS_AGENT_ORG_ID when invoked through the Copilot registry", async () => {
    createDraft.mockResolvedValue({ id: "draft-abc" });
    await campaignToolProvider.start_campaign_draft({});
    expect(createDraft).toHaveBeenCalledWith(ORG);
  });
});

describe("campaignToolSpecs", () => {
  it("registers start_campaign_draft", () => {
    expect(campaignToolSpecs.map((s) => s.name)).toEqual(["start_campaign_draft"]);
  });
});
