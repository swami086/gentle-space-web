// ads-agent/mcp/context-server/read-performance.ts
import { z } from "zod";
import type { TaskTokenClaims } from "./task-token";

export type CampaignMetric = {
  campaignId: string;
  campaignName: string;
  corridor: string | null;
  spend: number;
  clicks: number;
  impressions: number;
  conversions: number;
};

/**
 * Reached over ClickHouse's HTTP interface with `fetch` rather than a driver,
 * because the constraint is no new dependencies and this is one POST.
 */
export function resolveClickHouseUrl(): string {
  const url = process.env.AGENT_CLICKHOUSE_URL;
  if (!url) throw new Error("AGENT_CLICKHOUSE_URL is not set");
  return url.replace(/\/+$/, "");
}

const inputSchema = z.strictObject({
  windowDays: z.number().int().min(1).max(90),
  corridor: z.string().min(1).max(120).optional(),
});

// The SQL is a module constant. Values arrive as ClickHouse query parameters
// ({name:Type}) so nothing the caller supplies is ever part of the statement.
const PERFORMANCE_SQL = `
SELECT campaign_id,
       any(campaign_name)      AS campaign_name,
       any(corridor)           AS corridor,
       sum(spend)              AS spend,
       sum(clicks)             AS clicks,
       sum(impressions)        AS impressions,
       sum(conversions)        AS conversions
  FROM campaign_performance_daily
 WHERE day >= today() - {window_days:UInt16}
   AND ({corridor:String} = '' OR corridor = {corridor:String})
 GROUP BY campaign_id
 ORDER BY spend DESC
 LIMIT 200`;

/**
 * `performance` is the only profile that reads the ClickHouse mirror rather than
 * Postgres — agents must never run analytical scans against the OLTP primary
 * (agent spec §8). Tenancy is the ClickHouse row policy keyed on
 * getSetting('SQL_current_tenant_id'); the setting comes from the verified task
 * token and never from a tool parameter.
 */
export async function getCampaignPerformance(
  claims: TaskTokenClaims,
  input: z.input<typeof inputSchema>,
): Promise<CampaignMetric[]> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) throw new Error("invalid_window_days");
  const { windowDays, corridor } = parsed.data;

  const params = new URLSearchParams({
    default_format: "JSONEachRow",
    readonly: "1",
    max_execution_time: "5",
    SQL_current_tenant_id: claims.orgId,
    param_window_days: String(windowDays),
    param_corridor: corridor ?? "",
  });

  const auth = Buffer.from(
    `${process.env.AGENT_CLICKHOUSE_USER ?? "agent_ro"}:${process.env.AGENT_CLICKHOUSE_PASSWORD ?? ""}`,
  ).toString("base64");

  const res = await fetch(`${resolveClickHouseUrl()}/?${params.toString()}`, {
    method: "POST",
    headers: { authorization: `Basic ${auth}`, "content-type": "text/plain" },
    body: PERFORMANCE_SQL,
  });

  // The response body of a failed ClickHouse query can echo row data. It never
  // reaches an error message, because that message reaches a span (§13.3).
  if (!res.ok) throw new Error("clickhouse_unavailable");

  const body = await res.text();
  return body
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .map((row) => ({
      campaignId: String(row.campaign_id),
      campaignName: String(row.campaign_name ?? ""),
      corridor: row.corridor === null || row.corridor === "" ? null : String(row.corridor),
      spend: Number(row.spend ?? 0),
      clicks: Number(row.clicks ?? 0),
      impressions: Number(row.impressions ?? 0),
      conversions: Number(row.conversions ?? 0),
    }));
}
