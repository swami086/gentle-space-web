import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("./tx", () => ({
  withTenantTransaction: async (_scope: unknown, fn: (c: unknown) => Promise<unknown>) =>
    fn({ query }),
}));

import type { Scope } from "./scope-sql";
import { recordAccess } from "./access-log";

const scope: Scope = { kind: "org", orgId: "org-1" };

beforeEach(() => {
  query.mockReset();
  query.mockResolvedValue({ rows: [] });
});

describe("recordAccess", () => {
  it("writes the actor, the subject and the action", async () => {
    await recordAccess(scope, {
      actorKind: "user",
      actorRef: "user-7",
      action: "contact.reveal",
      subjectKind: "enquirer",
      subjectRef: "enquiry-3",
    });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("INSERT INTO context.access_log");
    expect(params).toEqual(["org-1", "user", "user-7", "enquirer", "enquiry-3", "contact.reveal"]);
  });

  it("uses a caller-supplied client so the audit row commits with the read", async () => {
    const clientQuery = vi.fn().mockResolvedValue({ rows: [] });
    await recordAccess(scope, { actorKind: "system", actorRef: "sweep", action: "erase" }, {
      query: clientQuery,
    } as never);
    expect(clientQuery).toHaveBeenCalledOnce();
    expect(query).not.toHaveBeenCalled();
  });
});
