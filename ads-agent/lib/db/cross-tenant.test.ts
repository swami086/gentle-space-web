import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
const release = vi.fn();
vi.mock("./client", () => ({ getPool: () => ({ connect: async () => ({ query, release }) }) }));

import { withCrossTenantRead } from "./cross-tenant";

beforeEach(() => {
  query.mockReset();
  release.mockReset();
  query.mockResolvedValue({ rows: [] });
});

describe("withCrossTenantRead", () => {
  it("declares the cross-tenant session transaction-scoped and audits it", async () => {
    const result = await withCrossTenantRead("twenty-projection", async () => 3);
    expect(result).toBe(3);
    const statements = query.mock.calls.map((c) => c[0]);
    expect(statements[0]).toBe("BEGIN");
    expect(statements[1]).toBe("SELECT set_config('app.cross_tenant', 'projector', true)");
    expect(statements.some((s: string) => s.includes("INSERT INTO context.access_log"))).toBe(true);
    expect(statements.at(-1)).toBe("COMMIT");
  });

  it("audits with actor_kind cross_tenant, which is what the alert watches for", async () => {
    await withCrossTenantRead("twenty-projection", async () => null);
    const auditCall = query.mock.calls.find((c) => String(c[0]).includes("context.access_log"));
    expect(auditCall?.[1]).toEqual(["cross_tenant", "twenty-projection", "cross_tenant.read"]);
  });

  it("rolls back and releases on failure", async () => {
    await expect(
      withCrossTenantRead("twenty-projection", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(query.mock.calls.map((c) => c[0])).toContain("ROLLBACK");
    expect(release).toHaveBeenCalledOnce();
  });
});
