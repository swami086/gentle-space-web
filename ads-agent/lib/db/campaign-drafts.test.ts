import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("./client", () => ({ getPool: () => ({ query }) }));

import {
  appendDraftMessage,
  createDraft,
  getDraftById,
  listDraftMessages,
  markDraftConverted,
  setDraftStatus,
  updateDraftFields,
} from "./campaign-drafts";

const row = {
  id: "draft-1",
  status: "chatting",
  corridor: "whitefield",
  daily_budget_inr: "500",
  ad_group_name: "Whitefield Office Space",
  keywords: [{ text: "office space whitefield", matchType: "phrase" }],
  headlines: ["Office Space in Whitefield"],
  descriptions: ["Skip the broker games."],
  final_url: "https://www.gentlespacesolutions.com/spaces",
  proposal_id: null,
  created_at: new Date("2026-08-03T00:00:00.000Z"),
  updated_at: new Date("2026-08-03T00:00:00.000Z"),
};

beforeEach(() => query.mockReset());

describe("createDraft", () => {
  it("inserts a default row and returns the mapped draft", async () => {
    query.mockResolvedValue({ rows: [{ ...row, status: "chatting", corridor: null, daily_budget_inr: null, ad_group_name: null, keywords: [], headlines: [], descriptions: [] }] });
    const result = await createDraft();
    expect(result).toMatchObject({ id: "draft-1", status: "chatting", corridor: null, dailyBudgetInr: null });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO campaign_drafts DEFAULT VALUES"));
  });
});

describe("getDraftById", () => {
  it("returns null when missing", async () => {
    query.mockResolvedValue({ rows: [] });
    await expect(getDraftById("missing")).resolves.toBeNull();
  });

  it("maps a found row, converting daily_budget_inr to a number", async () => {
    query.mockResolvedValue({ rows: [row] });
    const result = await getDraftById("draft-1");
    expect(result).toEqual({
      id: "draft-1",
      status: "chatting",
      corridor: "whitefield",
      dailyBudgetInr: 500,
      adGroupName: "Whitefield Office Space",
      keywords: [{ text: "office space whitefield", matchType: "phrase" }],
      headlines: ["Office Space in Whitefield"],
      descriptions: ["Skip the broker games."],
      finalUrl: "https://www.gentlespacesolutions.com/spaces",
      proposalId: null,
      createdAt: "2026-08-03T00:00:00.000Z",
      updatedAt: "2026-08-03T00:00:00.000Z",
    });
  });
});

describe("updateDraftFields", () => {
  it("builds an UPDATE with jsonb casts only for array fields", async () => {
    query.mockResolvedValue({ rows: [row] });
    await updateDraftFields("draft-1", { corridor: "koramangala", headlines: ["New headline"] });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE campaign_drafts SET corridor = $2, headlines = $3::jsonb, updated_at = NOW() WHERE id = $1"),
      ["draft-1", "koramangala", JSON.stringify(["New headline"])],
    );
  });

  it("throws when the draft does not exist", async () => {
    query.mockResolvedValue({ rows: [] });
    await expect(updateDraftFields("missing", { corridor: "hsr" })).rejects.toThrow("campaign draft missing not found");
  });

  it("returns the existing draft unchanged when given an empty patch", async () => {
    query.mockResolvedValueOnce({ rows: [row] });
    const result = await updateDraftFields("draft-1", {});
    expect(result.id).toBe("draft-1");
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("SELECT * FROM campaign_drafts WHERE id = $1"), ["draft-1"]);
  });
});

describe("setDraftStatus", () => {
  it("updates status", async () => {
    query.mockResolvedValue({ rows: [] });
    await setDraftStatus("draft-1", "ready");
    expect(query).toHaveBeenCalledWith(expect.stringContaining("SET status = $2"), ["draft-1", "ready"]);
  });
});

describe("markDraftConverted", () => {
  it("sets status converted and links the proposal", async () => {
    query.mockResolvedValue({ rows: [] });
    await markDraftConverted("draft-1", "prop-1");
    expect(query).toHaveBeenCalledWith(expect.stringContaining("status = 'converted'"), ["draft-1", "prop-1"]);
  });
});

describe("appendDraftMessage and listDraftMessages", () => {
  it("inserts a message and maps the returned row", async () => {
    query.mockResolvedValue({
      rows: [{ id: "msg-1", draft_id: "draft-1", role: "user", content: "hello", created_at: new Date("2026-08-03T00:00:00.000Z") }],
    });
    const result = await appendDraftMessage("draft-1", "user", "hello");
    expect(result).toEqual({ id: "msg-1", draftId: "draft-1", role: "user", content: "hello", createdAt: "2026-08-03T00:00:00.000Z" });
  });

  it("lists messages ordered ascending by created_at", async () => {
    query.mockResolvedValue({ rows: [] });
    await listDraftMessages("draft-1");
    expect(query).toHaveBeenCalledWith(expect.stringContaining("ORDER BY created_at ASC"), ["draft-1"]);
  });
});
