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
// Param name must not collide with a SELECT alias (CH 25.8 ILLEGAL_AGGREGATION).
const PERFORMANCE_SQL = `
SELECT campaign_id,
       any(campaign_name)      AS campaign_name,
       any(corridor)           AS corridor_label,
       sum(spend)              AS spend,
       sum(clicks)             AS clicks,
       sum(impressions)        AS impressions,
       sum(conversions)        AS conversions
  FROM campaign_performance_daily
 WHERE day >= today() - {window_days:UInt16}
   AND ({corridor_filter:String} = '' OR campaign_performance_daily.corridor = {corridor_filter:String})
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

  // readonly=2: read-only queries but still allow session settings (tenant id).
  // readonly=1 rejects SQL_current_tenant_id ("Cannot modify setting in readonly mode").
  const params = new URLSearchParams({
    default_format: "JSONEachRow",
    readonly: "2",
    max_execution_time: "5",
    SQL_current_tenant_id: claims.orgId,
    param_window_days: String(windowDays),
    param_corridor_filter: corridor ?? "",
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
  // ClickHouse may return HTTP 200 with `Code:` / JSON exception in the body.
  const body = await res.text();
  if (!res.ok || body.startsWith("Code:") || body.includes('"exception"')) {
    throw new Error("clickhouse_unavailable");
  }
  return body
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .map((row) => ({
      campaignId: String(row.campaign_id),
      campaignName: String(row.campaign_name ?? ""),
      corridor: (() => {
        const raw = row.corridor_label ?? row.corridor;
        return raw === null || raw === undefined || raw === "" ? null : String(raw);
      })(),
      spend: Number(row.spend ?? 0),
      clicks: Number(row.clicks ?? 0),
      impressions: Number(row.impressions ?? 0),
      conversions: Number(row.conversions ?? 0),
    }));
}
