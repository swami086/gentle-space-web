import { afterAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { closeAgentReadPool, withAgentTenantTx } from "../../mcp/context-server/db";
import { assertWithinCeiling, getTenantSpendTodayUsd } from "./agent-cost";

const LIVE = Boolean(process.env.DATABASE_URL && process.env.AGENT_RO_DATABASE_URL);

const ownerPool = LIVE ? new Pool({ connectionString: process.env.DATABASE_URL }) : null;

afterAll(async () => {
  await ownerPool?.end();
  await closeAgentReadPool();
});

describe.skipIf(!LIVE)("agent_ro cost ceiling gate", () => {
  it("grants agent_ro SELECT on FORCE RLS cost bases for security_invoker view", async () => {
    for (const table of ["agent_cost_ceilings", "agent_token_usage"] as const) {
      const { rows } = await ownerPool!.query<{ ok: boolean }>(
        `SELECT has_table_privilege('agent_ro', $1, 'SELECT') AS ok`,
        [`context.${table}`],
      );
      expect(rows[0]?.ok).toBe(true);
    }
  });

  it("agent_ro can read v_agent_spend_today and assertWithinCeiling after set_tenant", async () => {
    const { rows: orgRows } = await ownerPool!.query<{ id: string }>(
      `SELECT org_id AS id FROM context.agent_cost_ceilings LIMIT 1`,
    );
    const orgId = orgRows[0]?.id;
    expect(orgId).toBeTruthy();

    const spend = await getTenantSpendTodayUsd(orgId!);
    expect(spend.ceilingUsd).toBeGreaterThan(0);
    expect(spend.spentUsd).toBeGreaterThanOrEqual(0);

    await expect(assertWithinCeiling(orgId!)).resolves.toBeUndefined();

    const { rows } = await withAgentTenantTx(orgId!, (tx) =>
      tx.query<{ spent_usd: string; ceiling_usd: string }>(
        `SELECT spent_usd, ceiling_usd FROM context.v_agent_spend_today`,
      ),
    );
    expect(rows).toHaveLength(1);
    expect(Number(rows[0]!.ceiling_usd)).toBeGreaterThan(0);
  });
});
