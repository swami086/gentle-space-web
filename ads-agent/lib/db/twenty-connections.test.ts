import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("./tx", () => ({
  withTenantTransaction: async (_scope: unknown, fn: (c: unknown) => Promise<unknown>) =>
    fn({ query }),
}));
vi.mock("./cross-tenant", () => ({
  withCrossTenantRead: async (_actorRef: string, fn: (c: { query: typeof query }) => unknown) =>
    fn({ query }),
}));

import {
  getTwentyConnection,
  orgsWithoutOwnInstance,
  setTwentyConnectionState,
  upsertTwentyConnection,
} from "./twenty-connections";

const row = {
  org_id: "org-1",
  base_url: "https://crm-org-1.gentlespace.in",
  api_key_ref: "secret://twenty/org-1",
  coolify_service_uuid: "svc-abc",
  twenty_version: "1.9.0",
  state: "active",
  provisioned_at: new Date("2026-08-12T00:00:00.000Z"),
  last_sync_at: null,
  last_error: null,
};

beforeEach(() => query.mockReset());

describe("getTwentyConnection", () => {
  it("maps the row", async () => {
    query.mockResolvedValue({ rows: [row] });
    await expect(getTwentyConnection("org-1")).resolves.toEqual({
      orgId: "org-1",
      baseUrl: "https://crm-org-1.gentlespace.in",
      apiKeyRef: "secret://twenty/org-1",
      coolifyServiceUuid: "svc-abc",
      twentyVersion: "1.9.0",
      state: "active",
      provisionedAt: "2026-08-12T00:00:00.000Z",
      lastSyncAt: null,
      lastError: null,
    });
  });

  it("returns null when the org has no instance", async () => {
    query.mockResolvedValue({ rows: [] });
    await expect(getTwentyConnection("org-2")).resolves.toBeNull();
  });

  it("never selects a secret, only its reference", async () => {
    query.mockResolvedValue({ rows: [] });
    await getTwentyConnection("org-1");
    expect(query.mock.calls[0][0]).toContain("api_key_ref");
    expect(query.mock.calls[0][0]).not.toMatch(/api_key\b(?!_ref)/);
  });
});

describe("upsertTwentyConnection", () => {
  it("upserts on org_id", async () => {
    query.mockResolvedValue({ rows: [{ ...row, state: "provisioning" }] });
    const result = await upsertTwentyConnection({
      orgId: "org-1",
      baseUrl: "https://crm-org-1.gentlespace.in",
      apiKeyRef: "secret://twenty/org-1",
      coolifyServiceUuid: "svc-abc",
      twentyVersion: "1.9.0",
      state: "provisioning",
    });
    expect(result.state).toBe("provisioning");
    expect(query.mock.calls[0][0]).toContain("ON CONFLICT (org_id) DO UPDATE");
  });
});

describe("setTwentyConnectionState", () => {
  it("records the error alongside the state", async () => {
    query.mockResolvedValue({ rows: [] });
    await setTwentyConnectionState("org-1", "failed", "health check timed out");
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("UPDATE context.twenty_connections");
    expect(params).toEqual(["org-1", "failed", "health check timed out"]);
  });
});

describe("orgsWithoutOwnInstance", () => {
  it("lists orgs with no row, a non-active row, or the shared base url", async () => {
    query.mockResolvedValue({
      rows: [
        { org_id: "org-2", reason: "no connection" },
        { org_id: "org-3", reason: "state=suspended" },
        { org_id: "org-4", reason: "shared instance" },
      ],
    });
    const gaps = await orgsWithoutOwnInstance("https://crm.gentlespace.in");
    expect(gaps).toEqual([
      { orgId: "org-2", reason: "no connection" },
      { orgId: "org-3", reason: "state=suspended" },
      { orgId: "org-4", reason: "shared instance" },
    ]);
    expect(query.mock.calls[0][1]).toEqual(["https://crm.gentlespace.in"]);
  });
});
