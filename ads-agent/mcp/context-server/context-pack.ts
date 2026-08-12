// ads-agent/mcp/context-server/context-pack.ts
import { z } from "zod";
import { STALE_LAG_SECONDS } from "./create-proposal";
import { withAgentTenantTx, type TenantTx } from "./db";
import type { TaskTokenClaims } from "./task-token";

export const PACK_ENTITIES = ["enquiry", "space", "campaign"] as const;
export type PackEntity = (typeof PACK_ENTITIES)[number];

/**
 * What an agent calls before generating anything user-visible. It returns
 * exactly the facts the agent is permitted to cite, which makes grounding
 * auditable: if a claim is not in the pack, it was invented (agent spec §5, F4).
 *
 * `rowIds` is what a span references. A pack assembled from Postgres rows is
 * fully described by those ids, and copying it into the artifact store so a span
 * can point at an artifact would create a second copy of personal data with its
 * own erasure path — the exact defect dataflow review A-3 names.
 */
export type ContextPack = {
  entity: PackEntity;
  id: string;
  builtAt: string;
  cdcLagSeconds: number | null;
  stale: boolean;
  facts: Record<string, unknown>;
  rowIds: string[];
};

const hexUuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);

const inputSchema = z.strictObject({
  entity: z.enum(PACK_ENTITIES),
  id: hexUuid,
});

type Freshness = { builtAt: string; cdcLagSeconds: number | null; stale: boolean };

async function readFreshness(tx: TenantTx): Promise<Freshness> {
  const { rows } = await tx.query<{ built_at: Date | null; cdc_lag_seconds: number | null }>(
    `SELECT built_at, cdc_lag_seconds FROM context.v_agent_graph_manifest`,
  );
  const row = rows[0];
  const lag = row?.cdc_lag_seconds === null || row?.cdc_lag_seconds === undefined
    ? null
    : Number(row.cdc_lag_seconds);
  return {
    builtAt: (row?.built_at ?? new Date(0)).toISOString(),
    cdcLagSeconds: lag,
    // Unknown lag is stale. An agent cannot obtain data without also obtaining
    // how old it is, and "we don't know" must not read as "it is fresh".
    stale: lag === null || lag > STALE_LAG_SECONDS,
  };
}

async function enquiryFacts(
  tx: TenantTx,
  id: string,
): Promise<{ facts: Record<string, unknown>; rowIds: string[] } | null> {
  const { rows } = await tx.query<Record<string, unknown>>(
    `SELECT id, contact_name, reply_state, corridor_id, listing_id, last_activity_at
       FROM context.v_agent_enquiries WHERE id = $1`,
    [id],
  );
  if (!rows[0]) return null;
  const { rows: activity } = await tx.query<Record<string, unknown>>(
    `SELECT id, kind, occurred_at FROM context.v_agent_enquiry_activity
      WHERE enquiry_id = $1 ORDER BY occurred_at ASC LIMIT 50`,
    [id],
  );
  return {
    facts: { enquiry: rows[0], activity },
    rowIds: [String(rows[0].id), ...activity.map((a) => String(a.id))],
  };
}

async function spaceFacts(
  tx: TenantTx,
  id: string,
): Promise<{ facts: Record<string, unknown>; rowIds: string[] } | null> {
  const { rows } = await tx.query<Record<string, unknown>>(
    `SELECT id, name, corridor_id, desks, price_per_desk, amenities, updated_at
       FROM context.v_agent_spaces WHERE id = $1`,
    [id],
  );
  if (!rows[0]) return null;
  return { facts: { space: rows[0] }, rowIds: [String(rows[0].id)] };
}

async function campaignFacts(
  tx: TenantTx,
  id: string,
): Promise<{ facts: Record<string, unknown>; rowIds: string[] } | null> {
  const { rows } = await tx.query<Record<string, unknown>>(
    `SELECT id, name, platform, status, corridor, daily_budget
       FROM context.v_agent_campaigns WHERE id = $1`,
    [id],
  );
  if (!rows[0]) return null;
  return { facts: { campaign: rows[0] }, rowIds: [String(rows[0].id)] };
}

export async function getContextPack(
  claims: TaskTokenClaims,
  input: { entity: PackEntity; id: string },
): Promise<ContextPack | null> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) throw new Error("invalid_entity");
  const { entity, id } = parsed.data;

  return withAgentTenantTx(claims.orgId, async (tx) => {
    const freshness = await readFreshness(tx);
    const loaded =
      entity === "enquiry"
        ? await enquiryFacts(tx, id)
        : entity === "space"
          ? await spaceFacts(tx, id)
          : await campaignFacts(tx, id);
    if (!loaded) return null;
    return { entity, id, ...freshness, facts: loaded.facts, rowIds: loaded.rowIds };
  });
}
