import { beforeEach, describe, expect, it, vi } from "vitest";

const { runDecisionCycle, touchLastRunAt, requireApiRole } = vi.hoisted(() => ({
  runDecisionCycle: vi.fn(),
  touchLastRunAt: vi.fn(),
  requireApiRole: vi.fn(),
}));

vi.mock("@/lib/decision-engine/cycle", () => ({ runDecisionCycle }));
vi.mock("@/lib/db/settings", () => ({ touchLastRunAt }));
vi.mock("@/lib/auth/dal", () => ({ requireApiRole }));

import { POST } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  requireApiRole.mockResolvedValue({
    ok: true,
    session: { userId: "u-1", email: "a@b.com", orgId: "org-1", role: "admin" },
  });
});

describe("POST /api/cycle/run", () => {
  it("runs one decision cycle, touches last_run_at, and returns the result", async () => {
    runDecisionCycle.mockResolvedValue({ proposalsCreated: 2 });
    const res = await POST();
    expect(runDecisionCycle).toHaveBeenCalled();
    expect(touchLastRunAt).toHaveBeenCalled();
    expect(await res.json()).toEqual({ proposalsCreated: 2 });
  });
});
