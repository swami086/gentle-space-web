import { beforeEach, describe, expect, it, vi } from "vitest";

const { runDecisionCycle, touchLastRunAt, requireApiRole, scopeForSession } = vi.hoisted(() => ({
  runDecisionCycle: vi.fn(),
  touchLastRunAt: vi.fn(),
  requireApiRole: vi.fn(),
  scopeForSession: vi.fn(),
}));

vi.mock("@/lib/decision-engine/cycle", () => ({ runDecisionCycle }));
vi.mock("@/lib/db/org-settings", () => ({ touchLastRunAt }));
vi.mock("@/lib/auth/scope-interim", () => ({ scopeForSession }));
vi.mock("@/lib/auth/dal", () => ({ requireApiRole }));

import { POST } from "./route";

const scope = { kind: "org" as const, orgId: "org-1" };

beforeEach(() => {
  vi.clearAllMocks();
  requireApiRole.mockResolvedValue({
    ok: true,
    session: { userId: "u-1", email: "a@b.com", orgId: "org-1", role: "admin" },
  });
  scopeForSession.mockResolvedValue(scope);
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
