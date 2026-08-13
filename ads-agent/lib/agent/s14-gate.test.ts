// ads-agent/lib/agent/s14-gate.test.ts — S14 acceptance gate (performance + campaign agents)
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getCampaignPerformance } from "../../mcp/context-server/read-performance";
import {
  GOOGLE_ADS_MCP_READ_TOOLS,
  GOOGLE_ADS_MCP_WRITE_TOOLS,
} from "./google-ads-read-tools";
import {
  CAMPAIGN_PROPOSAL_KINDS,
  PERFORMANCE_PROPOSAL_KINDS,
  isAllowedProposalKind,
} from "./proposal-kinds";
import { allowlistFor } from "./profiles";

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

describe("S14 gate — performance profile allowlist", () => {
  it("includes get_campaign_performance and create_proposal", () => {
    const allowlist = allowlistFor("performance");
    expect(allowlist).toContain("get_campaign_performance");
    expect(allowlist).toContain("create_proposal");
  });

  it("excludes enquiry tools not needed for performance", () => {
    const allowlist = allowlistFor("performance");
    expect(allowlist).not.toContain("list_enquiries");
    expect(allowlist).not.toContain("get_enquiry");
  });
});

describe("S14 gate — campaign profile allowlist", () => {
  it("includes get_campaign_performance, search_spaces, and get_space", () => {
    const allowlist = allowlistFor("campaign");
    expect(allowlist).toContain("get_campaign_performance");
    expect(allowlist).toContain("search_spaces");
    expect(allowlist).toContain("get_space");
  });
});

describe("S14 gate — isAllowedProposalKind matrix", () => {
  const ALL_KINDS = [
    ...PERFORMANCE_PROPOSAL_KINDS,
    ...CAMPAIGN_PROPOSAL_KINDS,
  ];

  it.each(ALL_KINDS.map((kind) => [kind, "performance", isAllowedProposalKind("performance", kind)] as const))(
    "performance + %s => %s",
    (kind, _profile, allowed) => {
      expect(allowed).toBe(PERFORMANCE_PROPOSAL_KINDS.includes(kind as (typeof PERFORMANCE_PROPOSAL_KINDS)[number]));
    },
  );

  it.each(ALL_KINDS.map((kind) => [kind, "campaign", isAllowedProposalKind("campaign", kind)] as const))(
    "campaign + %s => %s",
    (kind, _profile, allowed) => {
      expect(allowed).toBe(CAMPAIGN_PROPOSAL_KINDS.includes(kind as (typeof CAMPAIGN_PROPOSAL_KINDS)[number]));
    },
  );

  it("performance accepts pause only", () => {
    expect(isAllowedProposalKind("performance", "campaign.pause")).toBe(true);
    expect(isAllowedProposalKind("performance", "campaign.create")).toBe(false);
    expect(isAllowedProposalKind("performance", "campaign.budget_change")).toBe(false);
  });

  it("campaign accepts create and budget_change only", () => {
    expect(isAllowedProposalKind("campaign", "campaign.create")).toBe(true);
    expect(isAllowedProposalKind("campaign", "campaign.budget_change")).toBe(true);
    expect(isAllowedProposalKind("campaign", "campaign.pause")).toBe(false);
  });
});

describe("S14 gate — Google Ads MCP read/write inventory", () => {
  it("READ ∩ WRITE is empty", () => {
    for (const name of GOOGLE_ADS_MCP_READ_TOOLS) {
      expect(GOOGLE_ADS_MCP_WRITE_TOOLS).not.toContain(name);
    }
  });

  it("WRITE includes propose_change", () => {
    expect(GOOGLE_ADS_MCP_WRITE_TOOLS).toContain("propose_change");
  });
});

describe("S14 gate — ClickHouse replica invariant", () => {
  it("getCampaignPerformance fetches only AGENT_CLICKHOUSE_URL", async () => {
    await getCampaignPerformance(CLAIMS, { windowDays: 7 });
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url.startsWith("http://clickhouse:8123")).toBe(true);
    expect(url).not.toMatch(/5432|5433|5434/);
  });
});
