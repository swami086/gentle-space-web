import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("./tx", () => ({
  withTenantTransaction: async (_scope: unknown, fn: (c: unknown) => Promise<unknown>) =>
    fn({ query }),
}));

import type { Scope } from "./scope-sql";
import {
  applyRevision,
  createRevision,
  getRequirement,
  listPendingRevisions,
  upsertRequirement,
} from "./enquiry-requirements";

const scope: Scope = { kind: "org", orgId: "org-1" };

const requirementRow = {
  enquiry_id: "enq-1",
  org_id: "org-1",
  desks_min: 35,
  desks_max: 40,
  budget_per_desk_inr: "9500.00",
  move_in_by: new Date("2026-09-01T00:00:00.000Z"),
  must_haves: ["metro walkable"],
  updated_at: new Date("2026-08-12T06:00:00.000Z"),
};

const revisionRow = {
  id: "rev-1",
  org_id: "org-1",
  enquiry_id: "enq-1",
  source: "call_notes",
  proposed: { desksMin: 38, desksMax: 38 },
  applied: false,
  confirmed_by: null,
  confirmed_at: null,
  created_at: new Date("2026-08-12T06:00:00.000Z"),
};

beforeEach(() => query.mockReset());

describe("getRequirement", () => {
  it("maps numerics to numbers and the date to an ISO day", async () => {
    query.mockResolvedValue({ rows: [requirementRow] });
    await expect(getRequirement(scope, "enq-1")).resolves.toEqual({
      enquiryId: "enq-1",
      orgId: "org-1",
      desksMin: 35,
      desksMax: 40,
      budgetPerDeskInr: 9500,
      moveInBy: "2026-09-01",
      mustHaves: ["metro walkable"],
      updatedAt: "2026-08-12T06:00:00.000Z",
    });
  });

  it("returns null when the enquiry has no requirement yet", async () => {
    query.mockResolvedValue({ rows: [] });
    await expect(getRequirement(scope, "enq-2")).resolves.toBeNull();
  });
});

describe("upsertRequirement", () => {
  it("upserts on enquiry_id and leaves omitted fields alone", async () => {
    query.mockResolvedValue({ rows: [requirementRow] });
    await upsertRequirement(scope, "enq-1", { desksMin: 38 });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("ON CONFLICT (enquiry_id) DO UPDATE");
    expect(sql).toContain("COALESCE");
    expect(params).toEqual(["org-1", "enq-1", 38, null, null, null, null]);
  });
});

describe("createRevision", () => {
  it("records a proposal that is not applied", async () => {
    query.mockResolvedValue({ rows: [revisionRow] });
    const revision = await createRevision(scope, {
      enquiryId: "enq-1",
      source: "call_notes",
      proposed: { desksMin: 38, desksMax: 38 },
    });
    expect(revision.applied).toBe(false);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("INSERT INTO adsagent.enquiry_requirement_revisions");
    expect(sql).not.toContain("applied = true");
    expect(params).toEqual([
      "org-1",
      "enq-1",
      "call_notes",
      JSON.stringify({ desksMin: 38, desksMax: 38 }),
    ]);
  });
});

describe("listPendingRevisions", () => {
  it("returns only unapplied proposals", async () => {
    query.mockResolvedValue({ rows: [revisionRow] });
    await listPendingRevisions(scope, "enq-1");
    expect(String(query.mock.calls[0][0])).toContain("applied = false");
  });
});

describe("applyRevision", () => {
  it("requires a confirming user, so nothing auto-applies (C3)", async () => {
    await expect(applyRevision(scope, "rev-1", "")).rejects.toThrow(/confirmedBy is required/i);
  });

  it("marks the revision applied and writes the requirement in one transaction", async () => {
    query
      .mockResolvedValueOnce({ rows: [revisionRow] })
      .mockResolvedValueOnce({ rows: [requirementRow] })
      .mockResolvedValueOnce({ rows: [] });
    const applied = await applyRevision(scope, "rev-1", "user-7");
    expect(applied?.desksMin).toBe(35);
    const statements = query.mock.calls.map((c) => String(c[0]));
    expect(statements[0]).toContain("SELECT");
    expect(statements[1]).toContain("INSERT INTO adsagent.enquiry_requirements");
    expect(statements[2]).toContain("applied = true");
    expect(query.mock.calls[2][1]).toEqual(["org-1", "rev-1", "user-7"]);
  });

  it("returns null for an already-applied revision rather than applying it twice", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await expect(applyRevision(scope, "rev-1", "user-7")).resolves.toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
  });
});
