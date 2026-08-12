import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  query,
  createDeletionRequest,
  setPropagation,
  listDueErasures,
  markErased,
  recordAccess,
} = vi.hoisted(() => ({
  query: vi.fn(),
  createDeletionRequest: vi.fn(),
  setPropagation: vi.fn(),
  listDueErasures: vi.fn(),
  markErased: vi.fn(),
  recordAccess: vi.fn(),
}));

vi.mock("./tx", () => ({
  withTenantTransaction: async (_scope: unknown, fn: (c: unknown) => Promise<unknown>) =>
    fn({ query }),
}));
vi.mock("./cross-tenant", () => ({
  withCrossTenantRead: async (_actor: string, fn: (c: unknown) => Promise<unknown>) => fn({ query }),
}));
vi.mock("./deletion-requests", () => ({
  createDeletionRequest,
  setPropagation,
  listDueErasures,
  markErased,
  RETENTION_FLOOR_DAYS: 365,
}));
vi.mock("./access-log", () => ({ recordAccess }));

import { hardEraseEnquiry, runErasureSweep, suppressEnquiry } from "./erasure";

const scope = { kind: "org", orgId: "org-1" } as const;

beforeEach(() => {
  query.mockReset().mockResolvedValue({ rows: [], rowCount: 1 });
  createDeletionRequest.mockReset().mockResolvedValue({
    id: "req-1",
    eraseAfter: "2027-08-12",
  });
  setPropagation.mockReset().mockResolvedValue(undefined);
  listDueErasures.mockReset().mockResolvedValue([]);
  markErased.mockReset().mockResolvedValue(undefined);
  recordAccess.mockReset().mockResolvedValue(undefined);
});

describe("suppressEnquiry", () => {
  it("suppresses rather than deletes, and sets the retention floor", async () => {
    query.mockResolvedValueOnce({ rows: [{ id: "enq-1", contact_id: "contact-1" }] });
    await expect(suppressEnquiry(scope, "enq-1", "user-7")).resolves.toEqual({
      requestId: "req-1",
    });

    const statements = query.mock.calls.map((c) => String(c[0]));
    expect(statements.join("\n")).not.toContain("DELETE FROM");
    expect(statements.some((s) => s.includes("lifecycle = 'suppressed'"))).toBe(true);
    expect(statements.some((s) => s.includes("erase_after"))).toBe(true);
  });

  it("opens a ledger row per store, with Twenty pending rather than skipped", async () => {
    query.mockResolvedValueOnce({ rows: [{ id: "enq-1", contact_id: "contact-1" }] });
    await suppressEnquiry(scope, "enq-1", "user-7");
    expect(setPropagation).toHaveBeenCalledWith(scope, "req-1", "postgres", "suppressed", null);
    expect(setPropagation).toHaveBeenCalledWith(
      scope,
      "req-1",
      "twenty",
      "pending",
      expect.stringContaining("projection"),
    );
  });

  it("audits who suppressed what", async () => {
    query.mockResolvedValueOnce({ rows: [{ id: "enq-1", contact_id: "contact-1" }] });
    await suppressEnquiry(scope, "enq-1", "user-7");
    expect(recordAccess).toHaveBeenCalledWith(
      scope,
      {
        actorKind: "user",
        actorRef: "user-7",
        action: "enquiry.suppress",
        subjectKind: "enquirer",
        subjectRef: "enq-1",
      },
      expect.anything(),
    );
  });

  it("returns null for an enquiry that is not this tenant's active one", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await expect(suppressEnquiry(scope, "enq-other", "user-7")).resolves.toBeNull();
    expect(createDeletionRequest).not.toHaveBeenCalled();
  });
});

describe("hardEraseEnquiry", () => {
  it("clears the personal columns and marks the row erased, keeping the shell", async () => {
    await hardEraseEnquiry(scope, "enq-1");
    const statements = query.mock.calls.map((c) => String(c[0]));
    expect(statements[0]).toContain("lifecycle = 'erased'");
    expect(statements[0]).toContain("contact_phone = NULL");
    expect(statements[0]).toContain("contact_email = NULL");
    expect(statements.some((s) => s.includes("adsagent.enquiry_messages"))).toBe(true);
    expect(statements.join("\n")).not.toContain("DELETE FROM adsagent.enquiries");
  });
});

describe("runErasureSweep", () => {
  it("erases only requests whose retention floor has passed", async () => {
    listDueErasures.mockResolvedValue([
      { id: "req-1", orgId: "org-1", subjectKind: "enquirer", subjectRef: "enq-1" },
    ]);
    await expect(runErasureSweep()).resolves.toEqual({ erased: 1 });
    expect(markErased).toHaveBeenCalledWith({ kind: "org", orgId: "org-1" }, "req-1");
    expect(setPropagation).toHaveBeenCalledWith(
      { kind: "org", orgId: "org-1" },
      "req-1",
      "postgres",
      "erased",
      null,
    );
  });

  it("skips a subject kind it cannot erase rather than guessing", async () => {
    listDueErasures.mockResolvedValue([
      { id: "req-2", orgId: "org-1", subjectKind: "tenant", subjectRef: "org-1" },
    ]);
    await expect(runErasureSweep()).resolves.toEqual({ erased: 0 });
    expect(markErased).not.toHaveBeenCalled();
    expect(setPropagation).toHaveBeenCalledWith(
      { kind: "org", orgId: "org-1" },
      "req-2",
      "postgres",
      "failed",
      expect.stringContaining("tenant"),
    );
  });
});
