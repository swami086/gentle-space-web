import { beforeEach, describe, expect, it, vi } from "vitest";

const { getOrgSettings, setCronEnabled, requireApiRole, scopeForSession } = vi.hoisted(() => ({
  getOrgSettings: vi.fn(),
  setCronEnabled: vi.fn(),
  requireApiRole: vi.fn(),
  scopeForSession: vi.fn(),
}));

vi.mock("@/lib/db/org-settings", () => ({ getOrgSettings, setCronEnabled }));
vi.mock("@/lib/auth/scope-interim", () => ({ scopeForSession }));
vi.mock("@/lib/auth/dal", () => ({ requireApiRole }));

import { GET, PATCH } from "./route";

const scope = { kind: "org" as const, orgId: "org-1" };

beforeEach(() => {
  vi.clearAllMocks();
  requireApiRole.mockResolvedValue({
    ok: true,
    session: { userId: "u-1", email: "a@b.com", orgId: "org-1", role: "admin" },
  });
  scopeForSession.mockResolvedValue(scope);
});

describe("GET /api/settings", () => {
  it("returns the current cron settings", async () => {
    getOrgSettings.mockResolvedValue({
      cronEnabled: false,
      lastRunAt: null,
      undoWindowSeconds: 60,
      approvalThresholdInr: null,
    });
    const res = await GET();
    expect(getOrgSettings).toHaveBeenCalledWith(scope);
    expect(await res.json()).toEqual({
      cronEnabled: false,
      lastRunAt: null,
      undoWindowSeconds: 60,
      approvalThresholdInr: null,
    });
  });
});

describe("PATCH /api/settings", () => {
  it("rejects a non-boolean enabled value", async () => {
    const res = await PATCH(
      new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ enabled: "yes" }) }),
    );
    expect(res.status).toBe(400);
    expect(setCronEnabled).not.toHaveBeenCalled();
  });

  it("updates the enabled flag", async () => {
    const res = await PATCH(
      new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ enabled: true }) }),
    );
    expect(setCronEnabled).toHaveBeenCalledWith(scope, true);
    expect(res.status).toBe(200);
  });
});
