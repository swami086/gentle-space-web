import { beforeEach, describe, expect, it, vi } from "vitest";

const { getCronSettings, setCronEnabled, requireApiRole } = vi.hoisted(() => ({
  getCronSettings: vi.fn(),
  setCronEnabled: vi.fn(),
  requireApiRole: vi.fn(),
}));

vi.mock("@/lib/db/settings", () => ({ getCronSettings, setCronEnabled }));
vi.mock("@/lib/auth/dal", () => ({ requireApiRole }));

import { GET, PATCH } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  requireApiRole.mockResolvedValue({
    ok: true,
    session: { userId: "u-1", email: "a@b.com", orgId: "org-1", role: "admin" },
  });
});

describe("GET /api/settings", () => {
  it("returns the current cron settings", async () => {
    getCronSettings.mockResolvedValue({ enabled: false, lastRunAt: null });
    const res = await GET();
    expect(await res.json()).toEqual({ enabled: false, lastRunAt: null });
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
    expect(setCronEnabled).toHaveBeenCalledWith(true);
    expect(res.status).toBe(200);
  });
});
