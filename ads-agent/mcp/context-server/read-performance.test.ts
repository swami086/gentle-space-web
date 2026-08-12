// ads-agent/mcp/context-server/read-performance.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getCampaignPerformance, resolveClickHouseUrl } from "./read-performance";

const CLAIMS = {
  orgId: "11111111-1111-1111-1111-111111111111",
  taskId: "task-1",
  profile: "performance",
  toolAllowlist: ["get_campaign_performance"],
};

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AGENT_CLICKHOUSE_URL = "http://clickhouse:8123";
  process.env.AGENT_CLICKHOUSE_USER = "agent_ro";
  process.env.AGENT_CLICKHOUSE_PASSWORD = "local_dev";
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    text: async () =>
      JSON.stringify({
        campaign_id: "c1",
        campaign_name: "Whitefield Search",
        corridor: "Whitefield",
        spend: 1200.5,
        clicks: 40,
        impressions: 900,
        conversions: 3,
      }) + "\n",
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.AGENT_CLICKHOUSE_URL;
});

describe("getCampaignPerformance", () => {
  it("pins the tenant with the SQL_current_tenant_id setting and forces readonly", async () => {
    await getCampaignPerformance(CLAIMS, { windowDays: 7 });
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain(`SQL_current_tenant_id=${CLAIMS.orgId}`);
    expect(url).toContain("readonly=1");
    expect(url).toContain("default_format=JSONEachRow");
  });

  it("passes values as ClickHouse query parameters, never inside the SQL body", async () => {
    await getCampaignPerformance(CLAIMS, { windowDays: 7, corridor: "Whitefield" });
    const url = String(fetchMock.mock.calls[0][0]);
    const body = String(fetchMock.mock.calls[0][1].body);
    expect(url).toContain("param_window_days=7");
    expect(url).toContain("param_corridor=Whitefield");
    expect(body).not.toContain("Whitefield");
    expect(body).toContain("{window_days:UInt16}");
  });

  it("parses JSONEachRow into numbers", async () => {
    const rows = await getCampaignPerformance(CLAIMS, { windowDays: 7 });
    expect(rows).toEqual([
      {
        campaignId: "c1",
        campaignName: "Whitefield Search",
        corridor: "Whitefield",
        spend: 1200.5,
        clicks: 40,
        impressions: 900,
        conversions: 3,
      },
    ]);
  });

  it("rejects a window outside 1..90 before making a request", async () => {
    await expect(getCampaignPerformance(CLAIMS, { windowDays: 0 })).rejects.toThrow("invalid_window_days");
    await expect(getCampaignPerformance(CLAIMS, { windowDays: 400 })).rejects.toThrow("invalid_window_days");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces a ClickHouse failure as a stable code, never as the response body", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "DB::Exception: contact Asha <asha@example.com> row leaked",
    });
    const err = await getCampaignPerformance(CLAIMS, { windowDays: 7 }).catch((e: unknown) => e as Error);
    expect(err.message).toBe("clickhouse_unavailable");
    expect(String(err)).not.toContain("asha@example.com");
  });
});

describe("resolveClickHouseUrl", () => {
  it("throws when unset rather than defaulting to a host that might be the primary", () => {
    delete process.env.AGENT_CLICKHOUSE_URL;
    expect(() => resolveClickHouseUrl()).toThrow("AGENT_CLICKHOUSE_URL is not set");
  });
});
