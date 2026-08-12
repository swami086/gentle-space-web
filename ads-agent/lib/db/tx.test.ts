import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
const release = vi.fn();
const connect = vi.fn(async () => ({ query, release }));

vi.mock("./client", () => ({
  getPool: () => ({ connect }),
  assertApplicationDbRole: vi.fn(async () => {}),
}));

import { withTenantTransaction } from "./tx";

beforeEach(() => {
  query.mockReset();
  release.mockReset();
  connect.mockClear();
  query.mockResolvedValue({ rows: [] });
});

describe("withTenantTransaction", () => {
  it("sets the tenant inside the transaction and commits", async () => {
    const result = await withTenantTransaction({ kind: "org", orgId: "org-1" }, async () => "ok");
    expect(result).toBe("ok");
    const statements = query.mock.calls.map((c) => c[0]);
    expect(statements[0]).toBe("BEGIN");
    expect(statements[1]).toBe("SELECT public.set_tenant($1)");
    expect(query.mock.calls[1][1]).toEqual(["org-1"]);
    expect(statements.at(-1)).toBe("COMMIT");
    expect(release).toHaveBeenCalledOnce();
  });

  it("raises the platform read flag for platform scope without skipping set_tenant", async () => {
    await withTenantTransaction({ kind: "platform", orgId: "org-1" }, async () => null);
    const statements = query.mock.calls.map((c) => c[0]);
    expect(statements).toContain("SELECT public.set_tenant($1)");
    expect(statements).toContain("SELECT public.set_platform()");
  });

  it("rolls back and releases when the callback throws", async () => {
    await expect(
      withTenantTransaction({ kind: "org", orgId: "org-1" }, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(query.mock.calls.map((c) => c[0])).toContain("ROLLBACK");
    expect(release).toHaveBeenCalledOnce();
  });
});
