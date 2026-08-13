import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("./tx", () => ({
  withTenantTransaction: (_scope: unknown, fn: (c: { query: typeof query }) => unknown) =>
    fn({ query }),
}));

import type { Scope } from "./scope-sql";
import {
  createSavedFilter,
  deleteSavedFilter,
  listSavedFilters,
} from "./proposal-filters";

const ORG: Scope = { kind: "org", orgId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" };
const PLATFORM: Scope = { kind: "platform", orgId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" };
const USER = "cccccccc-cccc-cccc-cccc-cccccccccccc";

const row = {
  id: "filter-1",
  org_id: ORG.orgId,
  owner_user_id: USER,
  name: "Pending budget changes",
  query: { statuses: ["pending"], kinds: ["budget_change"] },
  created_at: new Date("2026-08-13T00:00:00.000Z"),
};

beforeEach(() => query.mockReset().mockResolvedValue({ rows: [row], rowCount: 1 }));

describe("listSavedFilters", () => {
  it("returns filters owned by the caller", async () => {
    const filters = await listSavedFilters(ORG, USER);
    expect(filters).toHaveLength(1);
    expect(filters[0].name).toBe("Pending budget changes");
    expect(query.mock.calls[0]).toEqual(["SELECT public.set_user($1)", [USER]]);
    const [sql, params] = query.mock.calls[1];
    expect(sql).toContain("FROM adsagent.proposal_saved_filters");
    expect(sql).toContain("owner_user_id = $1");
    expect(sql).toContain("ORDER BY created_at DESC");
    expect(params).toEqual([USER]);
  });
});

describe("createSavedFilter", () => {
  it("stores org_id, owner, name, and query json", async () => {
    await createSavedFilter(PLATFORM, USER, {
      name: "All orgs pending",
      query: { statuses: ["pending"], orgIds: ["org-x"] },
    });
    expect(query.mock.calls[0]).toEqual(["SELECT public.set_user($1)", [USER]]);
    const [sql, params] = query.mock.calls[1];
    expect(sql).toContain("INSERT INTO adsagent.proposal_saved_filters");
    expect(params).toEqual([
      PLATFORM.orgId,
      USER,
      "All orgs pending",
      JSON.stringify({ statuses: ["pending"], orgIds: ["org-x"] }),
    ]);
  });

  it("rejects an empty name", async () => {
    await expect(
      createSavedFilter(ORG, USER, { name: "  ", query: { statuses: ["pending"] } }),
    ).rejects.toThrow(/name must not be empty/i);
  });
});

describe("deleteSavedFilter", () => {
  it("deletes only when id and owner match", async () => {
    query.mockResolvedValue({ rows: [{ id: row.id }], rowCount: 1 });
    await expect(deleteSavedFilter(ORG, USER, row.id)).resolves.toBe(true);
    expect(query.mock.calls[0]).toEqual(["SELECT public.set_user($1)", [USER]]);
    const [sql, params] = query.mock.calls[1];
    expect(sql).toContain("DELETE FROM adsagent.proposal_saved_filters");
    expect(sql).toContain("owner_user_id = $2");
    expect(params).toEqual([row.id, USER]);
  });

  it("returns false when nothing matched", async () => {
    query.mockResolvedValue({ rows: [], rowCount: 0 });
    await expect(deleteSavedFilter(ORG, USER, "missing")).resolves.toBe(false);
  });
});
