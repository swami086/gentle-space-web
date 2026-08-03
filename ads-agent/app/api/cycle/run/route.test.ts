import { beforeEach, describe, expect, it, vi } from "vitest";

const { runDecisionCycle, touchLastRunAt } = vi.hoisted(() => ({
  runDecisionCycle: vi.fn(),
  touchLastRunAt: vi.fn(),
}));

vi.mock("@/lib/decision-engine/cycle", () => ({ runDecisionCycle }));
vi.mock("@/lib/db/settings", () => ({ touchLastRunAt }));

import { POST } from "./route";

beforeEach(() => vi.clearAllMocks());

describe("POST /api/cycle/run", () => {
  it("runs one decision cycle, touches last_run_at, and returns the result", async () => {
    runDecisionCycle.mockResolvedValue({ proposalsCreated: 2 });
    const res = await POST();
    expect(runDecisionCycle).toHaveBeenCalled();
    expect(touchLastRunAt).toHaveBeenCalled();
    expect(await res.json()).toEqual({ proposalsCreated: 2 });
  });
});
