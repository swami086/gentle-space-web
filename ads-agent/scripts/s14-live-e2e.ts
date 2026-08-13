/**
 * S14 live gate smoke (no interactive Hermes chat).
 * Proves: CH replica read via getCampaignPerformance + mint + pending create_proposal.
 *
 * Usage (from ads-agent/):
 *   npx tsx --env-file=.env.local scripts/s14-live-e2e.ts
 *
 * Required env (or defaults for local consolidated DB):
 *   DATABASE_URL, AGENT_CLICKHOUSE_URL, AGENT_CLICKHOUSE_USER, AGENT_CLICKHOUSE_PASSWORD
 *   Optional: PERFORMANCE_ORG_ID / PLATFORM_ORG_ID
 */
import { randomUUID } from "node:crypto";
import { mintTaskToken } from "../mcp/context-server/task-token";
import { getCampaignPerformance } from "../mcp/context-server/read-performance";
import { createAgentProposal } from "../mcp/context-server/create-proposal";
import { getContextPack } from "../mcp/context-server/context-pack";
import { PERFORMANCE_TOOL_ALLOWLIST } from "../lib/agent/performance-tools";
import { CAMPAIGN_TOOL_ALLOWLIST } from "../lib/agent/campaign-tools";

const ORG =
  process.env.PERFORMANCE_ORG_ID?.trim() ||
  process.env.CAMPAIGN_ORG_ID?.trim() ||
  process.env.PLATFORM_ORG_ID?.trim() ||
  "00000000-0000-0000-0000-000000000001";

async function main(): Promise<void> {
  if (!process.env.AGENT_CLICKHOUSE_URL) {
    throw new Error("AGENT_CLICKHOUSE_URL is required");
  }
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required (owner pool for mint)");
  }

  console.log("s14-live-e2e: org=", ORG);
  console.log("s14-live-e2e: CH=", process.env.AGENT_CLICKHOUSE_URL, "user=", process.env.AGENT_CLICKHOUSE_USER);

  // --- performance path ---
  await mintTaskToken({
    orgId: ORG,
    taskId: `s14-e2e-perf-${randomUUID()}`,
    profile: "performance",
    toolAllowlist: [...PERFORMANCE_TOOL_ALLOWLIST],
    ttlSeconds: 900,
  });
  const metrics = await getCampaignPerformance(
    {
      orgId: ORG,
      taskId: "s14-e2e-perf",
      profile: "performance",
      toolAllowlist: [...PERFORMANCE_TOOL_ALLOWLIST],
    },
    { windowDays: 7 },
  );
  if (!metrics.length) {
    throw new Error("gate_fail: get_campaign_performance returned 0 rows (seed CH?)");
  }
  console.log("s14-live-e2e: CH metrics ok", {
    n: metrics.length,
    first: { id: metrics[0].campaignId, name: metrics[0].campaignName, spend: metrics[0].spend },
  });

  const campaignId = metrics[0].campaignId;
  let evidence: string[] = [campaignId];
  try {
    const pack = await getContextPack(
      {
        orgId: ORG,
        taskId: "s14-e2e-perf",
        profile: "performance",
        toolAllowlist: [...PERFORMANCE_TOOL_ALLOWLIST],
      },
      { entity: "campaign", id: campaignId },
    );
    if (pack?.rowIds?.length) {
      evidence = pack.rowIds.slice(0, 3);
      console.log("s14-live-e2e: pack", {
        builtAt: pack.builtAt,
        rowIds: evidence.length,
        lag: pack.cdcLagSeconds,
      });
    } else {
      console.log("s14-live-e2e: pack empty/null — using campaignId as evidence");
    }
  } catch (e) {
    console.log(
      "s14-live-e2e: get_context_pack unavailable (",
      e instanceof Error ? e.message : e,
      ") — using campaignId as evidence",
    );
  }

  const pause = await createAgentProposal(
    {
      orgId: ORG,
      taskId: "s14-e2e-perf",
      profile: "performance",
      toolAllowlist: [...PERFORMANCE_TOOL_ALLOWLIST],
    },
    {
      kind: "campaign.pause",
      payload: { campaignId },
      rationale: `S14 live E2E: pause candidate ${metrics[0].campaignName} (spend ${metrics[0].spend} last 7d from ClickHouse).`,
      evidence,
    },
  );
  console.log("s14-live-e2e: performance proposal", pause);

  // --- campaign path ---
  await mintTaskToken({
    orgId: ORG,
    taskId: `s14-e2e-camp-${randomUUID()}`,
    profile: "campaign",
    toolAllowlist: [...CAMPAIGN_TOOL_ALLOWLIST],
    ttlSeconds: 900,
  });
  const metrics2 = await getCampaignPerformance(
    {
      orgId: ORG,
      taskId: "s14-e2e-camp",
      profile: "campaign",
      toolAllowlist: [...CAMPAIGN_TOOL_ALLOWLIST],
    },
    { windowDays: 7 },
  );
  if (!metrics2.length) throw new Error("gate_fail: campaign profile CH read empty");

  try {
    const budget = await createAgentProposal(
      {
        orgId: ORG,
        taskId: "s14-e2e-camp",
        profile: "campaign",
        toolAllowlist: [...CAMPAIGN_TOOL_ALLOWLIST],
      },
      {
        kind: "campaign.budget_change",
        payload: { campaignId, dailyBudgetInr: 500 },
        rationale: `S14 live E2E: budget change grounded in CH spend ${metrics2[0].spend}.`,
        evidence,
      },
    );
    console.log("s14-live-e2e: campaign proposal", budget);
  } catch (e) {
    const code = (e as { code?: string }).code ?? (e instanceof Error ? e.message : "");
    if (code === "stale_data_refusal") {
      console.log(
        "s14-live-e2e: campaign budget refused as stale_data_refusal (CDC lag) — CH read + pause still PASS",
      );
    } else {
      throw e;
    }
  }

  console.log("s14-live-e2e: PASS (CH replica + pending proposal path)");
}

main().catch((err) => {
  console.error("s14-live-e2e: FAIL", err);
  process.exit(1);
});
