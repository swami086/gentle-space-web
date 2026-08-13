import { beforeEach, describe, expect, it, vi } from "vitest";

const { claimDueScheduledProposals, executeProposal } = vi.hoisted(() => ({
  claimDueScheduledProposals: vi.fn(),
  executeProposal: vi.fn(),
}));

vi.mock("../lib/db/proposals", () => ({ claimDueScheduledProposals }));
vi.mock("../lib/executor/execute", () => ({ executeProposal }));

import {
  DEFAULT_BATCH,
  DEFAULT_SCHEDULE,
  isWorkerEnabled,
  runProposalUndoTick,
} from "./run-proposal-undo-worker";

const ORG = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("run-proposal-undo-worker", () => {
  it("exports the default cron schedule and batch size", () => {
    expect(DEFAULT_SCHEDULE).toBe("*/15 * * * * *");
    expect(DEFAULT_BATCH).toBe(10);
  });

  it("is enabled unless PROPOSAL_UNDO_WORKER=0", () => {
    expect(isWorkerEnabled({})).toBe(true);
    expect(isWorkerEnabled({ PROPOSAL_UNDO_WORKER: "0" })).toBe(false);
  });

  it("claims due proposals and executes each under its org scope", async () => {
    claimDueScheduledProposals.mockResolvedValue([
      { id: "prop-1", orgId: ORG },
      { id: "prop-2", orgId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" },
    ]);
    executeProposal.mockResolvedValue({ status: "executed" });

    const result = await runProposalUndoTick(10);

    expect(claimDueScheduledProposals).toHaveBeenCalledWith(10);
    expect(executeProposal).toHaveBeenCalledTimes(2);
    expect(executeProposal).toHaveBeenNthCalledWith(1, { kind: "org", orgId: ORG }, "prop-1");
    expect(executeProposal).toHaveBeenNthCalledWith(
      2,
      { kind: "org", orgId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" },
      "prop-2",
    );
    expect(result).toEqual({ claimed: 2, executed: 2, failed: 0 });
  });

  it("counts connector failures without aborting the batch", async () => {
    claimDueScheduledProposals.mockResolvedValue([{ id: "prop-1", orgId: ORG }]);
    executeProposal.mockResolvedValue({ status: "failed", error: "rate limited" });

    await expect(runProposalUndoTick()).resolves.toEqual({ claimed: 1, executed: 0, failed: 1 });
  });

  it("continues when executeProposal throws", async () => {
    claimDueScheduledProposals.mockResolvedValue([
      { id: "prop-1", orgId: ORG },
      { id: "prop-2", orgId: ORG },
    ]);
    executeProposal.mockRejectedValueOnce(new Error("unexpected")).mockResolvedValueOnce({ status: "executed" });

    await expect(runProposalUndoTick()).resolves.toEqual({ claimed: 2, executed: 1, failed: 1 });
  });
});
