import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("./tx", () => ({
  withTenantTransaction: async (_scope: unknown, fn: (c: unknown) => Promise<unknown>) =>
    fn({ query }),
}));

import type { Scope } from "./scope-sql";
import {
  GRIEVANCE_RESPONSE_DAYS,
  RETENTION_FLOOR_DAYS,
  createDeletionRequest,
  setPropagation,
} from "./deletion-requests";

const scope: Scope = { kind: "org", orgId: "org-1" };

beforeEach(() => query.mockReset());

describe("createDeletionRequest", () => {
  it("sets the retention floor and the grievance deadline from the request date", async () => {
    query.mockResolvedValue({
      rows: [
        {
          id: "req-1",
          org_id: "org-1",
          subject_kind: "enquirer",
          subject_ref: "enquiry-3",
          requested_at: new Date("2026-08-12T00:00:00.000Z"),
          suppressed_at: null,
          erase_after: new Date("2027-08-12T00:00:00.000Z"),
          erased_at: null,
          respond_by: new Date("2026-11-10T00:00:00.000Z"),
        },
      ],
    });
    const request = await createDeletionRequest(scope, {
      subjectKind: "enquirer",
      subjectRef: "enquiry-3",
    });
    expect(request.id).toBe("req-1");
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain(`now()::date + $4`);
    expect(sql).toContain(`now()::date + $5`);
    expect(params).toEqual([
      "org-1",
      "enquirer",
      "enquiry-3",
      RETENTION_FLOOR_DAYS,
      GRIEVANCE_RESPONSE_DAYS,
    ]);
  });

  it("retains for a year, not zero days", () => {
    expect(RETENTION_FLOOR_DAYS).toBe(365);
    expect(GRIEVANCE_RESPONSE_DAYS).toBe(90);
  });
});

describe("setPropagation", () => {
  it("upserts one row per store so a regulator can see each one", async () => {
    query.mockResolvedValue({ rows: [] });
    await setPropagation(scope, "req-1", "twenty", "suppressed", "person deleted");
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("INSERT INTO context.deletion_propagations");
    expect(sql).toContain("ON CONFLICT (request_id, store) DO UPDATE");
    expect(params).toEqual(["req-1", "twenty", "suppressed", "person deleted"]);
  });
});
