import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("./tx", () => ({
  withTenantTransaction: (_scope: unknown, fn: (c: { query: typeof query }) => unknown) => fn({ query }),
}));

import type { Scope } from "./scope-sql";
import { ensureOrgSettings, getOrgSettings, setCronEnabled, touchLastRunAt } from "./org-settings";

const ORG: Scope = { kind: "org", orgId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" };

beforeEach(() => query.mockReset());

describe("getOrgSettings", () => {
  it("reads only the caller's row", async () => {
    query.mockResolvedValue({
      rows: [
        {
          cron_enabled: true,
          last_run_at: new Date("2026-08-03T06:00:00.000Z"),
          undo_window_seconds: 60,
          approval_threshold_inr: null,
        },
      ],
    });
    await expect(getOrgSettings(ORG)).resolves.toEqual({
      cronEnabled: true,
      lastRunAt: "2026-08-03T06:00:00.000Z",
      undoWindowSeconds: 60,
      approvalThresholdInr: null,
    });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("adsagent.org_cron_settings");
    expect(sql).toContain("org_id = $1::uuid");
    expect(params).toEqual([ORG.orgId]);
  });

  it("returns safe defaults when the org has no row yet", async () => {
    query.mockResolvedValue({ rows: [] });
    await expect(getOrgSettings(ORG)).resolves.toEqual({
      cronEnabled: false,
      lastRunAt: null,
      undoWindowSeconds: 60,
      approvalThresholdInr: null,
    });
  });
});

describe("setCronEnabled", () => {
  it("upserts the caller's row only", async () => {
    query.mockResolvedValue({ rows: [] });
    await setCronEnabled(ORG, true);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("INSERT INTO adsagent.org_cron_settings");
    expect(sql).toContain("ON CONFLICT (org_id)");
    expect(sql).not.toContain("id = 1");
    expect(params).toEqual([ORG.orgId, true]);
  });
});

describe("touchLastRunAt", () => {
  it("scopes the update to the caller", async () => {
    query.mockResolvedValue({ rows: [] });
    await touchLastRunAt(ORG);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("last_run_at = NOW()");
    expect(sql).toContain("org_id = $1::uuid");
    expect(params).toEqual([ORG.orgId]);
  });
});

describe("ensureOrgSettings", () => {
  it("inserts defaults idempotently", async () => {
    query.mockResolvedValue({ rows: [] });
    await ensureOrgSettings(ORG);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("ON CONFLICT (org_id) DO NOTHING");
    expect(params).toEqual([ORG.orgId]);
  });
});
