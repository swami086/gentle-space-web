# Google Ads MCP Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `ads-agent` a custom in-repo TypeScript MCP server for Google Ads (read + write), make it the single implementation surface for `lib/connectors/google-ads.ts`, and let Copilot/Reports chat answer real Google Ads questions via the same two-phase resolve-then-generate pattern already used for Twenty CRM — with all 4 write tools structurally never advertised to the LLM.

**Architecture:** A new `ads-agent/mcp/google-ads-server/` package wraps the existing, already-tested `google-ads-api` SDK calls behind 7 MCP tools (3 read, 4 write) served over Streamable HTTP on `localhost:8766/mcp`. `lib/connectors/google-ads.ts` is rewritten to a thin MCP-client wrapper with byte-identical exported signatures, so `cycle.ts`/`execute.ts`/`rules.ts` need zero changes. `resolve-tools-then-generate.ts` merges Google Ads' 3 read-tool schemas alongside Twenty's, never the 4 write schemas.

**Tech Stack:** TypeScript, `@modelcontextprotocol/server` + `@modelcontextprotocol/node` (new, v2.0.0 — same major as the already-installed `@modelcontextprotocol/client` v2.0.0), `google-ads-api` (already installed, v21), Zod v4 (already installed), Vitest.

**Related:** [`docs/superpowers/specs/2026-08-07-google-ads-mcp-integration-design.md`](../specs/2026-08-07-google-ads-mcp-integration-design.md) (approved design spec — read this first for the "why").

## Global Constraints

