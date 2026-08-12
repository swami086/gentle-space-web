import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("./tx", () => ({
  withTenantTransaction: (_scope: unknown, fn: (c: { query: typeof query }) => unknown) => fn({ query }),
}));

import type { Scope } from "./scope-sql";
import {
  appendDraftMessage,
  createDraft,
  getDraftById,
  listDraftMessages,
  markDraftConverted,
  setDraftStatus,
  updateDraftFields,
} from "./campaign-drafts";

const ORG: Scope = { kind: "org", orgId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" };

const draftRow = {
  id: "draft-1",
  status: "chatting",
  corridor: null,
  daily_budget_inr: null,
  ad_group_name: null,
  keywords: [],
  headlines: [],
  descriptions: [],
  final_url: "https://www.gentlespacesolutions.com/spaces",
  proposal_id: null,
  created_at: new Date("2026-08-03T00:00:00.000Z"),
  updated_at: new Date("2026-08-03T00:00:00.000Z"),
};

beforeEach(() => query.mockReset());

describe("createDraft", () => {
  it("stamps the caller's org_id", async () => {
    query.mockResolvedValue({ rows: [draftRow] });
    await createDraft(ORG);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("INSERT INTO adsagent.campaign_drafts (org_id)");
    expect(params).toEqual([ORG.orgId]);
  });
});

describe("getDraftById", () => {
  it("returns null for a draft outside the caller's scope", async () => {
    query.mockResolvedValue({ rows: [] });
    await expect(getDraftById(ORG, "draft-x")).resolves.toBeNull();
    expect(query.mock.calls[0][1]).toEqual([ORG.orgId, "draft-x"]);
  });
});

describe("updateDraftFields", () => {
  it("numbers field placeholders from $3, after scope and id", async () => {
    query.mockResolvedValue({ rows: [{ ...draftRow, corridor: "HSR" }] });
    await updateDraftFields(ORG, "draft-1", { corridor: "HSR" });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("corridor = $3");
    expect(sql).toContain("org_id = $1::uuid");
    expect(sql).toContain("id = $2");
    expect(params).toEqual([ORG.orgId, "draft-1", "HSR"]);
  });

  it("serialises json fields", async () => {
    query.mockResolvedValue({ rows: [draftRow] });
    await updateDraftFields(ORG, "draft-1", { headlines: ["a", "b"] });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("headlines = $3::jsonb");
    expect(params[2]).toBe(JSON.stringify(["a", "b"]));
  });

  it("throws when the scoped update matched nothing", async () => {
    query.mockResolvedValue({ rows: [] });
    await expect(updateDraftFields(ORG, "draft-1", { corridor: "HSR" })).rejects.toThrow(
      "campaign draft draft-1 not found",
    );
  });
});

describe("setDraftStatus", () => {
  it("scopes the update", async () => {
    query.mockResolvedValue({ rows: [] });
    await setDraftStatus(ORG, "draft-1", "ready");
    expect(query.mock.calls[0][1]).toEqual([ORG.orgId, "draft-1", "ready"]);
  });
});

describe("markDraftConverted", () => {
  it("scopes the update", async () => {
    query.mockResolvedValue({ rows: [] });
    await markDraftConverted(ORG, "draft-1", "prop-1");
    expect(query.mock.calls[0][1]).toEqual([ORG.orgId, "draft-1", "prop-1"]);
  });
});

describe("appendDraftMessage", () => {
  it("stamps org_id and only writes against a draft in scope", async () => {
    query.mockResolvedValue({
      rows: [{ id: "m1", draft_id: "draft-1", role: "user", content: "hi", created_at: new Date(0) }],
    });
    await appendDraftMessage(ORG, "draft-1", "user", "hi");
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("adsagent.campaign_draft_messages");
    expect(sql).toContain("adsagent.campaign_drafts");
    expect(params).toEqual([ORG.orgId, "draft-1", "user", "hi"]);
  });

  it("throws when the parent draft is out of scope", async () => {
    query.mockResolvedValue({ rows: [] });
    await expect(appendDraftMessage(ORG, "draft-x", "user", "hi")).rejects.toThrow(
      "campaign draft draft-x not found",
    );
  });
});

describe("listDraftMessages", () => {
  it("scopes the listing", async () => {
    query.mockResolvedValue({ rows: [] });
    await listDraftMessages(ORG, "draft-1");
    expect(query.mock.calls[0][0]).toContain("org_id = $1::uuid");
    expect(query.mock.calls[0][1]).toEqual([ORG.orgId, "draft-1"]);
  });
});
