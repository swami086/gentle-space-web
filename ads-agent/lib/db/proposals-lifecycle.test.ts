import { beforeEach, describe, expect, it, vi } from "vitest";

const { query, withCrossTenantRead, withTenantTransaction } = vi.hoisted(() => ({
  query: vi.fn(),
  withCrossTenantRead: vi.fn(),
  withTenantTransaction: vi.fn(),
}));

vi.mock("./tx", () => ({ withTenantTransaction }));
vi.mock("./cross-tenant", () => ({ withCrossTenantRead }));

import type { Scope } from "./scope-sql";
import {
  cancelScheduledBatch,
  cancelScheduledProposal,
  claimDueScheduledProposals,
  scheduleProposal,
} from "./proposals";

const ORG: Scope = { kind: "org", orgId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" };

const scheduledRow = {
  id: "prop-1",
  kind: "pause",
  campaign_id: "camp-1",
  payload: { campaignId: "camp-1" },
  triggered_rule: "kill_rule",
  rationale: null,
  status: "scheduled",
  error: null,
  created_at: new Date("2026-08-03T00:00:00.000Z"),
  decided_at: new Date("2026-08-12T00:00:00.000Z"),
  executed_at: null,
  scheduled_for: new Date("2026-08-12T00:00:00.000Z"),
  undo_until: new Date("2026-08-12T00:05:00.000Z"),
  batch_id: "batch-1",
};

beforeEach(() => {
  query.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
  withTenantTransaction.mockReset().mockImplementation(
    async (_scope: unknown, fn: (c: { query: typeof query }) => unknown) => fn({ query }),
  );
  withCrossTenantRead.mockReset().mockImplementation(
    async (_actor: string, fn: (c: { query: typeof query }) => unknown) => fn({ query }),
  );
});

describe("scheduleProposal", () => {
  it("scopes the update and sets scheduled lifecycle fields", async () => {
    query.mockResolvedValue({ rows: [scheduledRow] });
    const result = await scheduleProposal(ORG, "prop-1", {
      decidedBy: "user-1",
      decidedVia: "ui",
      undoWindowSeconds: 300,
      batchId: "batch-1",
    });
    expect(result?.status).toBe("scheduled");
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("org_id = $1::uuid");
    expect(sql).toContain("status = 'scheduled'");
    expect(sql).toContain("decided_by = $3");
    expect(sql).toContain("decided_via = $4");
    expect(sql).toContain("undo_until = NOW()");
    expect(sql).toContain("batch_id = $6");
    expect(params).toEqual([ORG.orgId, "prop-1", "user-1", "ui", 300, "batch-1"]);
  });

  it("returns null when nothing matched", async () => {
    query.mockResolvedValue({ rows: [] });
    await expect(
      scheduleProposal(ORG, "missing", {
        decidedBy: "user-1",
        decidedVia: "bulk",
        undoWindowSeconds: 0,
      }),
    ).resolves.toBeNull();
  });
});

describe("cancelScheduledProposal", () => {
  it("reverts only scheduled rows still inside the undo window", async () => {
    query.mockResolvedValue({ rows: [{ ...scheduledRow, status: "pending" }] });
    await cancelScheduledProposal(ORG, "prop-1");
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("status = 'scheduled'");
    expect(sql).toContain("undo_until > now()");
    expect(sql).toContain("status = 'pending'");
    expect(params).toEqual([ORG.orgId, "prop-1"]);
  });

  it("returns null when the undo window has passed", async () => {
    query.mockResolvedValue({ rows: [] });
    await expect(cancelScheduledProposal(ORG, "prop-1")).resolves.toBeNull();
  });
});

describe("cancelScheduledBatch", () => {
  it("returns the number of rows reverted for the batch", async () => {
    query.mockResolvedValue({ rows: [], rowCount: 3 });
    await expect(cancelScheduledBatch(ORG, "batch-1")).resolves.toBe(3);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("batch_id = $2");
    expect(sql).toContain("status = 'scheduled'");
    expect(sql).toContain("undo_until > now()");
    expect(params).toEqual([ORG.orgId, "batch-1"]);
  });
});

describe("claimDueScheduledProposals", () => {
  it("claims due rows cross-tenant and marks them executing per org", async () => {
    query
      .mockResolvedValueOnce({
        rows: [
          { id: "prop-1", org_id: ORG.orgId },
          { id: "prop-2", org_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ id: "prop-1", org_id: ORG.orgId }] })
      .mockResolvedValueOnce({ rows: [{ id: "prop-2", org_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" }] });

    const claimed = await claimDueScheduledProposals(10);

    expect(withCrossTenantRead).toHaveBeenCalledWith("proposal-undo-worker", expect.any(Function));
    expect(withTenantTransaction).toHaveBeenCalledTimes(2);
    expect(claimed).toEqual([
      { id: "prop-1", orgId: ORG.orgId },
      { id: "prop-2", orgId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" },
    ]);

    const selectSql = String(query.mock.calls[0][0]);
    expect(selectSql).toContain("FOR UPDATE SKIP LOCKED");
    expect(selectSql).toContain("status = 'scheduled'");
    expect(selectSql).toContain("undo_until <= now()");

    const updateSql = String(query.mock.calls[1][0]);
    expect(updateSql).toContain("status = 'executing'");
    expect(updateSql).toContain("status = 'scheduled'");
  });

  it("skips rows another worker already claimed", async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: "prop-1", org_id: ORG.orgId }] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(claimDueScheduledProposals(5)).resolves.toEqual([]);
  });
});
