import { beforeEach, describe, expect, it, vi } from "vitest";

const { createDraft } = vi.hoisted(() => ({
  createDraft: vi.fn(),
}));
vi.mock("../db/campaign-drafts", () => ({ createDraft }));

import { campaignToolProvider, campaignToolSpecs } from "./campaign-tools";

beforeEach(() => {
  createDraft.mockReset();
});

describe("campaignToolProvider.start_campaign_draft", () => {
  it("creates a draft and returns id + path", async () => {
    createDraft.mockResolvedValue({ id: "draft-abc" });
    const result = await campaignToolProvider.start_campaign_draft({});
    expect(createDraft).toHaveBeenCalledOnce();
    expect(result).toEqual({ id: "draft-abc", path: "/campaigns/drafts/draft-abc" });
  });
});

describe("campaignToolSpecs", () => {
  it("registers start_campaign_draft", () => {
    expect(campaignToolSpecs.map((s) => s.name)).toEqual(["start_campaign_draft"]);
  });
});
