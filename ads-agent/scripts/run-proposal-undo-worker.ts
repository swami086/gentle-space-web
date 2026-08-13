/**
 * Claims due scheduled proposals and executes them after the undo window.
 * `npm run worker:proposals` — not gated on cron_settings.enabled.
 */
import cron from "node-cron";
import { claimDueScheduledProposals } from "../lib/db/proposals";
import { executeProposal } from "../lib/executor/execute";
import type { Scope } from "../lib/db/scope-sql";

export const DEFAULT_SCHEDULE = "*/15 * * * * *";
export const DEFAULT_BATCH = 10;

export function isWorkerEnabled(env: NodeJS.ProcessEnv): boolean {
  return env.PROPOSAL_UNDO_WORKER !== "0";
}

export async function runProposalUndoTick(
  limit = DEFAULT_BATCH,
): Promise<{ claimed: number; executed: number; failed: number }> {
  const claimed = await claimDueScheduledProposals(limit);
  let executed = 0;
  let failed = 0;

  for (const row of claimed) {
    const scope: Scope = { kind: "org", orgId: row.orgId };
    try {
      const result = await executeProposal(scope, row.id);
      if (result.status === "executed") executed++;
      else failed++;
    } catch (err) {
      failed++;
      console.error("proposal undo worker: execute failed", {
        proposalId: row.id,
        orgId: row.orgId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (claimed.length > 0) {
    console.log(
      `proposal undo worker: claimed ${claimed.length}, executed ${executed}, failed ${failed}`,
    );
  }
  return { claimed: claimed.length, executed, failed };
}

export function startProposalUndoWorker(env: NodeJS.ProcessEnv): void {
  if (!isWorkerEnabled(env)) {
    console.log("proposal undo worker: disabled (PROPOSAL_UNDO_WORKER=0)");
    return;
  }
  const schedule = env.PROPOSAL_UNDO_CRON ?? DEFAULT_SCHEDULE;
  cron.schedule(schedule, () => {
    runProposalUndoTick().catch((err) => console.error("proposal undo worker: tick failed", err));
  });
  console.log(`proposal undo worker started, schedule="${schedule}" (Ctrl+C to stop)`);
}

const isDirect =
  process.argv[1]?.endsWith("run-proposal-undo-worker.ts") ||
  process.argv[1]?.endsWith("run-proposal-undo-worker.js");
if (isDirect) {
  startProposalUndoWorker(process.env);
}
