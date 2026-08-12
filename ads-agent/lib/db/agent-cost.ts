import { withAgentTenantTx, withAgentTenantWriteTx } from "../../mcp/context-server/db";

export class CostCeilingExceededError extends Error {
  readonly code = "cost_ceiling_exceeded" as const;

  constructor() {
    super("cost_ceiling_exceeded");
    this.name = "CostCeilingExceededError";
  }
}

export async function getTenantSpendTodayUsd(
  orgId: string,
): Promise<{ spentUsd: number; ceilingUsd: number }> {
  return withAgentTenantTx(orgId, async (tx) => {
    const { rows } = await tx.query<{ spent_usd: string; ceiling_usd: string }>(
      `SELECT spent_usd, ceiling_usd FROM context.v_agent_spend_today`,
    );
    // No ceiling row means no ceiling was configured. Reported as zero-of-zero
    // so the caller halts: a tenant without a ceiling must not run an agent.
    if (!rows[0]) return { spentUsd: 0, ceilingUsd: 0 };
    return { spentUsd: Number(rows[0].spent_usd), ceilingUsd: Number(rows[0].ceiling_usd) };
  });
}

/**
 * Halts rather than warns. The public enquiry form is unauthenticated and can
 * fan multi-agent inference across hops, so the ceiling is the control that
 * actually bounds loss (agent spec §6, datastore §12.6).
 */
export async function assertWithinCeiling(orgId: string): Promise<void> {
  const { spentUsd, ceilingUsd } = await getTenantSpendTodayUsd(orgId);
  if (ceilingUsd <= 0 || spentUsd >= ceilingUsd) throw new CostCeilingExceededError();
}

export async function recordTokenUsage(
  orgId: string,
  input: {
    profile: string;
    tool: string;
    inputTokens: number;
    outputTokens: number;
    costUsd: number;
  },
): Promise<void> {
  const { profile, tool, inputTokens, outputTokens, costUsd } = input;
  if (
    !Number.isInteger(inputTokens) ||
    !Number.isInteger(outputTokens) ||
    inputTokens < 0 ||
    outputTokens < 0 ||
    !(costUsd >= 0)
  ) {
    throw new Error("invalid_token_usage");
  }
  await withAgentTenantWriteTx(orgId, async (tx) => {
    await tx.query(`SELECT context.record_agent_token_usage($1, $2, $3, $4, $5)`, [
      profile,
      tool,
      inputTokens,
      outputTokens,
      costUsd,
    ]);
  });
}
