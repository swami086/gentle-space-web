import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const scope = { kind: "org" as const, orgId: "org-1" };
const session = { userId: "u-1", email: "a@b.com", orgId: "org-1", role: "admin" as const };

const { getOrgSettings, setCronEnabled, guard } = vi.hoisted(() => ({
  getOrgSettings: vi.fn(),
  setCronEnabled: vi.fn(),
  guard: vi.fn(),
}));

vi.mock("@/lib/db/org-settings", () => ({ getOrgSettings, setCronEnabled }));
vi.mock("@/lib/auth/guard", () => ({ guard }));

import { GET, PATCH } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  guard.mockResolvedValue({ ok: true, session, scope });
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
