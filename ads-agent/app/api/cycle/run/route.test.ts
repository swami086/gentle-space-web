import { beforeEach, describe, expect, it, vi } from "vitest";

const { runDecisionCycle, touchLastRunAt, guard } = vi.hoisted(() => ({
  runDecisionCycle: vi.fn(),
  touchLastRunAt: vi.fn(),
  guard: vi.fn(),
}));

vi.mock("@/lib/decision-engine/cycle", () => ({ runDecisionCycle }));
vi.mock("@/lib/db/org-settings", () => ({ touchLastRunAt }));
vi.mock("@/lib/auth/guard", () => ({ guard }));

import { POST } from "./route";

const scope = { kind: "org" as const, orgId: "org-1" };

beforeEach(() => {
  vi.clearAllMocks();
  guard.mockResolvedValue({
    ok: true,
    session: { userId: "u-1", email: "a@b.com", orgId: "org-1", role: "admin" },
    scope: { kind: "platform", orgId: "org-1" },
  });
});

describe("POST /api/cycle/run", () => {
  it("runs one decision cycle, touches last_run_at, and returns the result", async () => {
    runDecisionCycle.mockResolvedValue({ proposalsCreated: 2 });
    const res = await POST();
    expect(runDecisionCycle).toHaveBeenCalledWith(scope);
    expect(touchLastRunAt).toHaveBeenCalledWith(scope);
    expect(await res.json()).toEqual({ proposalsCreated: 2 });
  });
});