- All 6 existing exported function signatures in `lib/connectors/google-ads.ts` (`fetchGoogleAdsPerformance`, `fetchGoogleSearchTerms`, `createFullGoogleCampaign`, `pauseGoogleCampaign`, `updateGoogleCampaignBudget`, `addGoogleNegativeKeyword`) stay byte-identical (name, params, return types) — zero call-site changes anywhere.
- New deps `@modelcontextprotocol/server` and `@modelcontextprotocol/node` pinned to `^2.0.0`, matching the existing `@modelcontextprotocol/client: ^2.0.0`.
- MCP tool `inputSchema`s use Zod (`import { z } from "zod"`, matching every other file in this repo — not `zod/v4`, since the installed `zod` package is already major version 4).
- The new MCP server binds to `localhost` only, on port `8766`, path `/mcp` — never `0.0.0.0`.
- The 4 write tool schemas (`create_campaign`, `pause_campaign`, `update_campaign_budget`, `add_negative_keyword`) must never appear in the `tools` array sent to Bifrost — enforced structurally by filtering to `GOOGLE_ADS_MCP_READ_TOOL_NAMES` before building that array, not by trusting the model.
- Tests use Vitest (`vi.mock`, `vi.hoisted`) in exactly the style of the existing `mcp-client.test.ts` / `twenty-pipeline.test.ts` / `google-ads.test.ts`.
- No new Docker service — the MCP server runs as a local `tsx` process (`npm run mcp:google-ads`), same convention as `npm run worker`.
- Prefer Torbit MCP (`run_sql` against the already-indexed local DuckDB graph, `project_id = 1672773718350201492` for this repo's `main` branch) over `grep` when you need to confirm callers/importers of a file you're changing.

---

## Parallel Execution Waves

9 tasks total, organized into 4 waves. Tasks within a wave touch **disjoint files** — dispatch every task in a wave as a separate subagent in the same message (per `superpowers:dispatching-parallel-agents`). Peak parallel width is 4, well within the 8-subagent cap.

Task 9 was added during this plan's self-review (see the note at the end of Task 9): the approved design spec claims `cycle.ts`'s "existing per-platform soft-fail wrapper... already used when Meta/CRM signal fetches fail" extends naturally to a Google-Ads-MCP-unreachable error. Reading the actual code shows this wrapper does not exist for the Google Ads/Meta fetches today (`Promise.all`, not per-source `try/catch` — only the CRM fetch fails soft internally) — a Google-Ads-MCP outage would currently abort the entire tick (no crash, but no Meta snapshot either that tick, contradicting the spec's precise claim). Task 9 is a small, surgical fix so the shipped behavior actually matches success criterion 6. It touches only `cycle.ts`/`cycle.test.ts` (no other task touches those files), so it runs in Wave 2 alongside Tasks 4–6 with zero conflict.

| Wave | Tasks (parallel) | Depends on |
|---|---|---|
| 1 | Task 1, Task 2, Task 3 | — (nothing, start immediately) |
| 2 | Task 4, Task 5, Task 6, Task 9 | Wave 1 |
| 3 | Task 7 | Wave 2 |
| 4 | Task 8 (sequential, not a subagent — you do this yourself) | Wave 3 |

Recommended Cursor skill per subagent (announce `Using engineering-skills2 → <skill>` per that router's convention; `mcp-builder` is a standalone skill, not part of the `engineering-skills2` bundle):

| Task | File(s) | Recommended skill(s) |
|---|---|---|
| 1 | `mcp/google-ads-server/tools.ts` | `engineering-skills2 senior-backend`, `~/.cursor/skills/anthropic-agent-skills/mcp-builder/SKILL.md` |
| 2 | `lib/bifrost/google-ads-mcp-*.ts` | `engineering-skills2 senior-backend` |
| 3 | `package.json`, `.env.example`, `README.md` | `engineering-skills2 senior-devops` |
| 4 | `mcp/google-ads-server/index.ts` | `~/.cursor/skills/anthropic-agent-skills/mcp-builder/SKILL.md`, `engineering-skills2 senior-backend` |
| 5 | `lib/connectors/google-ads.ts` | `engineering-skills2 senior-backend` |
| 6 | `lib/openui/resolve-tools-then-generate.ts` | `engineering-skills2 senior-backend` |
| 7 | `mcp/google-ads-server/live-smoke.test.ts` | `engineering-skills2 senior-qa` |
| 8 | (verification only) | `engineering-skills2 code-reviewer` |
| 9 | `lib/decision-engine/cycle.ts` | `engineering-skills2 senior-backend`, `engineering-skills2 tdd-guide` |

Every subagent prompt in this plan should tell the worker: "Before writing any code, run `run_sql` against the Torbit graph (already indexed; `get_graph_schema` first if unsure of tables) to confirm which files import/call what you're changing — avoid `grep` where a graph query answers the same question."

---

### Task 1: `mcp/google-ads-server/tools.ts` — relocate + extend Google Ads SDK logic

**Files:**
- Create: `ads-agent/mcp/google-ads-server/tools.ts`
- Create: `ads-agent/mcp/google-ads-server/tools.test.ts`

**Interfaces:**
- Produces: `fetchGoogleAdsPerformance(): Promise<GoogleAdsPerformanceRow[]>`, `fetchGoogleSearchTerms(): Promise<GoogleSearchTermRow[]>`, `listAccessibleCustomers(): Promise<{ customerIds: string[] }>`, `createFullGoogleCampaign(input: FullGoogleCampaignInput): Promise<string>`, `pauseGoogleCampaign(campaignResourceName: string): Promise<void>`, `updateGoogleCampaignBudget(campaignResourceName: string, dailyBudgetInr: number): Promise<void>`, `addGoogleNegativeKeyword(campaignResourceName: string, keywordText: string): Promise<void>` — all consumed by Task 4's `index.ts`.
- Types produced: `GoogleAdsPerformanceRow`, `GoogleSearchTermRow`, `FullGoogleCampaignInput` (identical shapes to today's `lib/connectors/google-ads.ts`).

- [ ] **Step 1: Write the failing tests**

Create `ads-agent/mcp/google-ads-server/tools.test.ts` (this is today's `lib/connectors/google-ads.test.ts`, relocated, with one new `describe` block for `listAccessibleCustomers` and a new mock method):

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";

const queryMock = vi.fn();
const mutateResourcesMock = vi.fn();
const listAccessibleCustomersMock = vi.fn();
const CustomerMock = vi.fn(() => ({ query: queryMock, mutateResources: mutateResourcesMock }));

vi.mock("google-ads-api", async () => {
  const actual = await vi.importActual<typeof import("google-ads-api")>("google-ads-api");
  return {
    ...actual,
    GoogleAdsApi: class MockGoogleAdsApi {
      Customer = CustomerMock;
      listAccessibleCustomers = listAccessibleCustomersMock;
    },
  };
});

beforeEach(() => {
  vi.resetModules();
  process.env.GOOGLE_ADS_DEVELOPER_TOKEN = "dev-token";
  process.env.GOOGLE_ADS_CLIENT_ID = "client-id";
  process.env.GOOGLE_ADS_CLIENT_SECRET = "client-secret";
  process.env.GOOGLE_ADS_REFRESH_TOKEN = "refresh-token";
  process.env.GOOGLE_ADS_CUSTOMER_ID = "1234567890";
  queryMock.mockReset();
  mutateResourcesMock.mockReset();
  listAccessibleCustomersMock.mockReset();
  CustomerMock.mockClear();
});

describe("fetchGoogleAdsPerformance", () => {
  it("maps GAQL rows to performance rows", async () => {
    queryMock.mockResolvedValue([
      {
        campaign: { id: "111" },
        metrics: { cost_micros: "40500000", clicks: "12", impressions: "900", all_conversions: "1" },
      },
    ]);
    const { fetchGoogleAdsPerformance } = await import("./tools");
    const result = await fetchGoogleAdsPerformance();
    expect(result).toEqual([
      { externalCampaignId: "111", spend: 40.5, clicks: 12, impressions: 900, conversions: 1 },
    ]);
  });
});

describe("fetchGoogleSearchTerms", () => {
  it("maps search term rows", async () => {
    queryMock.mockResolvedValue([
      {
        campaign: { id: "111" },
        search_term_view: { search_term: "office space for rent" },
        metrics: { clicks: "4", conversions: "0" },
      },
    ]);
    const { fetchGoogleSearchTerms } = await import("./tools");
    const result = await fetchGoogleSearchTerms();
    expect(result).toEqual([
      { externalCampaignId: "111", searchTerm: "office space for rent", clicks: 4, conversions: 0 },
    ]);
  });
});

describe("listAccessibleCustomers", () => {
  it("calls the SDK's listAccessibleCustomers with the refresh token and strips the customers/ prefix", async () => {
    listAccessibleCustomersMock.mockResolvedValue({
      resource_names: ["customers/1234567890", "customers/9876543210"],
    });
    const { listAccessibleCustomers } = await import("./tools");
    const result = await listAccessibleCustomers();
    expect(result).toEqual({ customerIds: ["1234567890", "9876543210"] });
    expect(listAccessibleCustomersMock).toHaveBeenCalledWith("refresh-token");
  });
});

describe("createFullGoogleCampaign", () => {
  it("creates budget, campaign, ad group, keywords, negatives, and an RSA atomically", async () => {
    mutateResourcesMock.mockResolvedValue({
      mutate_operation_responses: [
        { campaign_budget_result: { resource_name: "customers/1234567890/campaignBudgets/-1" } },
        { campaign_result: { resource_name: "customers/1234567890/campaigns/999" } },
        { ad_group_result: { resource_name: "customers/1234567890/adGroups/-3" } },
        { ad_group_criterion_result: { resource_name: "customers/1234567890/adGroupCriteria/-3~-4" } },
        { ad_group_criterion_result: { resource_name: "customers/1234567890/adGroupCriteria/-3~-5" } },
        { ad_group_ad_result: { resource_name: "customers/1234567890/adGroupAds/-3~-6" } },
      ],
    });
    const { createFullGoogleCampaign } = await import("./tools");
    const resourceName = await createFullGoogleCampaign({
      name: "Whitefield Search",
      dailyBudgetInr: 500,
      adGroupName: "Whitefield Office Space",
      keywords: [{ text: "office space whitefield", matchType: "phrase" }],
      negativeKeywords: ["residential"],
      headlines: ["Office Space in Whitefield", "Verified Listings Only", "Tour in 5 Days"],
      descriptions: ["Skip the broker games.", "AI-matched, human-verified commercial space."],
      finalUrl: "https://www.gentlespacesolutions.com/spaces",
    });

    expect(resourceName).toBe("customers/1234567890/campaigns/999");
    const operations = mutateResourcesMock.mock.calls[0][0];
    expect(operations.map((op: { entity: string }) => op.entity)).toEqual([
      "campaign_budget",
      "campaign",
      "ad_group",
      "ad_group_criterion",
      "ad_group_criterion",
      "ad_group_ad",
    ]);
  });
});

describe("pauseGoogleCampaign", () => {
  it("sends a campaign update operation with status PAUSED", async () => {
    mutateResourcesMock.mockResolvedValue({ mutate_operation_responses: [{}] });
    const { pauseGoogleCampaign } = await import("./tools");
    await pauseGoogleCampaign("customers/1234567890/campaigns/999");
    expect(mutateResourcesMock).toHaveBeenCalledWith([
      {
        entity: "campaign",
        operation: "update",
        resource: { resource_name: "customers/1234567890/campaigns/999", status: 3 },
      },
    ]);
  });
});

describe("updateGoogleCampaignBudget", () => {
  it("resolves campaign_budget via GAQL and mutates that budget resource", async () => {
    queryMock.mockResolvedValue([
      { campaign: { campaign_budget: "customers/1234567890/campaignBudgets/42" } },
    ]);
    mutateResourcesMock.mockResolvedValue({ mutate_operation_responses: [{}] });
    const { updateGoogleCampaignBudget } = await import("./tools");
    await updateGoogleCampaignBudget("customers/1234567890/campaigns/999", 750);
    expect(mutateResourcesMock).toHaveBeenCalledWith([
      {
        entity: "campaign_budget",
        operation: "update",
        resource: { resource_name: "customers/1234567890/campaignBudgets/42", amount_micros: 750_000_000 },
      },
    ]);
  });
});

describe("addGoogleNegativeKeyword", () => {
  it("creates a negative campaign criterion", async () => {
    mutateResourcesMock.mockResolvedValue({ mutate_operation_responses: [{}] });
    const { addGoogleNegativeKeyword } = await import("./tools");
    await addGoogleNegativeKeyword("customers/1234567890/campaigns/999", "residential");
    const operations = mutateResourcesMock.mock.calls[0][0];
    expect(operations[0]).toMatchObject({
      entity: "campaign_criterion",
      operation: "create",
      resource: { campaign: "customers/1234567890/campaigns/999", negative: true, keyword: { text: "residential" } },
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ads-agent && npx vitest run mcp/google-ads-server/tools.test.ts`
Expected: FAIL with "Cannot find module './tools'" (file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `ads-agent/mcp/google-ads-server/tools.ts` (today's `lib/connectors/google-ads.ts`, with `customer()` split so `listAccessibleCustomers` can reuse the underlying `GoogleAdsApi` client, plus the new function):

```typescript
import {
  enums,
  GoogleAdsApi,
  type MutateOperation,
  ResourceNames,
  type resources,
  toMicros,
} from "google-ads-api";
import { requireEnv } from "../../lib/env";

function googleAdsClient(): GoogleAdsApi {
  return new GoogleAdsApi({
    client_id: requireEnv("GOOGLE_ADS_CLIENT_ID"),
    client_secret: requireEnv("GOOGLE_ADS_CLIENT_SECRET"),
    developer_token: requireEnv("GOOGLE_ADS_DEVELOPER_TOKEN"),
  });
}

function customer() {
  return googleAdsClient().Customer({
    customer_id: requireEnv("GOOGLE_ADS_CUSTOMER_ID"),
    refresh_token: requireEnv("GOOGLE_ADS_REFRESH_TOKEN"),
  });
}

export type GoogleAdsPerformanceRow = {
  externalCampaignId: string;
  spend: number;
  clicks: number;
  impressions: number;
  conversions: number;
};

export async function fetchGoogleAdsPerformance(): Promise<GoogleAdsPerformanceRow[]> {
  const rows = await customer().query(`
    SELECT campaign.id, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.all_conversions
    FROM campaign
    WHERE campaign.status = "ENABLED"
    DURING LAST_3_DAYS
  `);
  return rows.map((row) => ({
    externalCampaignId: String(row.campaign?.id ?? ""),
    spend: Number(row.metrics?.cost_micros ?? 0) / 1_000_000,
    clicks: Number(row.metrics?.clicks ?? 0),
    impressions: Number(row.metrics?.impressions ?? 0),
    conversions: Number(row.metrics?.all_conversions ?? 0),
  }));
}

export type GoogleSearchTermRow = {
  externalCampaignId: string;
  searchTerm: string;
  clicks: number;
  conversions: number;
};

export async function fetchGoogleSearchTerms(): Promise<GoogleSearchTermRow[]> {
  const rows = await customer().query(`
    SELECT campaign.id, search_term_view.search_term, metrics.clicks, metrics.conversions
    FROM search_term_view
    WHERE metrics.clicks > 0
    DURING LAST_7_DAYS
  `);
  return rows.map((row) => ({
    externalCampaignId: String(row.campaign?.id ?? ""),
    searchTerm: String(row.search_term_view?.search_term ?? ""),
    clicks: Number(row.metrics?.clicks ?? 0),
    conversions: Number(row.metrics?.conversions ?? 0),
  }));
}

/** Wraps the SDK's dedicated (non-GAQL) listAccessibleCustomers RPC — matches Google's official
 * read-only MCP server's tool of the same name. */
export async function listAccessibleCustomers(): Promise<{ customerIds: string[] }> {
  const response = await googleAdsClient().listAccessibleCustomers(requireEnv("GOOGLE_ADS_REFRESH_TOKEN"));
  const customerIds = (response.resource_names ?? []).map((name) => name.replace("customers/", ""));
  return { customerIds };
}

type MutateOperationResponse = { mutate_operation_responses?: Record<string, { resource_name?: string }>[] };

function extractResourceName(result: unknown, index: number): string {
  const responses = (result as MutateOperationResponse).mutate_operation_responses ?? [];
  const response = responses[index];
  const nested = response ? Object.values(response)[0] : undefined;
  if (!nested?.resource_name) {
    throw new Error(`google ads mutate: missing resource_name at operation index ${index}`);
  }
  return nested.resource_name;
}

export type FullGoogleCampaignInput = {
  name: string;
  dailyBudgetInr: number;
  adGroupName: string;
  keywords: { text: string; matchType: "broad" | "phrase" | "exact" }[];
  negativeKeywords: string[];
  headlines: string[];
  descriptions: string[];
  finalUrl: string;
};

const MATCH_TYPE_MAP: Record<"broad" | "phrase" | "exact", number> = {
  broad: enums.KeywordMatchType.BROAD,
  phrase: enums.KeywordMatchType.PHRASE,
  exact: enums.KeywordMatchType.EXACT,
};

export async function createFullGoogleCampaign(input: FullGoogleCampaignInput): Promise<string> {
  const cus = customer();
  const customerId = String(requireEnv("GOOGLE_ADS_CUSTOMER_ID"));
  const budgetResourceName = ResourceNames.campaignBudget(customerId, "-1");
  const campaignResourceName = ResourceNames.campaign(customerId, "-2");
  const adGroupResourceName = ResourceNames.adGroup(customerId, "-3");

  const operations: MutateOperation<
    resources.ICampaignBudget | resources.ICampaign | resources.IAdGroup | resources.IAdGroupCriterion | resources.IAdGroupAd
  >[] = [
    {
      entity: "campaign_budget",
      operation: "create",
      resource: {
        resource_name: budgetResourceName,
        name: `${input.name} Budget`,
        delivery_method: enums.BudgetDeliveryMethod.STANDARD,
        amount_micros: toMicros(input.dailyBudgetInr),
      },
    },
    {
      entity: "campaign",
      operation: "create",
      resource: {
        resource_name: campaignResourceName,
        name: input.name,
        advertising_channel_type: enums.AdvertisingChannelType.SEARCH,
        status: enums.CampaignStatus.ENABLED,
        manual_cpc: { enhanced_cpc_enabled: false },
        campaign_budget: budgetResourceName,
        network_settings: { target_google_search: true, target_search_network: true },
      },
    },
    {
      entity: "ad_group",
      operation: "create",
      resource: {
        resource_name: adGroupResourceName,
        name: input.adGroupName,
        campaign: campaignResourceName,
        status: enums.AdGroupStatus.ENABLED,
        type: enums.AdGroupType.SEARCH_STANDARD,
      },
    },
    ...input.keywords.map((keyword) => ({
      entity: "ad_group_criterion" as const,
      operation: "create" as const,
      resource: {
        ad_group: adGroupResourceName,
        status: enums.AdGroupCriterionStatus.ENABLED,
        keyword: { text: keyword.text, match_type: MATCH_TYPE_MAP[keyword.matchType] },
      },
    })),
    ...input.negativeKeywords.map((text) => ({
      entity: "ad_group_criterion" as const,
      operation: "create" as const,
      resource: {
        ad_group: adGroupResourceName,
        negative: true,
        keyword: { text, match_type: enums.KeywordMatchType.BROAD },
      },
    })),
    {
      entity: "ad_group_ad",
      operation: "create",
      resource: {
        ad_group: adGroupResourceName,
        status: enums.AdGroupAdStatus.ENABLED,
        ad: {
          final_urls: [input.finalUrl],
          responsive_search_ad: {
            headlines: input.headlines.map((text) => ({ text })),
            descriptions: input.descriptions.map((text) => ({ text })),
          },
        },
      },
    },
  ];

  const result = await cus.mutateResources(operations);
  return extractResourceName(result, 1);
}

export async function pauseGoogleCampaign(campaignResourceName: string): Promise<void> {
  await customer().mutateResources([
    {
      entity: "campaign",
      operation: "update",
      resource: { resource_name: campaignResourceName, status: enums.CampaignStatus.PAUSED },
    },
  ]);
}

export async function updateGoogleCampaignBudget(
  campaignResourceName: string,
  dailyBudgetInr: number,
): Promise<void> {
  const cus = customer();
  const rows = await cus.query(`
    SELECT campaign.campaign_budget
    FROM campaign
    WHERE campaign.resource_name = '${campaignResourceName}'
  `);
  const budgetResourceName = rows[0]?.campaign?.campaign_budget;
  if (!budgetResourceName) {
    throw new Error(`google ads: no campaign_budget for ${campaignResourceName}`);
  }
  await cus.mutateResources([
    {
      entity: "campaign_budget",
      operation: "update",
      resource: { resource_name: budgetResourceName, amount_micros: toMicros(dailyBudgetInr) },
    },
  ]);
}

export async function addGoogleNegativeKeyword(
  campaignResourceName: string,
  keywordText: string,
): Promise<void> {
  await customer().mutateResources([
    {
      entity: "campaign_criterion",
      operation: "create",
      resource: {
        campaign: campaignResourceName,
        negative: true,
        keyword: { text: keywordText, match_type: enums.KeywordMatchType.BROAD },
      },
    },
  ]);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ads-agent && npx vitest run mcp/google-ads-server/tools.test.ts`
Expected: PASS (7 test cases).

- [ ] **Step 5: Commit**

```bash
git add ads-agent/mcp/google-ads-server/tools.ts ads-agent/mcp/google-ads-server/tools.test.ts
git commit -m "feat(ads-agent): add Google Ads MCP server tool implementations"
```

---

### Task 2: `lib/bifrost/google-ads-mcp-client.ts` + tool name constants

**Files:**
- Create: `ads-agent/lib/bifrost/google-ads-mcp-tools.ts`
- Create: `ads-agent/lib/bifrost/google-ads-mcp-client.ts`
- Create: `ads-agent/lib/bifrost/google-ads-mcp-client.test.ts`

**Interfaces:**
- Produces: `GOOGLE_ADS_MCP_URL: string`, `GOOGLE_ADS_MCP_TOOLS: { listCampaignPerformance, searchTermsReport, listAccessibleCustomers, createCampaign, pauseCampaign, updateCampaignBudget, addNegativeKeyword }` (all string literals), `GOOGLE_ADS_MCP_READ_TOOL_NAMES: readonly string[]` (the first 3), `listGoogleAdsTools(): Promise<McpToolSchema[]>`, `callGoogleAdsTool(name: string, args: Record<string, unknown>): Promise<unknown>`.
- Consumed by: Task 4 (only the tool-name constants, for cross-checking), Task 5 (`callGoogleAdsTool` + `GOOGLE_ADS_MCP_TOOLS`), Task 6 (`listGoogleAdsTools`, `callGoogleAdsTool`, `GOOGLE_ADS_MCP_READ_TOOL_NAMES`).
- Consumes: `parseMcpToolText` and the `McpToolSchema` type from the existing `./mcp-client` (do not duplicate that parser).

- [ ] **Step 1: Write the failing test**

Create `ads-agent/lib/bifrost/google-ads-mcp-client.test.ts` (mirrors `mcp-client.test.ts` exactly, renamed):

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const connect = vi.fn();
const listTools = vi.fn();
const callTool = vi.fn();
const close = vi.fn();

vi.mock("@modelcontextprotocol/client", () => ({
  Client: vi.fn().mockImplementation(function () {
    return { connect, listTools, callTool, close };
  }),
  StreamableHTTPClientTransport: vi.fn().mockImplementation(function (url: URL) {
    return { url };
  }),
}));

import { callGoogleAdsTool, listGoogleAdsTools } from "./google-ads-mcp-client";

beforeEach(() => {
  connect.mockReset().mockResolvedValue(undefined);
  listTools.mockReset();
  callTool.mockReset();
  close.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("listGoogleAdsTools", () => {
  it("connects, lists tools, and closes the connection", async () => {
    listTools.mockResolvedValue({
      tools: [{ name: "list_campaign_performance", description: "List campaign performance", inputSchema: { type: "object" } }],
    });

    const tools = await listGoogleAdsTools();

    expect(tools).toEqual([
      { name: "list_campaign_performance", description: "List campaign performance", inputSchema: { type: "object" } },
    ]);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("still closes the connection when listTools throws", async () => {
    listTools.mockRejectedValue(new Error("boom"));
    await expect(listGoogleAdsTools()).rejects.toThrow("boom");
    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe("callGoogleAdsTool", () => {
  it("calls callTool with name/arguments and returns the parsed text content", async () => {
    callTool.mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify([{ externalCampaignId: "111", spend: 40.5 }]) }],
    });

    const result = await callGoogleAdsTool("list_campaign_performance", {});

    expect(result).toEqual([{ externalCampaignId: "111", spend: 40.5 }]);
    expect(callTool).toHaveBeenCalledWith({ name: "list_campaign_performance", arguments: {} });
  });

  it("throws when the tool result has isError set", async () => {
    callTool.mockResolvedValue({ isError: true, content: [{ type: "text", text: "INVALID_CUSTOMER_ID" }] });
    await expect(callGoogleAdsTool("pause_campaign", { campaignResourceName: "x" })).rejects.toThrow(/INVALID_CUSTOMER_ID/);
  });

  it("closes the connection even when callTool throws", async () => {
    callTool.mockRejectedValue(new Error("network error"));
    await expect(callGoogleAdsTool("pause_campaign", { campaignResourceName: "x" })).rejects.toThrow("network error");
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("does not reject when client.close() aborts after a successful tool call", async () => {
    callTool.mockResolvedValue({ content: [{ type: "text", text: '{"ok":true}' }] });
    close.mockRejectedValue(new DOMException("This operation was aborted", "AbortError"));
    await expect(callGoogleAdsTool("pause_campaign", { campaignResourceName: "x" })).resolves.toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ads-agent && npx vitest run lib/bifrost/google-ads-mcp-client.test.ts`
Expected: FAIL with "Cannot find module './google-ads-mcp-client'".

- [ ] **Step 3: Write the implementation**

Create `ads-agent/lib/bifrost/google-ads-mcp-tools.ts`:

```typescript
/** Streamable HTTP endpoint for the in-repo Google Ads MCP server (see
 * ads-agent/mcp/google-ads-server/, started with `npm run mcp:google-ads`). */
export const GOOGLE_ADS_MCP_URL =
  process.env.GOOGLE_ADS_MCP_URL || "http://localhost:8766/mcp";

/** Tool names exposed by mcp/google-ads-server/index.ts. */
export const GOOGLE_ADS_MCP_TOOLS = {
  listCampaignPerformance: "list_campaign_performance",
  searchTermsReport: "search_terms_report",
  listAccessibleCustomers: "list_accessible_customers",
  createCampaign: "create_campaign",
  pauseCampaign: "pause_campaign",
  updateCampaignBudget: "update_campaign_budget",
  addNegativeKeyword: "add_negative_keyword",
} as const;

/** Read-only subset the model is ever allowed to see — the 4 write tools are deliberately
 * excluded here so resolve-tools-then-generate.ts can never advertise them to the LLM. */
export const GOOGLE_ADS_MCP_READ_TOOL_NAMES = [
  GOOGLE_ADS_MCP_TOOLS.listCampaignPerformance,
  GOOGLE_ADS_MCP_TOOLS.searchTermsReport,
  GOOGLE_ADS_MCP_TOOLS.listAccessibleCustomers,
] as const;
```

Create `ads-agent/lib/bifrost/google-ads-mcp-client.ts`:

```typescript
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { GOOGLE_ADS_MCP_URL } from "./google-ads-mcp-tools";
import { parseMcpToolText, type McpToolSchema } from "./mcp-client";

async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ name: "ads-agent", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(GOOGLE_ADS_MCP_URL)));
  try {
    return await fn(client);
  } finally {
    // Streamable HTTP close can AbortError after a successful call; never let that wipe the result.
    try {
      await client.close();
    } catch {
      /* ignore */
    }
  }
}

/** Live tool schemas from the Google Ads MCP server — used to build Bifrost's `tools` param. */
export async function listGoogleAdsTools(): Promise<McpToolSchema[]> {
  return withClient(async (client) => {
    const { tools } = await client.listTools();
    return tools as McpToolSchema[];
  });
}

/**
 * Calls one Google Ads MCP tool directly (no LLM, no Bifrost involved) and returns its parsed
 * content. Used both by lib/connectors/google-ads.ts's non-chat callers (cycle.ts/executor) and by
 * the chat-triggered resolve loop (resolve-tools-then-generate.ts) once a tool_call has been
 * decided by the model.
 */
export async function callGoogleAdsTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  return withClient(async (client) => {
    const result = await client.callTool({ name, arguments: args });
    const text = result.content?.find((block: { type: string }) => block.type === "text")?.text ?? "";
    if (result.isError) {
      throw new Error(`google ads mcp tool "${name}" failed: ${text}`);
    }
    return parseMcpToolText(text);
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ads-agent && npx vitest run lib/bifrost/google-ads-mcp-client.test.ts`
Expected: PASS (6 test cases).

- [ ] **Step 5: Commit**

```bash
git add ads-agent/lib/bifrost/google-ads-mcp-tools.ts ads-agent/lib/bifrost/google-ads-mcp-client.ts ads-agent/lib/bifrost/google-ads-mcp-client.test.ts
git commit -m "feat(ads-agent): add Google Ads MCP client wrapper"
```

---

### Task 3: Dependencies, env, and README

**Files:**
- Modify: `ads-agent/package.json`
- Modify: `ads-agent/.env.example`
- Modify: `ads-agent/README.md`

**Interfaces:**
- Produces: `@modelcontextprotocol/server` and `@modelcontextprotocol/node` installed at `^2.0.0` in `node_modules` (consumed by Task 4's `index.ts` imports), `npm run mcp:google-ads` script, `GOOGLE_ADS_MCP_URL` documented in `.env.example`.

- [ ] **Step 1: Add the new dependencies and script**

In `ads-agent/package.json`, add to `"scripts"` (after `"cycle:run"`):

```json
    "mcp:google-ads": "tsx --env-file=.env.local scripts/run-google-ads-mcp.ts"
```

Add to `"dependencies"` (after `"@modelcontextprotocol/client": "^2.0.0",`):

```json
    "@modelcontextprotocol/node": "^2.0.0",
    "@modelcontextprotocol/server": "^2.0.0",
```

- [ ] **Step 2: Install and verify**

Run: `cd ads-agent && npm install`
Expected: `node_modules/@modelcontextprotocol/server` and `node_modules/@modelcontextprotocol/node` exist afterward; run `ls node_modules/@modelcontextprotocol/` and confirm both `server` and `node` are listed alongside the existing `client` and `core`.

- [ ] **Step 3: Document the new env var**

In `ads-agent/.env.example`, add after the existing `GOOGLE_ADS_CUSTOMER_ID=` line:

```bash
# In-repo Google Ads MCP server (npm run mcp:google-ads)
GOOGLE_ADS_MCP_URL=http://localhost:8766/mcp
```

- [ ] **Step 4: Update the README's Google Ads section**

In `ads-agent/README.md`, replace the `### Future: MCP-based Meta/Google Ads integration` section's Google Ads bullet and closing paragraph with:

```markdown
### Google Ads MCP server

`lib/connectors/google-ads.ts` calls Google Ads exclusively through an in-repo custom TypeScript
MCP server (`mcp/google-ads-server/`) — the same "AI copilots integrate to external tools via MCP
only on the backend" convention as the Twenty CRM integration below. See
[`docs/superpowers/specs/2026-08-07-google-ads-mcp-integration-design.md`](../docs/superpowers/specs/2026-08-07-google-ads-mcp-integration-design.md)
for the full design.

1. Fill in the 5 Google Ads credential env vars above (start with a **test account** — see the
   spec's rollout runbook for how to create one with zero real-spend risk)
2. Add `GOOGLE_ADS_MCP_URL=http://localhost:8766/mcp` to `.env.local` (already in `.env.example`)
3. `npm run mcp:google-ads` (starts the MCP server; leave running in its own terminal)
4. `npm run dev` / `npm run worker` as usual — `cycle.ts`, `execute.ts`, and Copilot/Reports chat
   all reach Google Ads through this server now

The server exposes 3 read tools (advertised to chat) and 4 write tools (never advertised — writes
only ever happen through the existing approve-button → executor path).

Meta Ads MCP integration remains a documented, not-yet-implemented target — see Meta's official
hosted MCP endpoint (`mcp.facebook.com/ads`) noted below.
```

Update the paragraph immediately below (the one currently starting "Until credentials exist, `lib/connectors/meta.ts` and `lib/connectors/google-ads.ts` keep their current...") to read:

```markdown
Until credentials exist, `lib/connectors/meta.ts` keeps its current (direct API, unconfigured)
code path unchanged. `lib/connectors/google-ads.ts` is MCP-backed as of this integration (see
above) even before real credentials are set — it will simply fail soft (cycle.ts skips the
snapshot; the executor marks the proposal failed) until the MCP server is running and configured.
```

- [ ] **Step 5: Commit**

```bash
git add ads-agent/package.json ads-agent/package-lock.json ads-agent/.env.example ads-agent/README.md
git commit -m "chore(ads-agent): add Google Ads MCP server dependencies and docs"
```

---

### Task 4: `mcp/google-ads-server/index.ts` — server bootstrap

**Files:**
- Create: `ads-agent/mcp/google-ads-server/index.ts`
- Create: `ads-agent/mcp/google-ads-server/index.test.ts`
- Create: `ads-agent/scripts/run-google-ads-mcp.ts`

**Interfaces:**
- Consumes: Task 1's `./tools` exports (all 7 functions/types).
- Produces: `buildGoogleAdsMcpServer(): McpServer` (consumed by this task's own test and by `run-google-ads-mcp.ts`), `startGoogleAdsMcpServer(port?: number): Promise<void>` (consumed by `scripts/run-google-ads-mcp.ts`).
- Registers exactly 7 MCP tools: `list_campaign_performance`, `search_terms_report`, `list_accessible_customers`, `create_campaign`, `pause_campaign`, `update_campaign_budget`, `add_negative_keyword`.

- [ ] **Step 1: Write the failing test**

Create `ads-agent/mcp/google-ads-server/index.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";

const toolsMock = vi.hoisted(() => ({
  fetchGoogleAdsPerformance: vi.fn(),
  fetchGoogleSearchTerms: vi.fn(),
  listAccessibleCustomers: vi.fn(),
  createFullGoogleCampaign: vi.fn(),
  pauseGoogleCampaign: vi.fn(),
  updateGoogleCampaignBudget: vi.fn(),
  addGoogleNegativeKeyword: vi.fn(),
}));
vi.mock("./tools", () => toolsMock);

import { buildGoogleAdsMcpServer } from "./index";

beforeEach(() => {
  vi.clearAllMocks();
});

async function connectedClient() {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildGoogleAdsMcpServer();
  const client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

const READ_TOOL_NAMES = ["list_campaign_performance", "search_terms_report", "list_accessible_customers"];
const WRITE_TOOL_NAMES = ["create_campaign", "pause_campaign", "update_campaign_budget", "add_negative_keyword"];

describe("buildGoogleAdsMcpServer", () => {
  it("registers exactly 7 tools: 3 read + 4 write", async () => {
    const client = await connectedClient();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...READ_TOOL_NAMES, ...WRITE_TOOL_NAMES].sort());
    await client.close();
  });

  it("list_campaign_performance calls fetchGoogleAdsPerformance and returns its rows as JSON", async () => {
    toolsMock.fetchGoogleAdsPerformance.mockResolvedValue([
      { externalCampaignId: "1", spend: 1, clicks: 1, impressions: 1, conversions: 0 },
    ]);
    const client = await connectedClient();
    const result = await client.callTool({ name: "list_campaign_performance", arguments: {} });
    const text = (result.content as { type: string; text: string }[])[0].text;
    expect(JSON.parse(text)).toEqual([{ externalCampaignId: "1", spend: 1, clicks: 1, impressions: 1, conversions: 0 }]);
    await client.close();
  });

  it("pause_campaign calls pauseGoogleCampaign with the given resource name", async () => {
    toolsMock.pauseGoogleCampaign.mockResolvedValue(undefined);
    const client = await connectedClient();
    await client.callTool({ name: "pause_campaign", arguments: { campaignResourceName: "customers/1/campaigns/2" } });
    expect(toolsMock.pauseGoogleCampaign).toHaveBeenCalledWith("customers/1/campaigns/2");
    await client.close();
  });

  it("create_campaign calls createFullGoogleCampaign with the parsed input and returns its resource name", async () => {
    toolsMock.createFullGoogleCampaign.mockResolvedValue("customers/1/campaigns/999");
    const client = await connectedClient();
    const input = {
      name: "Whitefield Search",
      dailyBudgetInr: 500,
      adGroupName: "Whitefield Office Space",
      keywords: [{ text: "office space whitefield", matchType: "phrase" as const }],
      negativeKeywords: ["residential"],
      headlines: ["Office Space in Whitefield"],
      descriptions: ["Skip the broker games."],
      finalUrl: "https://www.gentlespacesolutions.com/spaces",
    };
    const result = await client.callTool({ name: "create_campaign", arguments: input });
    expect(toolsMock.createFullGoogleCampaign).toHaveBeenCalledWith(input);
    const text = (result.content as { type: string; text: string }[])[0].text;
    expect(JSON.parse(text)).toEqual({ resourceName: "customers/1/campaigns/999" });
    await client.close();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ads-agent && npx vitest run mcp/google-ads-server/index.test.ts`
Expected: FAIL with "Cannot find module './index'".

- [ ] **Step 3: Write the implementation**

Create `ads-agent/mcp/google-ads-server/index.ts`:

```typescript
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { McpServer } from "@modelcontextprotocol/server";
import { NodeStreamableHTTPServerTransport } from "@modelcontextprotocol/node";
import { z } from "zod";
import {
  addGoogleNegativeKeyword,
  createFullGoogleCampaign,
  fetchGoogleAdsPerformance,
  fetchGoogleSearchTerms,
  listAccessibleCustomers,
  pauseGoogleCampaign,
  updateGoogleCampaignBudget,
} from "./tools";

const MATCH_TYPES = ["broad", "phrase", "exact"] as const;

/** Builds (but does not connect/serve) the Google Ads MCP server — 3 read tools + 4 write tools.
 * Exported separately from startGoogleAdsMcpServer so tests can wire it to an in-memory transport
 * instead of a real HTTP port (see index.test.ts). */
export function buildGoogleAdsMcpServer(): McpServer {
  const server = new McpServer({ name: "google-ads-mcp", version: "1.0.0" });

  server.registerTool(
    "list_campaign_performance",
    { description: "List last-3-day spend/clicks/impressions/conversions for enabled Google Ads campaigns" },
    async () => ({ content: [{ type: "text", text: JSON.stringify(await fetchGoogleAdsPerformance()) }] }),
  );

  server.registerTool(
    "search_terms_report",
    { description: "List last-7-day search terms with clicks/conversions across Google Ads campaigns" },
    async () => ({ content: [{ type: "text", text: JSON.stringify(await fetchGoogleSearchTerms()) }] }),
  );

  server.registerTool(
    "list_accessible_customers",
    { description: "List Google Ads customer IDs accessible to the configured refresh token" },
    async () => ({ content: [{ type: "text", text: JSON.stringify(await listAccessibleCustomers()) }] }),
  );

  server.registerTool(
    "create_campaign",
    {
      description:
        "Atomically create a Google Ads Search campaign: budget, campaign, ad group, keywords, negatives, one responsive search ad",
      inputSchema: z.object({
        name: z.string(),
        dailyBudgetInr: z.number(),
        adGroupName: z.string(),
        keywords: z.array(z.object({ text: z.string(), matchType: z.enum(MATCH_TYPES) })),
        negativeKeywords: z.array(z.string()),
        headlines: z.array(z.string()),
        descriptions: z.array(z.string()),
        finalUrl: z.string(),
      }),
    },
    async (input) => ({
      content: [{ type: "text", text: JSON.stringify({ resourceName: await createFullGoogleCampaign(input) }) }],
    }),
  );

  server.registerTool(
    "pause_campaign",
    { description: "Pause a Google Ads campaign", inputSchema: z.object({ campaignResourceName: z.string() }) },
    async ({ campaignResourceName }) => {
      await pauseGoogleCampaign(campaignResourceName);
      return { content: [{ type: "text", text: JSON.stringify({ ok: true }) }] };
    },
  );

  server.registerTool(
    "update_campaign_budget",
    {
      description: "Update a Google Ads campaign's daily budget",
      inputSchema: z.object({ campaignResourceName: z.string(), dailyBudgetInr: z.number() }),
    },
    async ({ campaignResourceName, dailyBudgetInr }) => {
      await updateGoogleCampaignBudget(campaignResourceName, dailyBudgetInr);
      return { content: [{ type: "text", text: JSON.stringify({ ok: true }) }] };
    },
  );

  server.registerTool(
    "add_negative_keyword",
    {
      description: "Add a campaign-level negative keyword to a Google Ads campaign",
      inputSchema: z.object({ campaignResourceName: z.string(), keywordText: z.string() }),
    },
    async ({ campaignResourceName, keywordText }) => {
      await addGoogleNegativeKeyword(campaignResourceName, keywordText);
      return { content: [{ type: "text", text: JSON.stringify({ ok: true }) }] };
    },
  );

  return server;
}

/** Starts the Google Ads MCP server over Streamable HTTP, bound to localhost only. */
export async function startGoogleAdsMcpServer(port = 8766): Promise<void> {
  const server = buildGoogleAdsMcpServer();
  const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID() });
  await server.connect(transport);

  createServer((req, res) => {
    if (req.url !== "/mcp") {
      res.writeHead(404).end();
      return;
    }
    void transport.handleRequest(req, res);
  }).listen(port, "localhost", () => {
    console.log(`google-ads-mcp listening on http://localhost:${port}/mcp`);
  });
}
```

Create `ads-agent/scripts/run-google-ads-mcp.ts`:

```typescript
/**
 * Standalone Google Ads MCP server — `npm run mcp:google-ads`. Binds to localhost only; see
 * docs/superpowers/specs/2026-08-07-google-ads-mcp-integration-design.md.
 */
import { startGoogleAdsMcpServer } from "../mcp/google-ads-server/index";

startGoogleAdsMcpServer().catch((err) => {
  console.error("google-ads-mcp: failed to start", err);
  process.exit(1);
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ads-agent && npx vitest run mcp/google-ads-server/index.test.ts`
Expected: PASS (4 test cases).

- [ ] **Step 5: Commit**

```bash
git add ads-agent/mcp/google-ads-server/index.ts ads-agent/mcp/google-ads-server/index.test.ts ads-agent/scripts/run-google-ads-mcp.ts
git commit -m "feat(ads-agent): bootstrap Google Ads MCP server over Streamable HTTP"
```

---

### Task 5: `lib/connectors/google-ads.ts` — rewrite as thin MCP client wrapper

**Files:**
- Modify: `ads-agent/lib/connectors/google-ads.ts`
- Modify: `ads-agent/lib/connectors/google-ads.test.ts`

**Interfaces:**
- Consumes: Task 2's `callGoogleAdsTool` and `GOOGLE_ADS_MCP_TOOLS`.
- Produces (unchanged from today): `fetchGoogleAdsPerformance(): Promise<GoogleAdsPerformanceRow[]>`, `fetchGoogleSearchTerms(): Promise<GoogleSearchTermRow[]>`, `createFullGoogleCampaign(input: FullGoogleCampaignInput): Promise<string>`, `pauseGoogleCampaign(campaignResourceName: string): Promise<void>`, `updateGoogleCampaignBudget(campaignResourceName: string, dailyBudgetInr: number): Promise<void>`, `addGoogleNegativeKeyword(campaignResourceName: string, keywordText: string): Promise<void>` — consumed unchanged by `lib/decision-engine/cycle.ts` and `lib/executor/execute.ts` (no changes needed to either file — confirm via `run_sql` against the Torbit graph: `SELECT file_path, import_path, identifier_name FROM gl_imported_symbol WHERE project_id = 1672773718350201492 AND import_path LIKE '%connectors/google-ads%'`).

- [ ] **Step 1: Write the failing tests**

Replace the entire contents of `ads-agent/lib/connectors/google-ads.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";

const { callGoogleAdsTool } = vi.hoisted(() => ({ callGoogleAdsTool: vi.fn() }));
vi.mock("../bifrost/google-ads-mcp-client", () => ({ callGoogleAdsTool }));

import {
  addGoogleNegativeKeyword,
  createFullGoogleCampaign,
  fetchGoogleAdsPerformance,
  fetchGoogleSearchTerms,
  pauseGoogleCampaign,
  updateGoogleCampaignBudget,
} from "./google-ads";

beforeEach(() => {
  callGoogleAdsTool.mockReset();
});

describe("fetchGoogleAdsPerformance", () => {
  it("calls list_campaign_performance with no args and returns the rows", async () => {
    const rows = [{ externalCampaignId: "111", spend: 40.5, clicks: 12, impressions: 900, conversions: 1 }];
    callGoogleAdsTool.mockResolvedValue(rows);
    const result = await fetchGoogleAdsPerformance();
    expect(result).toEqual(rows);
    expect(callGoogleAdsTool).toHaveBeenCalledWith("list_campaign_performance", {});
  });
});

describe("fetchGoogleSearchTerms", () => {
  it("calls search_terms_report with no args and returns the rows", async () => {
    const rows = [{ externalCampaignId: "111", searchTerm: "office space for rent", clicks: 4, conversions: 0 }];
    callGoogleAdsTool.mockResolvedValue(rows);
    const result = await fetchGoogleSearchTerms();
    expect(result).toEqual(rows);
    expect(callGoogleAdsTool).toHaveBeenCalledWith("search_terms_report", {});
  });
});

describe("createFullGoogleCampaign", () => {
  it("calls create_campaign with the input and returns the resource name from the result", async () => {
    const input = {
      name: "Whitefield Search",
      dailyBudgetInr: 500,
      adGroupName: "Whitefield Office Space",
      keywords: [{ text: "office space whitefield", matchType: "phrase" as const }],
      negativeKeywords: ["residential"],
      headlines: ["Office Space in Whitefield"],
      descriptions: ["Skip the broker games."],
      finalUrl: "https://www.gentlespacesolutions.com/spaces",
    };
    callGoogleAdsTool.mockResolvedValue({ resourceName: "customers/1234567890/campaigns/999" });
    const resourceName = await createFullGoogleCampaign(input);
    expect(resourceName).toBe("customers/1234567890/campaigns/999");
    expect(callGoogleAdsTool).toHaveBeenCalledWith("create_campaign", input);
  });
});

describe("pauseGoogleCampaign", () => {
  it("calls pause_campaign with the campaign resource name", async () => {
    callGoogleAdsTool.mockResolvedValue({ ok: true });
    await pauseGoogleCampaign("customers/1234567890/campaigns/999");
    expect(callGoogleAdsTool).toHaveBeenCalledWith("pause_campaign", {
      campaignResourceName: "customers/1234567890/campaigns/999",
    });
  });
});

describe("updateGoogleCampaignBudget", () => {
  it("calls update_campaign_budget with the campaign resource name and new budget", async () => {
    callGoogleAdsTool.mockResolvedValue({ ok: true });
    await updateGoogleCampaignBudget("customers/1234567890/campaigns/999", 750);
    expect(callGoogleAdsTool).toHaveBeenCalledWith("update_campaign_budget", {
      campaignResourceName: "customers/1234567890/campaigns/999",
      dailyBudgetInr: 750,
    });
  });
});

describe("addGoogleNegativeKeyword", () => {
  it("calls add_negative_keyword with the campaign resource name and keyword text", async () => {
    callGoogleAdsTool.mockResolvedValue({ ok: true });
    await addGoogleNegativeKeyword("customers/1234567890/campaigns/999", "residential");
    expect(callGoogleAdsTool).toHaveBeenCalledWith("add_negative_keyword", {
      campaignResourceName: "customers/1234567890/campaigns/999",
      keywordText: "residential",
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ads-agent && npx vitest run lib/connectors/google-ads.test.ts`
Expected: FAIL — old assertions (mocking `google-ads-api`) no longer match the new test file's `callGoogleAdsTool` expectations, and `./google-ads` still calls the SDK directly.

- [ ] **Step 3: Write the implementation**

Replace the entire contents of `ads-agent/lib/connectors/google-ads.ts`:

```typescript
import { callGoogleAdsTool } from "../bifrost/google-ads-mcp-client";
import { GOOGLE_ADS_MCP_TOOLS } from "../bifrost/google-ads-mcp-tools";

export type GoogleAdsPerformanceRow = {
  externalCampaignId: string;
  spend: number;
  clicks: number;
  impressions: number;
  conversions: number;
};

export async function fetchGoogleAdsPerformance(): Promise<GoogleAdsPerformanceRow[]> {
  return (await callGoogleAdsTool(GOOGLE_ADS_MCP_TOOLS.listCampaignPerformance, {})) as GoogleAdsPerformanceRow[];
}

export type GoogleSearchTermRow = {
  externalCampaignId: string;
  searchTerm: string;
  clicks: number;
  conversions: number;
};

export async function fetchGoogleSearchTerms(): Promise<GoogleSearchTermRow[]> {
  return (await callGoogleAdsTool(GOOGLE_ADS_MCP_TOOLS.searchTermsReport, {})) as GoogleSearchTermRow[];
}

export type FullGoogleCampaignInput = {
  name: string;
  dailyBudgetInr: number;
  adGroupName: string;
  keywords: { text: string; matchType: "broad" | "phrase" | "exact" }[];
  negativeKeywords: string[];
  headlines: string[];
  descriptions: string[];
  finalUrl: string;
};

export async function createFullGoogleCampaign(input: FullGoogleCampaignInput): Promise<string> {
  const result = (await callGoogleAdsTool(GOOGLE_ADS_MCP_TOOLS.createCampaign, input)) as { resourceName: string };
  return result.resourceName;
}

export async function pauseGoogleCampaign(campaignResourceName: string): Promise<void> {
  await callGoogleAdsTool(GOOGLE_ADS_MCP_TOOLS.pauseCampaign, { campaignResourceName });
}

export async function updateGoogleCampaignBudget(
  campaignResourceName: string,
  dailyBudgetInr: number,
): Promise<void> {
  await callGoogleAdsTool(GOOGLE_ADS_MCP_TOOLS.updateCampaignBudget, { campaignResourceName, dailyBudgetInr });
}

export async function addGoogleNegativeKeyword(
  campaignResourceName: string,
  keywordText: string,
): Promise<void> {
  await callGoogleAdsTool(GOOGLE_ADS_MCP_TOOLS.addNegativeKeyword, { campaignResourceName, keywordText });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ads-agent && npx vitest run lib/connectors/google-ads.test.ts lib/decision-engine/cycle.test.ts lib/executor/execute.test.ts`
Expected: PASS — including `cycle.test.ts`/`execute.test.ts` unchanged (confirms zero call-site breakage). If either of those two test files don't exist, skip them; the important assertion is `google-ads.test.ts` passing with 6 cases.

- [ ] **Step 5: Commit**

```bash
git add ads-agent/lib/connectors/google-ads.ts ads-agent/lib/connectors/google-ads.test.ts
git commit -m "refactor(ads-agent): route lib/connectors/google-ads.ts through the MCP client"
```

---

### Task 6: `lib/openui/resolve-tools-then-generate.ts` — Google Ads read-tool resolution

**Files:**
- Modify: `ads-agent/lib/openui/resolve-tools-then-generate.ts`
- Modify: `ads-agent/lib/openui/resolve-tools-then-generate.test.ts`

**Interfaces:**
- Consumes: Task 2's `listGoogleAdsTools`, `callGoogleAdsTool`, `GOOGLE_ADS_MCP_READ_TOOL_NAMES`.
- Produces (unchanged signature): `resolveToolsThenGenerate(ctx: MeteringContext, messages: ChatMessage[]): Promise<ChatMessage[]>`.
- `reshapeTwentyOpportunityToolResult` (from `../crm/twenty-pipeline`, unchanged) is still called on every tool result — it already returns `raw` unchanged for any tool name it doesn't recognize, so Google Ads results pass through unreshaped with zero changes needed there.

- [ ] **Step 1: Write the failing tests**

In `ads-agent/lib/openui/resolve-tools-then-generate.test.ts`, add Google Ads mocks and cases. Replace the top of the file (imports/mocks) with:

```typescript
// ads-agent/lib/openui/resolve-tools-then-generate.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const { callMeteredChatCompletion, listTwentyTools, callTwentyTool, listGoogleAdsTools, callGoogleAdsTool } = vi.hoisted(() => ({
  callMeteredChatCompletion: vi.fn(),
  listTwentyTools: vi.fn(),
  callTwentyTool: vi.fn(),
  listGoogleAdsTools: vi.fn(),
  callGoogleAdsTool: vi.fn(),
}));
vi.mock("../metering/metered-client", () => ({ callMeteredChatCompletion }));
vi.mock("../bifrost/mcp-client", () => ({ listTwentyTools, callTwentyTool }));
vi.mock("../bifrost/google-ads-mcp-client", () => ({ listGoogleAdsTools, callGoogleAdsTool }));

import { resolveToolsThenGenerate } from "./resolve-tools-then-generate";
import type { MeteringContext } from "../metering/types";

const ctx: MeteringContext = { orgId: "org-1", userId: "user-1", feature: "test" };
const baseMessages = [
  { role: "system" as const, content: "sys" },
  { role: "user" as const, content: "show me hot leads" },
];
const readOnlySchemas = [
  { name: "list_opportunities", description: "List opportunities", inputSchema: { type: "object" } },
  { name: "get_opportunity", description: "Get one opportunity", inputSchema: { type: "object" } },
];
const googleAdsReadSchemas = [
  { name: "list_campaign_performance", description: "List campaign performance", inputSchema: { type: "object" } },
  { name: "search_terms_report", description: "Search terms report", inputSchema: { type: "object" } },
  { name: "list_accessible_customers", description: "List accessible customers", inputSchema: { type: "object" } },
];

beforeEach(() => {
  callMeteredChatCompletion.mockReset();
  listTwentyTools.mockReset().mockResolvedValue([
    ...readOnlySchemas,
    { name: "update_opportunity", description: "Update", inputSchema: { type: "object" } },
  ]);
  callTwentyTool.mockReset();
  listGoogleAdsTools.mockReset().mockResolvedValue([
    ...googleAdsReadSchemas,
    { name: "pause_campaign", description: "Pause", inputSchema: { type: "object" } },
    { name: "create_campaign", description: "Create", inputSchema: { type: "object" } },
    { name: "update_campaign_budget", description: "Budget", inputSchema: { type: "object" } },
    { name: "add_negative_keyword", description: "Negative", inputSchema: { type: "object" } },
  ]);
  callGoogleAdsTool.mockReset();
});
```

Keep every existing `describe` block in the file unchanged, and add these new ones at the end:

```typescript
describe("resolveToolsThenGenerate — Google Ads", () => {
  it("advertises all 3 Google Ads read tools alongside the 2 Twenty read tools, never the 4 Google Ads write tools", async () => {
    callMeteredChatCompletion.mockResolvedValue({
      choices: [{ message: { role: "assistant", content: "no tools needed" } }],
    });

    await resolveToolsThenGenerate(ctx, baseMessages);

    const [, options] = callMeteredChatCompletion.mock.calls[0];
    const names = options.tools.map((t: { function: { name: string } }) => t.function.name);
    expect(names).toEqual([
      "list_opportunities",
      "get_opportunity",
      "list_campaign_performance",
      "search_terms_report",
      "list_accessible_customers",
    ]);
  });

  it("executes a Google Ads read tool call via callGoogleAdsTool (not callTwentyTool) and appends the raw result", async () => {
    const toolCall = {
      id: "call_1",
      type: "function" as const,
      function: { name: "list_campaign_performance", arguments: "{}" },
    };
    callMeteredChatCompletion
      .mockResolvedValueOnce({ choices: [{ message: { role: "assistant", content: null, tool_calls: [toolCall] } }] } as never)
      .mockResolvedValueOnce({ choices: [{ message: { role: "assistant", content: "done" } }] } as never);
    const rows = [{ externalCampaignId: "111", spend: 40.5, clicks: 12, impressions: 900, conversions: 1 }];
    callGoogleAdsTool.mockResolvedValue(rows);

    const result = await resolveToolsThenGenerate(ctx, baseMessages);

    expect(result).toEqual([
      ...baseMessages,
      { role: "assistant", content: null, tool_calls: [toolCall] },
      { role: "tool", content: JSON.stringify(rows), tool_call_id: "call_1" },
    ]);
    expect(callGoogleAdsTool).toHaveBeenCalledWith("list_campaign_performance", {});
    expect(callTwentyTool).not.toHaveBeenCalled();
  });

  it("rejects a Google Ads write tool name even if the model requests it", async () => {
    const mutatingCall = {
      id: "call_1",
      type: "function" as const,
      function: { name: "pause_campaign", arguments: '{"campaignResourceName":"x"}' },
    };
    callMeteredChatCompletion.mockResolvedValue({
      choices: [{ message: { role: "assistant", content: null, tool_calls: [mutatingCall] } }],
    } as never);

    const result = await resolveToolsThenGenerate(ctx, baseMessages);

    expect(callGoogleAdsTool).not.toHaveBeenCalled();
    expect(result).toEqual(baseMessages);
  });

  it("still advertises Twenty's read tools when the Google Ads MCP server is unreachable", async () => {
    listGoogleAdsTools.mockRejectedValue(new Error("google-ads-mcp unreachable"));
    callMeteredChatCompletion.mockResolvedValue({
      choices: [{ message: { role: "assistant", content: "no tools needed" } }],
    });

    await resolveToolsThenGenerate(ctx, baseMessages);

    const [, options] = callMeteredChatCompletion.mock.calls[0];
    const names = options.tools.map((t: { function: { name: string } }) => t.function.name);
    expect(names).toEqual(["list_opportunities", "get_opportunity"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ads-agent && npx vitest run lib/openui/resolve-tools-then-generate.test.ts`
Expected: FAIL — `../bifrost/google-ads-mcp-client` mock target doesn't exist as an import in the source file yet, and the merged-tools/soft-fail behavior isn't implemented.

- [ ] **Step 3: Write the implementation**

Replace the entire contents of `ads-agent/lib/openui/resolve-tools-then-generate.ts`:

```typescript
// ads-agent/lib/openui/resolve-tools-then-generate.ts
import { callMeteredChatCompletion } from "../metering/metered-client";
import { callTwentyTool, listTwentyTools } from "../bifrost/mcp-client";
import { callGoogleAdsTool, listGoogleAdsTools } from "../bifrost/google-ads-mcp-client";
import { TWENTY_MCP_READ_TOOL_NAMES } from "../bifrost/twenty-mcp-tools";
import { GOOGLE_ADS_MCP_READ_TOOL_NAMES } from "../bifrost/google-ads-mcp-tools";
import { reshapeTwentyOpportunityToolResult } from "../crm/twenty-pipeline";
import type { ChatMessage, ToolDefinition } from "../bifrost/client";
import type { MeteringContext } from "../metering/types";

const MAX_ROUNDS = 2;

const GOOGLE_ADS_READ_TOOL_NAME_SET = new Set<string>(GOOGLE_ADS_MCP_READ_TOOL_NAMES);

function callReadTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  return GOOGLE_ADS_READ_TOOL_NAME_SET.has(name) ? callGoogleAdsTool(name, args) : callTwentyTool(name, args);
}

/**
 * Phase 1 of the two-phase MCP tool pattern (see
 * docs/superpowers/specs/2026-08-05-mcp-backend-tool-integration-design.md and
 * docs/superpowers/specs/2026-08-07-google-ads-mcp-integration-design.md): fetches both the Twenty
 * and Google Ads MCP servers' live tool schemas, filters each to its read-only subset, and lets the
 * model request them via a plain OpenAI-compatible `tools` param on a non-streaming Bifrost call.
 * Tool calls are executed directly against whichever MCP server owns that tool name (never through
 * Bifrost). The two servers are listed with Promise.allSettled, not Promise.all: one MCP server
 * being unreachable (e.g. Google Ads mid-rollout, before credentials exist) must not remove the
 * other's tools from the conversation — this is the same soft-fail convention cycle.ts already
 * uses per-platform. Opportunity read results are reshaped to OpenUI OpportunityCard field shape
 * before append (Google Ads results pass through unreshaped — reshapeTwentyOpportunityToolResult
 * returns non-Twenty tool results unchanged). Never throws: any failure (both MCP servers
 * unreachable, Bifrost unreachable, tool execution error) returns the input messages unchanged, so
 * the caller's Phase 2 proceeds with whatever context is available rather than failing the turn.
 */
export async function resolveToolsThenGenerate(
  ctx: MeteringContext,
  messages: ChatMessage[],
): Promise<ChatMessage[]> {
  const [twentyResult, googleAdsResult] = await Promise.allSettled([listTwentyTools(), listGoogleAdsTools()]);
  const twentySchemas = twentyResult.status === "fulfilled" ? twentyResult.value : [];
  const googleAdsSchemas = googleAdsResult.status === "fulfilled" ? googleAdsResult.value : [];

  const readOnlyTools: ToolDefinition[] = [
    ...twentySchemas.filter((schema) => (TWENTY_MCP_READ_TOOL_NAMES as readonly string[]).includes(schema.name)),
    ...googleAdsSchemas.filter((schema) => (GOOGLE_ADS_MCP_READ_TOOL_NAMES as readonly string[]).includes(schema.name)),
  ].map((schema) => ({
    type: "function" as const,
    function: { name: schema.name, description: schema.description, parameters: schema.inputSchema },
  }));

  let history = [...messages];

  for (let round = 0; round < MAX_ROUNDS; round++) {
    let message;
    try {
      const response = await callMeteredChatCompletion(ctx, {
        messages: history,
        temperature: 0.2,
        maxTokens: 1024,
        timeoutMs: 15_000,
        tools: readOnlyTools,
      });
      message = response.choices?.[0]?.message;
    } catch {
      return messages;
    }

    // Defense in depth: even though readOnlyTools never included a mutating schema, reject any
    // tool_call name the model wasn't explicitly given — a hallucinated name is treated the same
    // as no tool calls at all for this round, not executed.
    const advertisedNames = new Set(readOnlyTools.map((t) => t.function.name));
    const toolCalls = (message?.tool_calls ?? []).filter((call) => advertisedNames.has(call.function.name));
    if (toolCalls.length === 0) break;

    history = [...history, { role: "assistant", content: message?.content ?? null, tool_calls: toolCalls }];

    try {
      const results = await Promise.all(
        toolCalls.map(async (call) => {
          const raw = await callReadTool(call.function.name, JSON.parse(call.function.arguments));
          return {
            role: "tool" as const,
            content: JSON.stringify(reshapeTwentyOpportunityToolResult(call.function.name, raw)),
            tool_call_id: call.id,
          };
        }),
      );
      history = [...history, ...results];
    } catch {
      return messages;
    }
  }

  return history;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ads-agent && npx vitest run lib/openui/resolve-tools-then-generate.test.ts`
Expected: PASS (all original cases + the 4 new Google Ads cases).

- [ ] **Step 5: Commit**

```bash
git add ads-agent/lib/openui/resolve-tools-then-generate.ts ads-agent/lib/openui/resolve-tools-then-generate.test.ts
git commit -m "feat(ads-agent): resolve Google Ads read tools alongside Twenty in chat"
```

---

### Task 7: Live smoke test

**Files:**
- Create: `ads-agent/mcp/google-ads-server/live-smoke.test.ts`

**Interfaces:**
- Consumes: Task 2's `listGoogleAdsTools`, `callGoogleAdsTool`, `GOOGLE_ADS_MCP_TOOLS`.

This test is opt-in (mirrors `lib/openui/openui-live-smoke.test.ts`'s `OPENUI_LIVE_SMOKE` convention) — it is always skipped in normal `npm test` runs (no credentials required for Task 8's verification), and only runs when a human has real test-account credentials in `.env.local` and `npm run mcp:google-ads` running in another terminal.

- [ ] **Step 1: Write the test**

Create `ads-agent/mcp/google-ads-server/live-smoke.test.ts`:

```typescript
/**
 * Live Google Ads MCP smoke (opt-in): requires `npm run mcp:google-ads` running locally against
 * real (test-account) credentials in .env.local.
 *   GOOGLE_ADS_MCP_LIVE_SMOKE=1 npx vitest run mcp/google-ads-server/live-smoke.test.ts
 */
import { describe, expect, it } from "vitest";
import { callGoogleAdsTool, listGoogleAdsTools } from "../../lib/bifrost/google-ads-mcp-client";
import { GOOGLE_ADS_MCP_TOOLS } from "../../lib/bifrost/google-ads-mcp-tools";

const LIVE = process.env.GOOGLE_ADS_MCP_LIVE_SMOKE === "1";

describe.skipIf(!LIVE)("Google Ads MCP server (live)", () => {
  it(
    "exposes exactly 7 tools (3 read + 4 write)",
    async () => {
      const tools = await listGoogleAdsTools();
      expect(tools.map((t) => t.name).sort()).toEqual(Object.values(GOOGLE_ADS_MCP_TOOLS).sort());
      expect(tools).toHaveLength(7);
    },
    15_000,
  );

  it(
    "search_terms_report against the test account returns an array (rows or empty, not an error)",
    async () => {
      const rows = await callGoogleAdsTool(GOOGLE_ADS_MCP_TOOLS.searchTermsReport, {});
      expect(Array.isArray(rows)).toBe(true);
    },
    15_000,
  );

  it(
    "list_accessible_customers returns the configured test account's customer ID",
    async () => {
      const result = (await callGoogleAdsTool(GOOGLE_ADS_MCP_TOOLS.listAccessibleCustomers, {})) as {
        customerIds: string[];
      };
      expect(result.customerIds.length).toBeGreaterThan(0);
    },
    15_000,
  );
});
```

- [ ] **Step 2: Verify it's skipped by default**

Run: `cd ads-agent && npx vitest run mcp/google-ads-server/live-smoke.test.ts`
Expected: 3 tests reported as "skipped" (not run, not failed) — `GOOGLE_ADS_MCP_LIVE_SMOKE` is unset.

- [ ] **Step 3: Commit**

```bash
git add ads-agent/mcp/google-ads-server/live-smoke.test.ts
git commit -m "test(ads-agent): add opt-in Google Ads MCP live smoke test"
```

- [ ] **Step 4 (manual, once test-account credentials exist per the design spec's rollout runbook):**

In one terminal: `cd ads-agent && npm run mcp:google-ads`. In another: `cd ads-agent && GOOGLE_ADS_MCP_LIVE_SMOKE=1 npx vitest run mcp/google-ads-server/live-smoke.test.ts`. Expected: all 3 tests pass against the real test account.

---

### Task 9: `cycle.ts` — per-platform soft-fail (closes a spec/implementation gap found in self-review)

**Files:**
- Modify: `ads-agent/lib/decision-engine/cycle.ts`
- Modify: `ads-agent/lib/decision-engine/cycle.test.ts`

**Interfaces:**
- No signature changes — `runDecisionCycle(): Promise<{ proposalsCreated: number }>` is unchanged. Purely internal: each of `fetchGoogleAdsPerformance()`/`fetchMetaPerformance()`/`fetchGoogleSearchTerms()` is now individually caught, so one platform throwing (e.g. the Google Ads MCP server being down) no longer aborts the whole `Promise.all` and skips every platform's snapshot for that tick.

- [ ] **Step 1: Write the failing test**

Add to `ads-agent/lib/decision-engine/cycle.test.ts`, inside the existing `describe("runDecisionCycle", ...)` block (uses the same hoisted mocks already declared at the top of the file — no new imports needed):

```typescript
  it("still records the Meta snapshot when fetchGoogleAdsPerformance rejects (MCP server unreachable)", async () => {
    fetchGoogleAdsPerformance.mockRejectedValue(new Error("google ads mcp: connect ECONNREFUSED"));

    await expect(runDecisionCycle()).resolves.toEqual({ proposalsCreated: 0 });

    expect(recordPerformanceSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ campaignId: "camp-meta", spend: 300 }),
    );
    expect(recordPerformanceSnapshot).not.toHaveBeenCalledWith(
      expect.objectContaining({ campaignId: "camp-google" }),
    );
  });

  it("still records the Google Ads snapshot when fetchMetaPerformance rejects", async () => {
    fetchMetaPerformance.mockRejectedValue(new Error("meta: rate limited"));

    await expect(runDecisionCycle()).resolves.toEqual({ proposalsCreated: 0 });

    expect(recordPerformanceSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({ campaignId: "camp-google", spend: 400 }),
    );
  });

  it("passes an empty search-terms list into evaluateRules when fetchGoogleSearchTerms rejects, without throwing", async () => {
    fetchGoogleSearchTerms.mockRejectedValue(new Error("google ads mcp: connect ECONNREFUSED"));

    await runDecisionCycle();

    const ruleInput = evaluateRules.mock.calls[0][0];
    expect(ruleInput.searchTerms).toEqual([]);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ads-agent && npx vitest run lib/decision-engine/cycle.test.ts`
Expected: the 3 new tests FAIL — today's `Promise.all` rejects as soon as any one fetch rejects, so `runDecisionCycle()` throws instead of resolving to `{ proposalsCreated: 0 }`.

- [ ] **Step 3: Write the implementation**

In `ads-agent/lib/decision-engine/cycle.ts`, add a small soft-fail helper and wrap the 3 fetches that don't already fail soft internally (`fetchLeadSignal` already does — see `lib/connectors/twenty.ts` — so it's left as-is):

```typescript
import { listCampaigns } from "../db/campaigns";
import { createProposal } from "../db/proposals";
import { recordCrmSignalSnapshot, recordPerformanceSnapshot, recentPerformanceSnapshots } from "../db/snapshots";
import { logAiAction } from "../db/ai-action-log";
import { fetchGoogleAdsPerformance, fetchGoogleSearchTerms } from "../connectors/google-ads";
import { fetchMetaPerformance } from "../connectors/meta";
import { fetchLeadSignal } from "../connectors/twenty";
import { evaluateRules, type SearchTermRow } from "./rules";
import { draftRationale } from "./rationale";
import { STRATEGY } from "./strategy-config";

/** One platform's fetch failing (e.g. the Google Ads MCP server unreachable) must not abort every
 * other platform's snapshot for this tick — matches fetchLeadSignal's existing internal soft-fail
 * (lib/connectors/twenty.ts), applied here per-source instead of per-connector. */
async function softFail<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    console.error(`ads-agent cycle: ${label} fetch failed, skipping for this tick`, err);
    return fallback;
  }
}

export async function runDecisionCycle(): Promise<{ proposalsCreated: number }> {
  const campaigns = await listCampaigns();
  const byExternalId = new Map(
    campaigns.filter((c) => c.externalId !== null).map((c) => [c.externalId as string, c]),
  );

  const [googlePerformance, metaPerformance, googleSearchTerms, leadSignal] = await Promise.all([
    softFail("google ads performance", fetchGoogleAdsPerformance, []),
    softFail("meta performance", fetchMetaPerformance, []),
    softFail("google ads search terms", fetchGoogleSearchTerms, []),
    fetchLeadSignal(),
  ]);

  for (const row of [...googlePerformance, ...metaPerformance]) {
    const campaign = byExternalId.get(row.externalCampaignId);
    if (!campaign) continue;
    await recordPerformanceSnapshot({
      campaignId: campaign.id,
      spend: row.spend,
      clicks: row.clicks,
      impressions: row.impressions,
      conversions: row.conversions,
      raw: row,
    });
  }

  // Budget-reallocation rules need per-campaign CRM signals; they won't fire until attribution exists.
  await recordCrmSignalSnapshot({ campaignId: null, ...leadSignal });

  const searchTerms: SearchTermRow[] = googleSearchTerms
    .map((row) => {
      const campaign = byExternalId.get(row.externalCampaignId);
      return campaign
        ? { campaignId: campaign.id, searchTerm: row.searchTerm, clicks: row.clicks, conversions: row.conversions }
        : null;
    })
    .filter((row): row is SearchTermRow => row !== null);

  const recentSnapshots = await recentPerformanceSnapshots(3);
  const newProposals = evaluateRules(
    {
      campaigns,
      recentSnapshots,
      recentSignals: [{ ...leadSignal, id: "", campaignId: null, capturedAt: new Date().toISOString() }],
      searchTerms,
    },
    STRATEGY,
  );

  let proposalsCreated = 0;
  for (const proposal of newProposals) {
    const rationale = await draftRationale(proposal);
    await createProposal({ ...proposal, rationale });
    proposalsCreated++;
  }

  if (proposalsCreated > 0) {
    await logAiAction({
      domain: "marketing",
      summary: `Created ${proposalsCreated} proposal${proposalsCreated === 1 ? "" : "s"}`,
    });
  }

  return { proposalsCreated };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ads-agent && npx vitest run lib/decision-engine/cycle.test.ts`
Expected: PASS (all original 7 cases + 3 new ones).

- [ ] **Step 5: Commit**

```bash
git add ads-agent/lib/decision-engine/cycle.ts ads-agent/lib/decision-engine/cycle.test.ts
git commit -m "fix(ads-agent): make cycle.ts soft-fail per-platform, not per-tick"
```

---

### Task 8: Final integration verification (sequential — not a subagent)

Do this yourself after Waves 1–3 complete; it is the "integration" step from `superpowers:dispatching-parallel-agents` and must not be parallelized.

- [ ] **Step 1: Confirm no accidental overlap across tasks**

Run: `cd ads-agent && git status --porcelain`
Expected: only the files listed across Tasks 1–7 and Task 9 are modified/created — no unexpected files.

- [ ] **Step 2: Full test suite**

Run: `cd ads-agent && npm test`
Expected: all tests pass, including `execute.ts`'s untouched suite (confirms zero call-site breakage from Task 5's rewrite), `cycle.test.ts`'s suite (now with Task 9's 3 new per-platform soft-fail cases — satisfies success criterion 6, "verified by test"), and the 3 skipped live-smoke tests from Task 7.

- [ ] **Step 3: Build and lint**

Run: `cd ads-agent && npm run build && npm run lint`
Expected: both succeed with zero new warnings (matches the design spec's success criteria).

- [ ] **Step 4: Confirm the MCP server boots and exposes 7 tools**

Run (with placeholder or real test-account env vars set, since `tools.ts`'s handlers only throw when actually called, not at registration time): `cd ads-agent && npm run mcp:google-ads &` then in another shell, verify with the same `Client` + `StreamableHTTPClientTransport` pattern from `google-ads-mcp-client.ts` (or reuse Task 7's live-smoke test with `GOOGLE_ADS_MCP_LIVE_SMOKE=1` if credentials exist) that `listTools()` returns 7 tools. Stop the server afterward.

- [ ] **Step 5: Mark the design spec's success criteria**

Open `docs/superpowers/specs/2026-08-07-google-ads-mcp-integration-design.md` and check off every completed box in its "Success criteria" section that Steps 1–4 above (plus Task 9) verified. `env-status.ts reports googleAds: true` needs no code change — `lib/env-status.ts`'s `isSet(...)` checks for the 5 credential env vars already existed before this plan and are unaffected by it; check that box off once a human confirms it in the manual rollout runbook. Leave unchecked only the boxes that require real test-account credentials and a live cron cycle against them (the manual rollout runbook in the spec, and Task 7 Step 4).

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-08-07-google-ads-mcp-integration-design.md
git commit -m "docs(ads-agent): check off automated Google Ads MCP success criteria"
```
