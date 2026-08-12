import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("./tx", () => ({
  withTenantTransaction: (_scope: unknown, fn: (c: { query: typeof query }) => unknown) => fn({ query }),
}));

import type { Scope } from "./scope-sql";
import { countAuditToday, listAudit, writeAudit } from "./audit-log";

const ORG: Scope = { kind: "org", orgId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" };

beforeEach(() => query.mockReset());

describe("writeAudit", () => {
  it("stamps org_id and records the actor", async () => {
    query.mockResolvedValue({ rows: [] });
    await writeAudit(ORG, {
      actorType: "human",
      actorUserId: "user-1",
      action: "proposal.approved",
      entityType: "proposal",
      entityId: "prop-1",
      after: { status: "approved" },
    });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("INSERT INTO adsagent.audit_log");
    expect(params[0]).toBe(ORG.orgId);
    expect(params[1]).toBe("human");
    expect(params[2]).toBe("user-1");
    expect(params[3]).toBe("proposal.approved");
  });

  it("refuses a human action with no actor before touching the database", async () => {
    await expect(
      writeAudit(ORG, { actorType: "human", action: "proposal.approved", entityType: "proposal" }),
    ).rejects.toThrow("a human audit entry requires actorUserId");
    expect(query).not.toHaveBeenCalled();
  });

  it("allows an agent action with no actor user", async () => {
    query.mockResolvedValue({ rows: [] });
    await writeAudit(ORG, { actorType: "agent", action: "cycle.run", entityType: "cycle" });
    expect(query.mock.calls[0][1][2]).toBeNull();
  });
});

describe("listAudit", () => {
  it("scopes the listing and passes the limit as $2", async () => {
    query.mockResolvedValue({ rows: [] });
    await listAudit(ORG, 10);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("org_id = $1::uuid");
    expect(sql).toContain("LIMIT $2");
    expect(params).toEqual([ORG.orgId, 10]);
  });
});

describe("countAuditToday", () => {
  it("scopes the count", async () => {
    query.mockResolvedValue({ rows: [{ count: "4" }] });
    await expect(countAuditToday(ORG)).resolves.toBe(4);
    expect(query.mock.calls[0][1]).toEqual([ORG.orgId]);
  });
});
