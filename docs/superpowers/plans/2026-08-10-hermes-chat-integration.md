# Hermes Chat Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an explicit "Ask Hermes" mode to all four of `ads-agent`'s admin chat surfaces (Copilot, CRM Assistant, Reports, Campaign draft), backed by a new read-only MCP server for CRM/analytics data, a Hermes streaming client that reuses the existing credit-ledger metering path unmodified, and a single shared `/api/hermes/chat` route.

**Architecture:** Two new backend pieces (a read-only MCP server wrapping existing tool functions, and a Hermes-compatible streaming client that plugs into the existing metering pipeline) feed one new shared route, which four small, mechanically-identical UI changes call into via a shared toggle component. See `docs/superpowers/specs/2026-08-10-hermes-chat-integration-design.md` for the full architecture diagram and rationale — read that first.

**Tech Stack:** Next.js (App Router) route handlers, TypeScript, Vitest, `@modelcontextprotocol/{server,node,client}`, Zod, React (function components, no new UI dependency).

**Related:** [`docs/superpowers/specs/2026-08-10-hermes-chat-integration-design.md`](../specs/2026-08-10-hermes-chat-integration-design.md) (approved design spec). Depends on Hermes already running locally per [`docs/superpowers/plans/2026-08-10-hermes-agent-container-install.md`](2026-08-10-hermes-agent-container-install.md) (completed).

## Global Constraints

- **Security-critical, non-negotiable:** the Hermes instance reachable from the app must never expose `terminal`, `file`, `browser`, or `computer_use` tools — only MCP tools (Google Ads read/`propose_change` + the new CRM/analytics reads below). Do not change Hermes' tool profile beyond adding the new MCP server entry.
- **No mutation tools reach Hermes.** The new MCP server exposes exactly 6 read-only tools; `advance_opportunity_stage` is never added to it or to Hermes' `tools.include` allowlist.
- **Reuse, don't duplicate, business logic.** The new MCP server wraps the *existing* `crmToolProvider`/`analyticsToolProvider` functions from `lib/openui/crm-tools.ts`/`lib/openui/analytics-tools.ts` verbatim — no new query/business logic anywhere in this plan.
- **Zero changes to metering/ledger/pricing code** (`lib/metering/{pricing,ledger,metered-client}.ts`) and **zero changes to the four existing decision-engine files'** (`copilot-chat.ts`, `crm-chat.ts`, `reports-chat.ts`, `campaign-chat.ts`) default behavior. The Hermes streaming client must implement the existing `StreamChatCompletionFn` interface exactly so it drops into `callMeteredStreamingChatCompletion()` unmodified.
- **Env vars, never hardcoded hosts:** `HERMES_API_SERVER_URL` (default `http://127.0.0.1:8642`), `HERMES_API_SERVER_KEY`, `HERMES_API_SERVER_MODEL` (default `hermes-agent`), `APP_DATA_MCP_ALLOWED_HOSTS`, `APP_DATA_MCP_BIND`. This is what keeps the design portable to the GCP VM later with no code changes.
- **Prefer Torbit MCP over `grep`.** `GentleSpace_Web` is already indexed (`user-torbit` MCP server, `project_id = 1672773718350201492`, branch `main`) — query it with `run_sql`/`get_graph_schema` instead of grepping when a subagent needs to locate files or understand relationships. No re-indexing needed; it was indexed and used earlier this session.
- Run tests with `cd ads-agent && npx vitest run <path>` for a single file, or `npm test` (= `vitest run`) for the whole suite, from `/Users/swami/Documents/GentleSpace_Web/ads-agent`.

---

## Parallel Execution Waves

10 tasks total. Peak parallel width is 5 (Wave 2) — within the 8-subagent cap. Width is capped by genuine import dependencies, not by task-splitting choices: Wave 2's five tasks each import a symbol Wave 1 produces (the route imports Task 2's `draftHermesReply`; the four panel-wiring tasks import Task 3's `HermesModeToggle`/`streamHermesChat`), so none of them can compile until their Wave 1 dependency exists on disk. Forcing more parallelism would mean dispatching a subagent to write code against an import that doesn't exist yet.

| Wave | Tasks | Depends on | Executor |
|---|---|---|---|
| 1 | Task 1 (`app-data-mcp-server` + compose), Task 2 (Hermes streaming client + decision-engine module), Task 3 (`HermesModeToggle` + browser SSE client) | — (nothing, start immediately) | 3 parallel subagents |
| 2 | Task 4 (`/api/hermes/chat` route), Task 5 (wire `CopilotPanel`), Task 6 (wire `CrmAssistantPanel`), Task 7 (wire `ReportsChat`), Task 8 (wire `CampaignDraftChat`) | Task 4 needs Task 2; Tasks 5–8 need Task 3 | 5 parallel subagents |
| 3 | Task 9 (Hermes-side config: second MCP entry, enable API server, generate key) | Task 1 running + Task 2/4's env var names | Orchestrator (you), not a subagent |
| 4 | Task 10 (end-to-end verification, spec checkoff) | Task 9 | Orchestrator (you), not a subagent |

Recommended skill per subagent (announce `Using engineering-skills2 → <skill>` for each):

| Task | Deliverable | Recommended skill(s) |
|---|---|---|
| 1 | `app-data-mcp-server` + compose | `engineering-skills2 → senior-backend` (Node/TS MCP service, mirrors an existing backend service) |
| 2 | Hermes streaming client + decision-engine module | `engineering-skills2 → senior-backend` (streaming HTTP client + business logic, same shape as the existing Bifrost client) |
| 3 | `HermesModeToggle` + browser SSE client | `engineering-skills2 → senior-frontend` (React component + hook) |
| 4 | `/api/hermes/chat` route | `engineering-skills2 → senior-backend` (Next.js API route) |
| 5–8 | Wire toggle into each panel | `engineering-skills2 → senior-frontend` (React component wiring, 4 independent subagents) |

---

### Task 1: New read-only `app-data-mcp-server` (CRM + analytics reads)

**Files:**
- Create: `ads-agent/mcp/app-data-mcp-server/index.ts`
- Create: `ads-agent/mcp/app-data-mcp-server/index.test.ts`
- Create: `ads-agent/scripts/run-app-data-mcp.ts`
- Modify: `ads-agent/docker-compose.yml` (new `app-data-mcp` service)
- Modify: `ads-agent/package.json` (new `mcp:app-data` script)
- Modify: `ads-agent/.env.example` (document new env vars, append at end of file)

**Interfaces:**
- Consumes: `crmToolProvider` from `ads-agent/lib/openui/crm-tools.ts` (`list_opportunities`, `search_opportunities`, `get_opportunity` — all `(args: Record<string, unknown>) => Promise<unknown>`), `analyticsToolProvider` from `ads-agent/lib/openui/analytics-tools.ts` (`get_spend_cpl_trend`, `list_campaigns_with_cpl`, `list_pending_proposals`, same shape).
- Produces: `buildAppDataMcpServer(): McpServer`, `startAppDataMcpServer(port = 8767): Promise<void>`, `resolveAppDataMcpAllowedHosts(): string[]`, `resolveAppDataMcpBind(): string` — a running MCP server at `http://localhost:8767/mcp` that Task 9 points a second Hermes `mcp_servers` entry at.
- No dependency on any other task.

- [ ] **Step 1: Write the failing test**

Create `ads-agent/mcp/app-data-mcp-server/index.test.ts`:

```typescript
import { beforeEach, describe, expect, it } from "vitest";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";

const crmMock = vi.hoisted(() => ({
  crmToolProvider: {
    list_opportunities: vi.fn(),
    search_opportunities: vi.fn(),
    get_opportunity: vi.fn(),
  },
}));
const analyticsMock = vi.hoisted(() => ({
  analyticsToolProvider: {
    get_spend_cpl_trend: vi.fn(),
    list_campaigns_with_cpl: vi.fn(),
    list_pending_proposals: vi.fn(),
  },
}));
vi.mock("../../lib/openui/crm-tools", () => crmMock);
vi.mock("../../lib/openui/analytics-tools", () => analyticsMock);

import { vi } from "vitest";
import { buildAppDataMcpServer } from "./index";

beforeEach(() => {
  vi.clearAllMocks();
});

async function connectedClient() {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = buildAppDataMcpServer();
  const client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

const TOOL_NAMES = [
  "list_opportunities",
  "search_opportunities",
  "get_opportunity",
  "get_spend_cpl_trend",
  "list_campaigns_with_cpl",
  "list_pending_proposals",
];

describe("buildAppDataMcpServer", () => {
  it("registers exactly 6 read-only tools — no advance_opportunity_stage", async () => {
    const client = await connectedClient();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([...TOOL_NAMES].sort());
    expect(tools.map((t) => t.name)).not.toContain("advance_opportunity_stage");
    await client.close();
  });

  it("list_opportunities delegates to crmToolProvider.list_opportunities", async () => {
    crmMock.crmToolProvider.list_opportunities.mockResolvedValue({ opportunities: [{ name: "Acme" }] });
    const client = await connectedClient();
    const result = await client.callTool({ name: "list_opportunities", arguments: {} });
    const text = (result.content as { type: string; text: string }[])[0].text;
    expect(JSON.parse(text)).toEqual({ opportunities: [{ name: "Acme" }] });
    expect(crmMock.crmToolProvider.list_opportunities).toHaveBeenCalledWith({});
    await client.close();
  });

  it("search_opportunities delegates with the query argument", async () => {
    crmMock.crmToolProvider.search_opportunities.mockResolvedValue({ opportunities: [] });
    const client = await connectedClient();
    await client.callTool({ name: "search_opportunities", arguments: { query: "Priya" } });
    expect(crmMock.crmToolProvider.search_opportunities).toHaveBeenCalledWith({ query: "Priya" });
    await client.close();
  });

  it("get_opportunity delegates with the id argument", async () => {
    crmMock.crmToolProvider.get_opportunity.mockResolvedValue(null);
    const client = await connectedClient();
    await client.callTool({ name: "get_opportunity", arguments: { id: "opp-1" } });
    expect(crmMock.crmToolProvider.get_opportunity).toHaveBeenCalledWith({ id: "opp-1" });
    await client.close();
  });

  it("get_spend_cpl_trend delegates with the days argument, defaulting to {}", async () => {
    analyticsMock.analyticsToolProvider.get_spend_cpl_trend.mockResolvedValue([]);
    const client = await connectedClient();
    await client.callTool({ name: "get_spend_cpl_trend", arguments: { days: 14 } });
    expect(analyticsMock.analyticsToolProvider.get_spend_cpl_trend).toHaveBeenCalledWith({ days: 14 });
    await client.close();
  });

  it("list_campaigns_with_cpl delegates to analyticsToolProvider.list_campaigns_with_cpl", async () => {
    analyticsMock.analyticsToolProvider.list_campaigns_with_cpl.mockResolvedValue([]);
    const client = await connectedClient();
    await client.callTool({ name: "list_campaigns_with_cpl", arguments: {} });
    expect(analyticsMock.analyticsToolProvider.list_campaigns_with_cpl).toHaveBeenCalledWith({});
    await client.close();
  });

  it("list_pending_proposals delegates to analyticsToolProvider.list_pending_proposals", async () => {
    analyticsMock.analyticsToolProvider.list_pending_proposals.mockResolvedValue([]);
    const client = await connectedClient();
    await client.callTool({ name: "list_pending_proposals", arguments: {} });
    expect(analyticsMock.analyticsToolProvider.list_pending_proposals).toHaveBeenCalledWith({});
    await client.close();
  });
});

describe("resolveAppDataMcpAllowedHosts", () => {
  const originalEnv = process.env.APP_DATA_MCP_ALLOWED_HOSTS;

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.APP_DATA_MCP_ALLOWED_HOSTS;
    else process.env.APP_DATA_MCP_ALLOWED_HOSTS = originalEnv;
  });

  it("defaults to localhost and 127.0.0.1 when unset", async () => {
    delete process.env.APP_DATA_MCP_ALLOWED_HOSTS;
    const { resolveAppDataMcpAllowedHosts } = await import("./index");
    expect(resolveAppDataMcpAllowedHosts()).toEqual(["localhost", "127.0.0.1"]);
  });
});

describe("resolveAppDataMcpBind", () => {
  const originalEnv = process.env.APP_DATA_MCP_BIND;

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.APP_DATA_MCP_BIND;
    else process.env.APP_DATA_MCP_BIND = originalEnv;
  });

  it("defaults to localhost when unset", async () => {
    delete process.env.APP_DATA_MCP_BIND;
    const { resolveAppDataMcpBind } = await import("./index");
    expect(resolveAppDataMcpBind()).toBe("localhost");
  });
});
```

Add `import { afterEach } from "vitest"` to the existing `vitest` import at the top (`beforeEach, describe, expect, it, vi, afterEach`).

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd ads-agent && npx vitest run mcp/app-data-mcp-server/index.test.ts`
Expected: FAIL — `Cannot find module './index'` (the file doesn't exist yet).

- [ ] **Step 3: Write the minimal implementation**

Create `ads-agent/mcp/app-data-mcp-server/index.ts`:

```typescript
import { createServer } from "node:http";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { hostHeaderValidation, localhostOriginValidation, toNodeHandler } from "@modelcontextprotocol/node";
import { z } from "zod";
import { crmToolProvider } from "../../lib/openui/crm-tools";
import { analyticsToolProvider } from "../../lib/openui/analytics-tools";

/** Host-header allowlist for the DNS-rebinding guard, driven by APP_DATA_MCP_ALLOWED_HOSTS
 * (comma-separated). Defaults to localhost-only for the tsx-on-host workflow; docker-compose.yml
 * sets it to include the Compose service name ("app-data-mcp") so other containers can reach it. */
export function resolveAppDataMcpAllowedHosts(): string[] {
  const raw = process.env.APP_DATA_MCP_ALLOWED_HOSTS;
  if (!raw) return ["localhost", "127.0.0.1"];
  return raw
    .split(",")
    .map((host) => host.trim())
    .filter((host) => host.length > 0);
}

/** Listen address for the HTTP server. Defaults to localhost (tsx-on-host); Compose sets
 * APP_DATA_MCP_BIND=0.0.0.0 so Docker port publish / Compose DNS can reach the process. */
export function resolveAppDataMcpBind(): string {
  const raw = process.env.APP_DATA_MCP_BIND?.trim();
  return raw && raw.length > 0 ? raw : "localhost";
}

/** Builds (but does not connect/serve) the read-only CRM + analytics MCP server — 6 read tools,
 * zero write tools. Wraps the existing crmToolProvider/analyticsToolProvider verbatim; no new
 * business logic. advance_opportunity_stage (the one CRM mutation) is intentionally not exposed —
 * propose_change on the Google Ads MCP server remains the only write path Hermes can reach. */
export function buildAppDataMcpServer(): McpServer {
  const server = new McpServer({ name: "app-data-mcp", version: "1.0.0" });

  server.registerTool(
    "list_opportunities",
    { description: "List every open CRM opportunity/lead. Returns {opportunities: OpportunityCardRow[]}." },
    async () => ({ content: [{ type: "text", text: JSON.stringify(await crmToolProvider.list_opportunities({})) }] }),
  );

  server.registerTool(
    "search_opportunities",
    {
      description: "Search CRM opportunities by case-insensitive name substring. Same {opportunities: [...]} envelope.",
      inputSchema: z.object({ query: z.string() }),
    },
    async (input) => ({
      content: [{ type: "text", text: JSON.stringify(await crmToolProvider.search_opportunities({ query: input.query })) }],
    }),
  );

  server.registerTool(
    "get_opportunity",
    {
      description: "Get one CRM opportunity by id as an OpportunityCard row, or null.",
      inputSchema: z.object({ id: z.string() }),
    },
    async (input) => ({
      content: [{ type: "text", text: JSON.stringify(await crmToolProvider.get_opportunity({ id: input.id })) }],
    }),
  );

  server.registerTool(
    "get_spend_cpl_trend",
    {
      description: "Get the daily spend/CPL trend for the last N days (default 7).",
      inputSchema: z.object({ days: z.number().optional() }),
    },
    async (input) => ({
      content: [{ type: "text", text: JSON.stringify(await analyticsToolProvider.get_spend_cpl_trend({ days: input.days })) }],
    }),
  );

  server.registerTool(
    "list_campaigns_with_cpl",
    { description: "List every campaign with its platform, status, daily budget, corridor, and latest CPL." },
    async () => ({ content: [{ type: "text", text: JSON.stringify(await analyticsToolProvider.list_campaigns_with_cpl({})) }] }),
  );

  server.registerTool(
    "list_pending_proposals",
    { description: "List every proposal currently awaiting human approval." },
    async () => ({ content: [{ type: "text", text: JSON.stringify(await analyticsToolProvider.list_pending_proposals({})) }] }),
  );

  return server;
}

/**
 * Starts the app-data MCP server over Streamable HTTP, mirroring google-ads-server/index.ts's
 * pattern exactly (createMcpHandler + host/origin validation guards).
 */
export async function startAppDataMcpServer(port = 8767): Promise<void> {
  const handler = createMcpHandler(() => buildAppDataMcpServer());
  const nodeHandler = toNodeHandler(handler);
  const validateHost = hostHeaderValidation(resolveAppDataMcpAllowedHosts());
  const validateOrigin = localhostOriginValidation();
  const bind = resolveAppDataMcpBind();

  createServer((req, res) => {
    if (!validateHost(req, res) || !validateOrigin(req, res)) return;
    if (req.url !== "/mcp" && !req.url?.startsWith("/mcp?")) {
      res.writeHead(404).end();
      return;
    }
    void nodeHandler(req, res);
  }).listen(port, bind, () => {
    console.log(`app-data-mcp listening on http://${bind}:${port}/mcp`);
  });
}
```

Create `ads-agent/scripts/run-app-data-mcp.ts`:

```typescript
/**
 * Standalone app-data MCP server — `npm run mcp:app-data`. Binds to localhost only; see
 * docs/superpowers/specs/2026-08-10-hermes-chat-integration-design.md.
 */
import { startAppDataMcpServer } from "../mcp/app-data-mcp-server/index";

startAppDataMcpServer().catch((err) => {
  console.error("app-data-mcp: failed to start", err);
  process.exit(1);
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd ads-agent && npx vitest run mcp/app-data-mcp-server/index.test.ts`
Expected: PASS, all 9 tests green.

- [ ] **Step 5: Wire the new service into Compose, npm scripts, and `.env.example`**

In `ads-agent/package.json`, add a script next to `"mcp:google-ads"` (same file, `"scripts"` block):

```json
    "mcp:app-data": "tsx --env-file=.env.local scripts/run-app-data-mcp.ts",
```

In `ads-agent/docker-compose.yml`, add a new service after `google-ads-mcp` (before the `volumes:` block):

```yaml
  app-data-mcp:
    build: .
    command: ["npx", "tsx", "scripts/run-app-data-mcp.ts"]
    depends_on:
      db:
        condition: service_healthy
    env_file:
      - .env.local
    environment:
      DATABASE_URL: postgres://ads_agent:ads_agent_local_dev@db:5432/ads_agent
      APP_DATA_MCP_ALLOWED_HOSTS: localhost,127.0.0.1,app-data-mcp
      APP_DATA_MCP_BIND: "0.0.0.0"
    ports:
      - "8767:8767"
    restart: unless-stopped
```

Append to the end of `ads-agent/.env.example`:

```
# In-repo app-data MCP server (npm run mcp:app-data) — read-only CRM + analytics tools for Hermes.
APP_DATA_MCP_URL=http://localhost:8767/mcp
APP_DATA_MCP_ALLOWED_HOSTS=localhost,127.0.0.1
APP_DATA_MCP_BIND=localhost
```

- [ ] **Step 6: Verify the server starts under Compose**

Run:
```bash
cd ads-agent
docker compose up -d db
docker compose up -d --build app-data-mcp
docker compose logs app-data-mcp --tail 20
nc -z -G 2 localhost 8767 && echo "REACHABLE" || echo "UNREACHABLE"
```
Expected: logs show `app-data-mcp listening on http://0.0.0.0:8767/mcp` with no crash; `REACHABLE` printed.

- [ ] **Step 7: Commit**

```bash
cd /Users/swami/Documents/GentleSpace_Web
git add ads-agent/mcp/app-data-mcp-server ads-agent/scripts/run-app-data-mcp.ts ads-agent/docker-compose.yml ads-agent/package.json ads-agent/.env.example
git commit -m "feat(ads-agent): add read-only app-data MCP server for CRM + analytics reads"
```

**Return to the orchestrator:** test output from Step 4, and the reachability result from Step 6.

---

### Task 2: Hermes streaming client + decision-engine module

**Files:**
- Create: `ads-agent/lib/hermes/server-client.ts`
- Create: `ads-agent/lib/hermes/server-client.test.ts`
- Create: `ads-agent/lib/decision-engine/hermes-chat.ts`
- Create: `ads-agent/lib/decision-engine/hermes-chat.test.ts`
- Modify: `ads-agent/.env.example` (append `HERMES_API_SERVER_*` vars)

**Interfaces:**
- Consumes: `StreamChatCompletionFn`/`StreamChunk`/`StreamChatCompletionOptions` from `lib/openui/streaming-types.ts`; `ChatMessage` from `lib/bifrost/client.ts`; `callMeteredStreamingChatCompletion` from `lib/metering/metered-stream-client.ts`; `MeteringContext`/`InsufficientCreditsError` from `lib/metering/types.ts`; `getSession` from `lib/auth/dal.ts`; `DEFAULT_ORG_ID`/`DEFAULT_USER_ID` from `lib/metering/dev-context.ts`.
- Produces: `streamHermesCompletion: StreamChatCompletionFn` and `isHermesConfigured(): boolean` (from `lib/hermes/server-client.ts`); `draftHermesReply(input: { history: HermesChatMessage[]; userMessage: string; origin: HermesChatOrigin }): AsyncGenerator<HermesChatTurnEvent, void, unknown>`, plus the exported types `HermesChatMessage`, `HermesChatOrigin`, `HermesChatTurnEvent` (from `lib/decision-engine/hermes-chat.ts`) — Task 4's route imports `draftHermesReply` and the three types directly.
- No dependency on any other task.

- [ ] **Step 1: Write the failing test for the streaming client**

Create `ads-agent/lib/hermes/server-client.test.ts`:

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StreamChunk } from "../openui/streaming-types";

function sseResponse(events: string[]): Response {
  const body = events.join("");
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const bytes = new TextEncoder().encode(body);
      const mid = Math.floor(bytes.length / 2);
      controller.enqueue(bytes.slice(0, mid));
      controller.enqueue(bytes.slice(mid));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

describe("streamHermesCompletion", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.HERMES_API_SERVER_URL = "http://127.0.0.1:8642";
    process.env.HERMES_API_SERVER_KEY = "test-key";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  it("yields delta chunks then a usage chunk, stopping at [DONE]", async () => {
    const events = [
      `data: {"choices":[{"delta":{"content":"Hi"}}],"model":"google/gemini-2.5-pro"}\n\n`,
      `data: {"choices":[{"delta":{"content":" there."},"finish_reason":"stop"}],"model":"google/gemini-2.5-pro","usage":{"prompt_tokens":10,"completion_tokens":4,"total_tokens":14}}\n\n`,
      `data: [DONE]\n\n`,
    ];
    const fetchMock = vi.fn().mockResolvedValue(sseResponse(events));
    vi.stubGlobal("fetch", fetchMock);

    const { streamHermesCompletion } = await import("./server-client");
    const chunks: StreamChunk[] = [];
    for await (const chunk of streamHermesCompletion({ messages: [{ role: "user", content: "hi" }] })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      { type: "delta", content: "Hi" },
      { type: "delta", content: " there." },
      { type: "usage", model: "google/gemini-2.5-pro", usage: { promptTokens: 10, completionTokens: 4, totalTokens: 14 } },
    ]);
    const [, requestInit] = fetchMock.mock.calls[0];
    expect(requestInit.headers.Authorization).toBe("Bearer test-key");
  });

  it("synthesizes a zero-cost usage chunk if the stream ends without one", async () => {
    const events = [
      `data: {"choices":[{"delta":{"content":"ok"}}],"model":"google/gemini-2.5-pro"}\n\n`,
      `data: [DONE]\n\n`,
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse(events)));

    const { streamHermesCompletion } = await import("./server-client");
    const chunks: StreamChunk[] = [];
    for await (const chunk of streamHermesCompletion({ messages: [{ role: "user", content: "hi" }] })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      { type: "delta", content: "ok" },
      { type: "usage", model: "google/gemini-2.5-pro", usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } },
    ]);
  });

  it("throws when HERMES_API_SERVER_URL is not set", async () => {
    delete process.env.HERMES_API_SERVER_URL;
    const { streamHermesCompletion } = await import("./server-client");
    await expect(async () => {
      for await (const chunk of streamHermesCompletion({ messages: [] })) void chunk;
    }).rejects.toThrow("HERMES_API_SERVER_URL is not set");
  });

  it("throws when HERMES_API_SERVER_KEY is not set", async () => {
    delete process.env.HERMES_API_SERVER_KEY;
    const { streamHermesCompletion } = await import("./server-client");
    await expect(async () => {
      for await (const chunk of streamHermesCompletion({ messages: [] })) void chunk;
    }).rejects.toThrow("HERMES_API_SERVER_KEY is not set");
  });
});

describe("isHermesConfigured", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("is false when either env var is missing", async () => {
    delete process.env.HERMES_API_SERVER_URL;
    process.env.HERMES_API_SERVER_KEY = "k";
    const { isHermesConfigured } = await import("./server-client");
    expect(isHermesConfigured()).toBe(false);
  });

  it("is true when both env vars are set", async () => {
    process.env.HERMES_API_SERVER_URL = "http://127.0.0.1:8642";
    process.env.HERMES_API_SERVER_KEY = "k";
    const { isHermesConfigured } = await import("./server-client");
    expect(isHermesConfigured()).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd ads-agent && npx vitest run lib/hermes/server-client.test.ts`
Expected: FAIL — `Cannot find module './server-client'`.

- [ ] **Step 3: Write the minimal implementation**

Create `ads-agent/lib/hermes/server-client.ts`:

```typescript
import type { StreamChatCompletionOptions, StreamChunk } from "../openui/streaming-types";

function hermesBaseUrl(): string {
  return (process.env.HERMES_API_SERVER_URL || "").replace(/\/$/, "");
}

function hermesModel(): string {
  return process.env.HERMES_API_SERVER_MODEL || "hermes-agent";
}

/** True when the app has both a Hermes API server URL and bearer key to call. */
export function isHermesConfigured(): boolean {
  return Boolean(process.env.HERMES_API_SERVER_URL?.trim() && process.env.HERMES_API_SERVER_KEY?.trim());
}

type HermesStreamChunkJson = {
  model?: string;
  choices?: { delta?: { content?: string | null }; finish_reason?: string | null }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null;
};

/**
 * Streams from Hermes' OpenAI-compatible API server (/v1/chat/completions). Implements the same
 * StreamChatCompletionFn interface as streamChatCompletion (Bifrost) so it drops straight into
 * callMeteredStreamingChatCompletion() with no metering/ledger changes.
 */
export async function* streamHermesCompletion(
  options: StreamChatCompletionOptions,
): AsyncGenerator<StreamChunk, void, unknown> {
  const url = hermesBaseUrl();
  if (!url) throw new Error("HERMES_API_SERVER_URL is not set");
  const key = process.env.HERMES_API_SERVER_KEY;
  if (!key) throw new Error("HERMES_API_SERVER_KEY is not set");

  const res = await fetch(`${url}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: hermesModel(),
      messages: options.messages,
      temperature: options.temperature ?? 0.3,
      max_tokens: options.maxTokens ?? 2048,
      stream: true,
      stream_options: { include_usage: true },
    }),
    signal: options.timeoutMs ? AbortSignal.timeout(options.timeoutMs) : undefined,
  });

  if (!res.ok || !res.body) {
    throw new Error(`hermes streamHermesCompletion failed: ${res.status} ${await res.text()}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let sawUsage = false;
  let lastModel = hermesModel();

  function synthesizedUsageChunk(): StreamChunk {
    // ponytail: Hermes' API-server usage-on-stream behavior wasn't verifiable from docs alone —
    // synthesize a zero-cost usage chunk so callMeteredStreamingChatCompletion still records a
    // ledger row (at $0) instead of throwing after the reply already rendered to the user.
    // Ceiling: a real Hermes turn would be under-billed if this fires in production. Upgrade
    // path: once the end-to-end task confirms real usage arrives, delete this fallback.
    return { type: "usage", model: lastModel, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } };
  }

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf("\n\n")) !== -1) {
        const rawEvent = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 2);
        if (!rawEvent.startsWith("data:")) continue;

        const payload = rawEvent.slice("data:".length).trim();
        if (payload === "[DONE]") {
          if (!sawUsage) yield synthesizedUsageChunk();
          return;
        }

        let parsed: HermesStreamChunkJson;
        try {
          parsed = JSON.parse(payload);
        } catch {
          continue;
        }
        if (parsed.model) lastModel = parsed.model;

        const content = parsed.choices?.[0]?.delta?.content;
        if (typeof content === "string" && content.length > 0) {
          yield { type: "delta", content };
        }
        if (parsed.usage) {
          sawUsage = true;
          yield {
            type: "usage",
            model: parsed.model || lastModel,
            usage: {
              promptTokens: parsed.usage.prompt_tokens ?? 0,
              completionTokens: parsed.usage.completion_tokens ?? 0,
              totalTokens: parsed.usage.total_tokens ?? 0,
            },
          };
        }
      }
    }
    if (!sawUsage) yield synthesizedUsageChunk();
  } finally {
    reader.releaseLock();
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd ads-agent && npx vitest run lib/hermes/server-client.test.ts`
Expected: PASS, all 6 tests green.

- [ ] **Step 5: Write the failing test for the decision-engine module**

Create `ads-agent/lib/decision-engine/hermes-chat.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";

const { isHermesConfigured, callMeteredStreamingChatCompletion, getSession } = vi.hoisted(() => ({
  isHermesConfigured: vi.fn(),
  callMeteredStreamingChatCompletion: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock("../hermes/server-client", () => ({ isHermesConfigured, streamHermesCompletion: vi.fn() }));
vi.mock("../metering/metered-stream-client", () => ({ callMeteredStreamingChatCompletion }));
vi.mock("../auth/dal", () => ({ getSession }));

import { draftHermesReply } from "./hermes-chat";
import { InsufficientCreditsError } from "../metering/types";

beforeEach(() => {
  vi.clearAllMocks();
});

async function drain(gen: AsyncGenerator<{ type: "delta"; content: string } | { type: "done"; reply: string }>) {
  const events = [];
  for await (const event of gen) events.push(event);
  return events;
}

function fakeStream(...chunks: string[]) {
  return (async function* () {
    for (const chunk of chunks) yield { type: "delta" as const, content: chunk };
  })();
}

describe("draftHermesReply", () => {
  it("returns a fixed message when Hermes is not configured", async () => {
    isHermesConfigured.mockReturnValue(false);
    const events = await drain(draftHermesReply({ history: [], userMessage: "hi", origin: "copilot" }));
    expect(events).toEqual([{ type: "done", reply: expect.stringContaining("Hermes isn't configured") }]);
  });

  it("streams deltas then yields the final plain-text reply", async () => {
    isHermesConfigured.mockReturnValue(true);
    getSession.mockResolvedValue(null);
    callMeteredStreamingChatCompletion.mockReturnValueOnce(fakeStream("Spend is up ", "12% week over week."));
    const events = await drain(draftHermesReply({ history: [], userMessage: "how's spend trending?", origin: "reports" }));
    expect(events[0]).toEqual({ type: "delta", content: "Spend is up " });
    expect(events[events.length - 1]).toEqual({ type: "done", reply: "Spend is up 12% week over week." });
  });

  it("tags the metering feature with the given origin", async () => {
    isHermesConfigured.mockReturnValue(true);
    getSession.mockResolvedValue({ orgId: "org-1", userId: "user-1" });
    callMeteredStreamingChatCompletion.mockReturnValueOnce(fakeStream("ok"));
    await drain(draftHermesReply({ history: [], userMessage: "hi", origin: "crm" }));
    const [ctx] = callMeteredStreamingChatCompletion.mock.calls[0];
    expect(ctx).toEqual({ orgId: "org-1", userId: "user-1", feature: "ads-agent:hermes-chat:crm" });
  });

  it("returns the credits-exhausted message when the model throws InsufficientCreditsError", async () => {
    isHermesConfigured.mockReturnValue(true);
    getSession.mockResolvedValue(null);
    callMeteredStreamingChatCompletion.mockImplementationOnce(() => {
      throw new InsufficientCreditsError();
    });
    const events = await drain(draftHermesReply({ history: [], userMessage: "hi", origin: "campaign" }));
    expect(events).toEqual([{ type: "done", reply: expect.stringContaining("run out of AI credits") }]);
  });

  it("returns a generic unavailable message on a non-credits error", async () => {
    isHermesConfigured.mockReturnValue(true);
    getSession.mockResolvedValue(null);
    callMeteredStreamingChatCompletion.mockImplementationOnce(() => {
      throw new Error("upstream timeout");
    });
    const events = await drain(draftHermesReply({ history: [], userMessage: "hi", origin: "copilot" }));
    expect(events).toEqual([{ type: "done", reply: expect.stringContaining("unavailable") }]);
  });

  it("returns a fallback message for an empty model response", async () => {
    isHermesConfigured.mockReturnValue(true);
    getSession.mockResolvedValue(null);
    callMeteredStreamingChatCompletion.mockReturnValueOnce(fakeStream(""));
    const events = await drain(draftHermesReply({ history: [], userMessage: "hi", origin: "copilot" }));
    expect(events[events.length - 1]).toEqual({ type: "done", reply: "I didn't get a response — try asking again." });
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `cd ads-agent && npx vitest run lib/decision-engine/hermes-chat.test.ts`
Expected: FAIL — `Cannot find module './hermes-chat'`.

- [ ] **Step 7: Write the minimal implementation**

Create `ads-agent/lib/decision-engine/hermes-chat.ts`:

```typescript
import { isHermesConfigured, streamHermesCompletion } from "../hermes/server-client";
import type { ChatMessage } from "../bifrost/client";
import { callMeteredStreamingChatCompletion } from "../metering/metered-stream-client";
import { InsufficientCreditsError, type MeteringContext } from "../metering/types";
import { getSession } from "../auth/dal";
import { DEFAULT_ORG_ID, DEFAULT_USER_ID } from "../metering/dev-context";

export type HermesChatMessage = { role: "user" | "assistant"; content: string };
export type HermesChatOrigin = "copilot" | "crm" | "reports" | "campaign";
export type HermesChatTurnEvent = { type: "delta"; content: string } | { type: "done"; reply: string };

const SYSTEM_PREAMBLE =
  "You are Hermes, a self-improving AI agent, answering from inside Gentle Space's ads-agent admin " +
  "dashboard. Reply in plain prose — never emit OpenUI-lang or any other UI-description syntax. Use " +
  "your MCP tools to ground answers about Google Ads performance, CRM opportunities, and campaign " +
  "analytics in real data rather than guessing.";

async function* runHermesModel(
  ctx: MeteringContext,
  messages: ChatMessage[],
): AsyncGenerator<{ type: "delta"; content: string }, string, unknown> {
  let full = "";
  for await (const chunk of callMeteredStreamingChatCompletion(
    ctx,
    { messages, temperature: 0.4, maxTokens: 4096, timeoutMs: 60_000 },
    streamHermesCompletion,
  )) {
    if (chunk.type === "delta") {
      full += chunk.content;
      yield { type: "delta", content: chunk.content };
    }
  }
  return full;
}

export async function* draftHermesReply(input: {
  history: HermesChatMessage[];
  userMessage: string;
  origin: HermesChatOrigin;
}): AsyncGenerator<HermesChatTurnEvent, void, unknown> {
  if (!isHermesConfigured()) {
    yield {
      type: "done",
      reply: "Hermes isn't configured yet (set HERMES_API_SERVER_URL/HERMES_API_SERVER_KEY) — ask an admin to set it.",
    };
    return;
  }

  const session = await getSession();
  const ctx: MeteringContext = {
    orgId: session?.orgId ?? DEFAULT_ORG_ID,
    userId: session?.userId ?? DEFAULT_USER_ID,
    feature: `ads-agent:hermes-chat:${input.origin}`,
  };

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PREAMBLE },
    ...input.history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: input.userMessage },
  ];

  let raw: string;
  try {
    raw = yield* runHermesModel(ctx, messages);
  } catch (err) {
    if (err instanceof InsufficientCreditsError) {
      yield {
        type: "done",
        reply: "This organization has run out of AI credits — ask an admin to allocate more from Usage & Credits.",
      };
      return;
    }
    yield { type: "done", reply: "Hermes is unavailable right now — try again shortly." };
    return;
  }

  const trimmed = raw.trim();
  yield { type: "done", reply: trimmed || "I didn't get a response — try asking again." };
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `cd ads-agent && npx vitest run lib/decision-engine/hermes-chat.test.ts`
Expected: PASS, all 6 tests green.

- [ ] **Step 9: Document the new env vars**

Append to the end of `ads-agent/.env.example` (after the block Task 1 added, if Task 1's subagent already landed — otherwise at the end of the file; both additions are independent appends and won't conflict):

```
# Hermes agent API server (see docs/superpowers/plans/2026-08-10-hermes-agent-container-install.md).
# HERMES_API_SERVER_ENABLED must be set to true in ~/.hermes/.env on the machine running Hermes.
HERMES_API_SERVER_URL=http://127.0.0.1:8642
HERMES_API_SERVER_KEY=
HERMES_API_SERVER_MODEL=hermes-agent
```

- [ ] **Step 10: Commit**

```bash
cd /Users/swami/Documents/GentleSpace_Web
git add ads-agent/lib/hermes ads-agent/lib/decision-engine/hermes-chat.ts ads-agent/lib/decision-engine/hermes-chat.test.ts ads-agent/.env.example
git commit -m "feat(ads-agent): add Hermes streaming client + hermes-chat decision-engine module"
```

**Return to the orchestrator:** test output from Steps 4 and 8.

---

### Task 3: Shared `HermesModeToggle` component + browser SSE client

**Files:**
- Create: `ads-agent/lib/hermes/browser-client.ts`
- Create: `ads-agent/lib/hermes/browser-client.test.ts`
- Create: `ads-agent/components/hermes/HermesModeToggle.tsx`
- Create: `ads-agent/components/hermes/HermesModeToggle.test.tsx`

**Interfaces:**
- Consumes: nothing from other tasks — this is pure new browser-side code; it targets the `/api/hermes/chat` route by its documented path/contract (`{ userMessage, history, origin }` request body; `{delta}` / `{done:true,reply}` / `{done:true,error}` SSE envelope), not an import of Task 4's code.
- Produces: `streamHermesChat(params: { origin: HermesChatOrigin; userMessage: string; history: { role: "user"|"assistant"; content: string }[] }): AsyncGenerator<HermesStreamEvent, void, unknown>` and the `HermesChatOrigin`/`HermesStreamEvent` types (from `lib/hermes/browser-client.ts`); `HermesModeToggle({ active, onToggle }: { active: boolean; onToggle: () => void })` (from `components/hermes/HermesModeToggle.tsx`) — Tasks 5–8 import both.
- No dependency on any other task.

- [ ] **Step 1: Write the failing test for the browser SSE client**

Create `ads-agent/lib/hermes/browser-client.test.ts`:

```typescript
import { afterEach, describe, expect, it, vi } from "vitest";

function sseResponse(events: string[]): Response {
  const body = events.join("");
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

describe("streamHermesChat", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts to /api/hermes/chat with origin, userMessage, and history", async () => {
    const events = [`data: {"done":true,"reply":"hi there"}\n\n`];
    const fetchMock = vi.fn().mockResolvedValue(sseResponse(events));
    vi.stubGlobal("fetch", fetchMock);

    const { streamHermesChat } = await import("./browser-client");
    const chunks = [];
    for await (const chunk of streamHermesChat({ origin: "copilot", userMessage: "hi", history: [] })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([{ done: true, reply: "hi there" }]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/hermes/chat");
    expect(JSON.parse(init.body)).toEqual({ userMessage: "hi", history: [], origin: "copilot" });
  });

  it("yields delta events before the final done event", async () => {
    const events = [
      `data: {"delta":"Sp"}\n\n`,
      `data: {"delta":"end is up."}\n\n`,
      `data: {"done":true,"reply":"Spend is up."}\n\n`,
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sseResponse(events)));

    const { streamHermesChat } = await import("./browser-client");
    const chunks = [];
    for await (const chunk of streamHermesChat({ origin: "reports", userMessage: "hi", history: [] })) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual([{ delta: "Sp" }, { delta: "end is up." }, { done: true, reply: "Spend is up." }]);
  });

  it("yields a done/error event when the response is not ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 500 })));
    const { streamHermesChat } = await import("./browser-client");
    const chunks = [];
    for await (const chunk of streamHermesChat({ origin: "crm", userMessage: "hi", history: [] })) {
      chunks.push(chunk);
    }
    expect(chunks).toEqual([{ done: true, error: "Failed to reach Hermes" }]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd ads-agent && npx vitest run lib/hermes/browser-client.test.ts`
Expected: FAIL — `Cannot find module './browser-client'`.

- [ ] **Step 3: Write the minimal implementation**

Create `ads-agent/lib/hermes/browser-client.ts`:

```typescript
export type HermesChatOrigin = "copilot" | "crm" | "reports" | "campaign";
export type HermesStreamEvent = { delta: string } | { done: true; reply: string } | { done: true; error: string };

/**
 * Browser-side SSE consumer for the shared POST /api/hermes/chat route. Mirrors the exact
 * fetch/SSE-parsing loop already inlined in CopilotPanel/CrmAssistantPanel/ReportsChat/
 * CampaignDraftChat's own sendMessage functions, extracted once so the four panel-wiring tasks
 * (Tasks 5-8) don't each re-implement it.
 */
export async function* streamHermesChat(params: {
  origin: HermesChatOrigin;
  userMessage: string;
  history: { role: "user" | "assistant"; content: string }[];
}): AsyncGenerator<HermesStreamEvent, void, unknown> {
  const res = await fetch("/api/hermes/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userMessage: params.userMessage, history: params.history, origin: params.origin }),
  });

  if (!res.ok || !res.body) {
    yield { done: true, error: "Failed to reach Hermes" };
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf("\n\n")) !== -1) {
      const rawEvent = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 2);
      if (!rawEvent.startsWith("data:")) continue;
      yield JSON.parse(rawEvent.slice("data:".length).trim()) as HermesStreamEvent;
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd ads-agent && npx vitest run lib/hermes/browser-client.test.ts`
Expected: PASS, all 3 tests green.

- [ ] **Step 5: Write the failing test for the toggle component**

Create `ads-agent/components/hermes/HermesModeToggle.test.tsx`:

```typescript
// ads-agent/components/hermes/HermesModeToggle.test.tsx
import { describe, expect, it, vi } from "vitest";
import { HermesModeToggle } from "./HermesModeToggle";

describe("HermesModeToggle", () => {
  it("labels itself 'Ask Hermes' when inactive", () => {
    const el = HermesModeToggle({ active: false, onToggle: () => {} });
    expect(JSON.stringify(el)).toContain("Ask Hermes");
  });

  it("labels itself 'Hermes mode' and is aria-pressed when active", () => {
    const el = HermesModeToggle({ active: true, onToggle: () => {} });
    expect(JSON.stringify(el)).toContain("Hermes mode");
    expect(el.props["aria-pressed"]).toBe(true);
  });

  it("wires onToggle directly as the click handler", () => {
    const onToggle = vi.fn();
    const el = HermesModeToggle({ active: false, onToggle });
    expect(el.props.onClick).toBe(onToggle);
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `cd ads-agent && npx vitest run components/hermes/HermesModeToggle.test.tsx`
Expected: FAIL — `Cannot find module './HermesModeToggle'`.

- [ ] **Step 7: Write the minimal implementation**

Create `ads-agent/components/hermes/HermesModeToggle.tsx`:

```typescript
"use client";

import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Shared "Ask Hermes" toggle dropped into all 4 chat panels — see
 * docs/superpowers/specs/2026-08-10-hermes-chat-integration-design.md. */
export function HermesModeToggle({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  return (
    <Button
      type="button"
      variant={active ? "default" : "outline"}
      size="sm"
      onClick={onToggle}
      aria-pressed={active}
    >
      <Sparkles className="size-3.5" />
      {active ? "Hermes mode" : "Ask Hermes"}
    </Button>
  );
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `cd ads-agent && npx vitest run components/hermes/HermesModeToggle.test.tsx`
Expected: PASS, all 3 tests green.

- [ ] **Step 9: Commit**

```bash
cd /Users/swami/Documents/GentleSpace_Web
git add ads-agent/lib/hermes/browser-client.ts ads-agent/lib/hermes/browser-client.test.ts ads-agent/components/hermes
git commit -m "feat(ads-agent): add HermesModeToggle component and browser Hermes SSE client"
```

**Return to the orchestrator:** test output from Steps 4 and 8.

---

### Task 4: `POST /api/hermes/chat` route

**Files:**
- Create: `ads-agent/app/api/hermes/chat/route.ts`
- Create: `ads-agent/app/api/hermes/chat/route.test.ts`

**Interfaces:**
- Consumes: `requireApiRole` from `@/lib/auth/dal` (same pattern as the other 3 routes); `draftHermesReply`, `HermesChatMessage`, `HermesChatOrigin` from `@/lib/decision-engine/hermes-chat` (Task 2).
- Produces: a running route Tasks 5–8's panels call via `streamHermesChat()` (Task 3), and Task 10's end-to-end check curls directly.
- Depends on Task 2 (imports `draftHermesReply`).

- [ ] **Step 1: Write the failing test**

Create `ads-agent/app/api/hermes/chat/route.test.ts`:

```typescript
import { describe, expect, it, vi } from "vitest";

const { requireApiRole, draftHermesReply } = vi.hoisted(() => ({
  requireApiRole: vi.fn(),
  draftHermesReply: vi.fn(),
}));

vi.mock("@/lib/auth/dal", () => ({ requireApiRole }));
vi.mock("@/lib/decision-engine/hermes-chat", () => ({ draftHermesReply }));

import { POST } from "./route";

function postRequest(body: unknown) {
  return new Request("http://localhost/api/hermes/chat", { method: "POST", body: JSON.stringify(body) });
}

async function readEvents(res: Response) {
  const text = await res.text();
  return text
    .split("\n\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => JSON.parse(line.slice("data:".length).trim()));
}

describe("POST /api/hermes/chat", () => {
  it("returns 401/403 passthrough when requireApiRole rejects", async () => {
    requireApiRole.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });
    const res = await POST(postRequest({ userMessage: "hi", history: [], origin: "copilot" }));
    expect(res.status).toBe(403);
  });

  it("requires operator role", async () => {
    requireApiRole.mockResolvedValue({ ok: true, session: { userId: "u1", orgId: "o1" } });
    draftHermesReply.mockImplementation(async function* () {
      yield { type: "done", reply: "ok" };
    });
    await POST(postRequest({ userMessage: "hi", history: [], origin: "copilot" }));
    expect(requireApiRole).toHaveBeenCalledWith("operator");
  });

  it("returns 400 when userMessage is missing", async () => {
    requireApiRole.mockResolvedValue({ ok: true, session: { userId: "u1", orgId: "o1" } });
    const res = await POST(postRequest({ userMessage: "", history: [], origin: "copilot" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when origin is missing or invalid", async () => {
    requireApiRole.mockResolvedValue({ ok: true, session: { userId: "u1", orgId: "o1" } });
    const res = await POST(postRequest({ userMessage: "hi", history: [], origin: "not-a-real-origin" }));
    expect(res.status).toBe(400);
  });

  it("streams deltas then a done event with the reply, passing origin through", async () => {
    requireApiRole.mockResolvedValue({ ok: true, session: { userId: "u1", orgId: "o1" } });
    draftHermesReply.mockImplementation(async function* () {
      yield { type: "delta", content: "Spend is " };
      yield { type: "delta", content: "up 12%." };
      yield { type: "done", reply: "Spend is up 12%." };
    });
    const res = await POST(postRequest({ userMessage: "how's spend?", history: [], origin: "reports" }));
    const events = await readEvents(res);
    expect(events[0]).toEqual({ delta: "Spend is " });
    expect(events[1]).toEqual({ delta: "up 12%." });
    expect(events[2]).toEqual({ done: true, reply: "Spend is up 12%." });
    expect(draftHermesReply).toHaveBeenCalledWith({ history: [], userMessage: "how's spend?", origin: "reports" });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd ads-agent && npx vitest run app/api/hermes/chat/route.test.ts`
Expected: FAIL — `Cannot find module './route'`.

- [ ] **Step 3: Write the minimal implementation**

Create `ads-agent/app/api/hermes/chat/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth/dal";
import { draftHermesReply, type HermesChatMessage, type HermesChatOrigin } from "@/lib/decision-engine/hermes-chat";

const VALID_ORIGINS: HermesChatOrigin[] = ["copilot", "crm", "reports", "campaign"];

export async function POST(req: Request) {
  const access = await requireApiRole("operator");
  if (!access.ok) return access.response;

  const body = (await req.json()) as { userMessage?: string; history?: HermesChatMessage[]; origin?: string };
  const userMessage = body.userMessage?.trim();
  if (!userMessage) return NextResponse.json({ error: "userMessage is required" }, { status: 400 });

  const origin = body.origin as HermesChatOrigin;
  if (!VALID_ORIGINS.includes(origin)) {
    return NextResponse.json({ error: `origin must be one of: ${VALID_ORIGINS.join(", ")}` }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      function send(event: Record<string, unknown>) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }

      try {
        let reply = "";
        for await (const event of draftHermesReply({ history: body.history ?? [], userMessage, origin })) {
          if (event.type === "delta") send({ delta: event.content });
          else reply = event.reply;
        }
        send({ done: true, reply });
      } catch (err) {
        send({ done: true, error: err instanceof Error ? err.message : "internal error" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd ads-agent && npx vitest run app/api/hermes/chat/route.test.ts`
Expected: PASS, all 5 tests green.

- [ ] **Step 5: Commit**

```bash
cd /Users/swami/Documents/GentleSpace_Web
git add ads-agent/app/api/hermes
git commit -m "feat(ads-agent): add shared POST /api/hermes/chat route"
```

**Return to the orchestrator:** test output from Step 4.

---

### Task 5: Wire "Ask Hermes" into `CopilotPanel`

**Files:**
- Modify: `ads-agent/components/copilot/CopilotPanel.tsx`

**Interfaces:**
- Consumes: `HermesModeToggle` from `@/components/hermes/HermesModeToggle`, `streamHermesChat` from `@/lib/hermes/browser-client` (both Task 3).
- No new exports — this task only changes `CopilotPanel`'s internal behavior.
- Depends on Task 3.

- [ ] **Step 1: Add the Hermes-mode state, toggle, and branch in `sendMessage`**

In `ads-agent/components/copilot/CopilotPanel.tsx`, add imports after the existing `useCopilot` import:

```typescript
import { HermesModeToggle } from "@/components/hermes/HermesModeToggle";
import { streamHermesChat } from "@/lib/hermes/browser-client";
```

Add a new state variable next to the other `useState` calls (after `const [renderError, setRenderError] = useState<string | null>(null);`):

```typescript
  const [hermesMode, setHermesMode] = useState(false);
```

Replace the body of `sendMessage` (the `try { const res = await fetch("/api/copilot/chat", ...` block through its matching `finally`) with a branch that calls `streamHermesChat` when `hermesMode` is on, keeping the existing fetch loop for when it's off:

```typescript
    try {
      if (hermesMode) {
        let accumulated = "";
        for await (const event of streamHermesChat({
          origin: "copilot",
          userMessage: trimmed,
          history: messages.map((m) => ({ role: m.role, content: m.content })),
        })) {
          if ("delta" in event) {
            accumulated += event.delta;
            setStreamingText(accumulated);
          } else if ("error" in event) {
            setError(event.error);
          } else {
            appendMessage({ id: `local-reply-${Date.now()}`, role: "assistant", content: event.reply });
          }
        }
        return;
      }

      const res = await fetch("/api/copilot/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: trimmed, history: messages }),
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Failed to reach the Copilot");
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf("\n\n")) !== -1) {
          const rawEvent = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 2);
          if (!rawEvent.startsWith("data:")) continue;

          const event = JSON.parse(rawEvent.slice("data:".length).trim()) as StreamEvent;
          if ("delta" in event) {
            accumulated += event.delta;
            setStreamingText(accumulated);
          } else if ("error" in event) {
            setError(event.error);
          } else {
            appendMessage({ id: `local-reply-${Date.now()}`, role: "assistant", content: event.reply });
          }
        }
      }
    } finally {
      setSending(false);
      setStreamingText("");
    }
```

Add the toggle button to the header, inside `<CardHeader className="flex-row items-center justify-between border-b border-border">`, between the `<CardTitle>` and the close `<Button>`:

```typescript
        <div className="flex items-center gap-2">
          <HermesModeToggle active={hermesMode} onToggle={() => setHermesMode((v) => !v)} />
          <Button variant="outline" size="icon" onClick={close} aria-label="Close AI Copilot">
            <X className="size-4" />
          </Button>
        </div>
```

(This wraps the existing close button — remove the old standalone `<Button variant="outline" size="icon" onClick={close} aria-label="Close AI Copilot"><X className="size-4" /></Button>` line and replace the whole `<CardTitle>...</CardTitle>` + close-button pair's surrounding markup with `<CardTitle ...>AI Copilot</CardTitle>` followed by the `<div>` above.)

- [ ] **Step 2: Verify the file still type-checks and the existing tests still pass**

Run: `cd ads-agent && npx tsc --noEmit && npx vitest run components/copilot`
Expected: no TypeScript errors; any existing tests under `components/copilot` still pass (there is no `CopilotPanel.test.tsx` today, so this mainly confirms no regressions in sibling files like `copilot-state.ts`'s tests, if any).

- [ ] **Step 3: Commit**

```bash
cd /Users/swami/Documents/GentleSpace_Web
git add ads-agent/components/copilot/CopilotPanel.tsx
git commit -m "feat(ads-agent): add Ask Hermes toggle to CopilotPanel"
```

**Return to the orchestrator:** the `tsc`/`vitest` output from Step 2.

---

### Task 6: Wire "Ask Hermes" into `CrmAssistantPanel`

**Files:**
- Modify: `ads-agent/components/CrmAssistantPanel.tsx`

**Interfaces:**
- Consumes: `HermesModeToggle`, `streamHermesChat` (Task 3).
- Depends on Task 3.

- [ ] **Step 1: Add the Hermes-mode state, toggle, and branch in `sendMessage`**

In `ads-agent/components/CrmAssistantPanel.tsx`, add imports after the existing `renderer-errors` import:

```typescript
import { HermesModeToggle } from "@/components/hermes/HermesModeToggle";
import { streamHermesChat } from "@/lib/hermes/browser-client";
```

Add state next to the other `useState` calls (after `const [renderError, setRenderError] = useState<string | null>(null);`):

```typescript
  const [hermesMode, setHermesMode] = useState(false);
```

Replace the body of the `try { ... } finally { ... }` block inside `sendMessage` with:

```typescript
    try {
      if (hermesMode) {
        let accumulated = "";
        for await (const event of streamHermesChat({
          origin: "crm",
          userMessage: trimmed,
          history: messages.map((m) => ({ role: m.role, content: m.content })),
        })) {
          if ("delta" in event) {
            accumulated += event.delta;
            setStreamingText(accumulated);
          } else if (!("error" in event)) {
            setRenderError(null);
            setMessages((prev) => [...prev, { id: `a-${Date.now()}`, role: "assistant", content: event.reply }]);
          }
        }
        return;
      }

      const res = await fetch("/api/crm/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: trimmed, history: messages.map((m) => ({ role: m.role, content: m.content })) }),
      });
      if (!res.ok || !res.body) return;

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf("\n\n")) !== -1) {
          const rawEvent = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 2);
          if (!rawEvent.startsWith("data:")) continue;
          const event = JSON.parse(rawEvent.slice("data:".length).trim()) as StreamEvent;
          if ("delta" in event) {
            accumulated += event.delta;
            setStreamingText(accumulated);
          } else if (!("error" in event)) {
            setRenderError(null);
            setMessages((prev) => [...prev, { id: `a-${Date.now()}`, role: "assistant", content: event.reply }]);
          }
        }
      }
    } finally {
      setSending(false);
      setStreamingText("");
    }
```

Add the toggle to the returned JSX, just above `<SideAssistantPanel`:

```typescript
  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex justify-end">
        <HermesModeToggle active={hermesMode} onToggle={() => setHermesMode((v) => !v)} />
      </div>
      <SideAssistantPanel
```

- [ ] **Step 2: Verify the file type-checks**

Run: `cd ads-agent && npx tsc --noEmit`
Expected: no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/swami/Documents/GentleSpace_Web
git add ads-agent/components/CrmAssistantPanel.tsx
git commit -m "feat(ads-agent): add Ask Hermes toggle to CrmAssistantPanel"
```

**Return to the orchestrator:** the `tsc` output from Step 2.

---

### Task 7: Wire "Ask Hermes" into `ReportsChat`

**Files:**
- Modify: `ads-agent/components/ReportsChat.tsx`

**Interfaces:**
- Consumes: `HermesModeToggle`, `streamHermesChat` (Task 3).
- Depends on Task 3.

- [ ] **Step 1: Add the Hermes-mode state, toggle, and branch in `sendMessage`**

In `ads-agent/components/ReportsChat.tsx`, add imports after the existing `renderer-errors` import:

```typescript
import { HermesModeToggle } from "@/components/hermes/HermesModeToggle";
import { streamHermesChat } from "@/lib/hermes/browser-client";
```

Add state next to the other `useState` calls:

```typescript
  const [hermesMode, setHermesMode] = useState(false);
```

Replace the body of the `try { ... } finally { ... }` block inside `sendMessage` with:

```typescript
    try {
      if (hermesMode) {
        let accumulated = "";
        for await (const event of streamHermesChat({
          origin: "reports",
          userMessage: trimmed,
          history: messages.map((m) => ({ role: m.role, content: m.content })),
        })) {
          if ("delta" in event) {
            accumulated += event.delta;
            setStreamingText(accumulated);
          } else if (!("error" in event)) {
            setMessages((prev) => [...prev, { id: `a-${Date.now()}`, role: "assistant", content: event.reply }]);
          }
        }
        return;
      }

      const res = await fetch("/api/reports/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: trimmed, history: messages.map((m) => ({ role: m.role, content: m.content })) }),
      });
      if (!res.ok || !res.body) return;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let accumulated = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf("\n\n")) !== -1) {
          const rawEvent = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 2);
          if (!rawEvent.startsWith("data:")) continue;
          const event = JSON.parse(rawEvent.slice("data:".length).trim()) as StreamEvent;
          if ("delta" in event) {
            accumulated += event.delta;
            setStreamingText(accumulated);
          } else if (!("error" in event)) {
            setMessages((prev) => [...prev, { id: `a-${Date.now()}`, role: "assistant", content: event.reply }]);
          }
        }
      }
    } finally {
      setSending(false);
      setStreamingText("");
    }
```

Add the toggle above the messages list, replacing the opening of the returned JSX:

```typescript
  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col gap-4">
      <div className="flex justify-end">
        <HermesModeToggle active={hermesMode} onToggle={() => setHermesMode((v) => !v)} />
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto">
```

- [ ] **Step 2: Verify the file type-checks**

Run: `cd ads-agent && npx tsc --noEmit`
Expected: no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/swami/Documents/GentleSpace_Web
git add ads-agent/components/ReportsChat.tsx
git commit -m "feat(ads-agent): add Ask Hermes toggle to ReportsChat"
```

**Return to the orchestrator:** the `tsc` output from Step 2.

---

### Task 8: Wire "Ask Hermes" into `CampaignDraftChat`

**Files:**
- Modify: `ads-agent/components/CampaignDraftChat.tsx`

**Interfaces:**
- Consumes: `HermesModeToggle`, `streamHermesChat` (Task 3).
- Depends on Task 3.
- Note: unlike the other three panels, a Hermes turn here never updates `draft`/the SetupCard — Hermes has no way to produce structured field updates, so Hermes-mode replies are appended as plain assistant messages only.

- [ ] **Step 1: Add the Hermes-mode state, toggle, and branch in `sendMessage`**

In `ads-agent/components/CampaignDraftChat.tsx`, add imports after the existing `AiSetupView` import:

```typescript
import { HermesModeToggle } from "@/components/hermes/HermesModeToggle";
import { streamHermesChat } from "@/lib/hermes/browser-client";
```

Add state next to the other `useState` calls (after `const [streamingText, setStreamingText] = useState("");`):

```typescript
  const [hermesMode, setHermesMode] = useState(false);
```

Replace the body of the `try { ... } finally { ... }` block inside `sendMessage` with:

```typescript
    try {
      if (hermesMode) {
        let accumulated = "";
        for await (const event of streamHermesChat({
          origin: "campaign",
          userMessage: content,
          history: messages.map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.content })),
        })) {
          if ("delta" in event) {
            accumulated += event.delta;
            setStreamingText(accumulated);
          } else if ("error" in event) {
            setError(event.error);
          } else {
            setMessages((prev) => [
              ...prev,
              {
                id: `local-reply-${Date.now()}`,
                draftId: draft.id,
                role: "assistant",
                content: event.reply,
                createdAt: new Date().toISOString(),
              },
            ]);
          }
        }
        return;
      }

      const res = await fetch(`/api/campaign-drafts/${draft.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Failed to send message");
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf("\n\n")) !== -1) {
          const rawEvent = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 2);
          if (!rawEvent.startsWith("data:")) continue;

          const event = JSON.parse(rawEvent.slice("data:".length).trim()) as StreamEvent;
          if ("delta" in event) {
            accumulated += event.delta;
            setStreamingText(accumulated);
          } else if ("error" in event) {
            setError(event.error);
          } else {
            setMessages((prev) => [
              ...prev,
              {
                id: `local-reply-${Date.now()}`,
                draftId: draft.id,
                role: "assistant",
                content: event.reply,
                createdAt: new Date().toISOString(),
              },
            ]);
            setDraft(event.draft);
          }
        }
      }
    } finally {
      setSending(false);
      setStreamingText("");
    }
```

Add the toggle to the left card's header:

```typescript
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base font-semibold text-foreground">Describe your campaign</CardTitle>
          <HermesModeToggle active={hermesMode} onToggle={() => setHermesMode((v) => !v)} />
        </CardHeader>
```

(This replaces the existing `<CardHeader><CardTitle ...>Describe your campaign</CardTitle></CardHeader>`.)

- [ ] **Step 2: Verify the file type-checks**

Run: `cd ads-agent && npx tsc --noEmit`
Expected: no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
cd /Users/swami/Documents/GentleSpace_Web
git add ads-agent/components/CampaignDraftChat.tsx
git commit -m "feat(ads-agent): add Ask Hermes toggle to CampaignDraftChat"
```

**Return to the orchestrator:** the `tsc` output from Step 2.

---

### Task 9: Hermes-side config — second MCP entry + enable the API server (orchestrator — not a subagent)

Do this yourself after Wave 2 completes. Not a subagent: it edits `~/.hermes/config.yaml`/`~/.hermes/.env` (outside this git repo, per the container-install plan's constraints) and restarts a Docker container — the same category of host-machine work as Task 5/6 in that plan.

- [ ] **Step 1: Add the second `mcp_servers` entry to `~/.hermes/config.yaml`**

Read the current file first (it has the Vertex AI block from the container-install plan's execution notes, not the Google-AI-Studio block as originally written — do not overwrite that). Add, inside the existing `mcp_servers:` key, alongside `ads_agent:`:

```yaml
  app_data:
    url: "http://localhost:8767/mcp"
    tools:
      include:
        - list_opportunities
        - search_opportunities
        - get_opportunity
        - get_spend_cpl_trend
        - list_campaigns_with_cpl
        - list_pending_proposals
```

- [ ] **Step 2: Generate a bearer key and enable the API server in `~/.hermes/.env`**

```bash
HERMES_KEY=$(openssl rand -hex 32)
echo "API_SERVER_ENABLED=true" >> ~/.hermes/.env
echo "API_SERVER_KEY=${HERMES_KEY}" >> ~/.hermes/.env
echo "Generated key (write this into ads-agent/.env.local's HERMES_API_SERVER_KEY next): ${HERMES_KEY}"
```

Do not print `${HERMES_KEY}` anywhere else in the session transcript beyond this one confirmation line.

- [ ] **Step 3: Mirror the key into `ads-agent`'s env**

Add to `/Users/swami/Documents/GentleSpace_Web/ads-agent/.env.local` (create the three lines if absent, update `HERMES_API_SERVER_KEY` if the line already exists from a prior run):

```
HERMES_API_SERVER_URL=http://127.0.0.1:8642
HERMES_API_SERVER_KEY=<the key generated in Step 2>
HERMES_API_SERVER_MODEL=hermes-agent
```

- [ ] **Step 4: Restart Hermes and verify**

```bash
cd /Users/swami/hermes-agent
docker compose up -d --build
docker compose exec gateway hermes mcp list
```
Expected: both `ads_agent` (4 tools) and `app_data` (6 tools) listed, both `enabled`.

```bash
docker compose exec gateway hermes doctor
```
Expected: no error about `API_SERVER_ENABLED`; if the doctor output doesn't explicitly confirm the API server started, check container logs instead:
```bash
docker compose logs gateway --tail 40 | grep -i "api server"
```
Expected: a line indicating the API server is listening on `127.0.0.1:8642`.

**Return to the orchestrator (yourself):** `hermes mcp list` output confirming both servers, and confirmation the API server is listening — do not proceed to Task 10 until both are true.

---

### Task 10: End-to-end verification and spec sign-off (orchestrator — not a subagent, sequential after Task 9)

- [ ] **Step 1: Start `ads-agent`'s dev server and dependencies**

```bash
cd /Users/swami/Documents/GentleSpace_Web/ads-agent
docker compose up -d db bifrost app-data-mcp google-ads-mcp
npm run dev
```
Expected: `ads-agent` reachable at `http://localhost:3030`.

- [ ] **Step 2: Curl the new route directly**

```bash
curl -N -s http://localhost:3030/api/hermes/chat \
  -H "Content-Type: application/json" \
  -d '{"userMessage":"Say hello and name one MCP tool you have access to.","history":[],"origin":"copilot"}'
```
Expected: a stream of `data: {"delta": "..."}` lines followed by `data: {"done":true,"reply":"..."}`, whose reply is plain prose (no `root = ` OpenUI-lang) and names a real tool (e.g. `list_campaign_performance` or `list_opportunities`), not a 401/403 (if it 403s, first authenticate a session per `auth-service`'s runbook, or temporarily test with `requireApiRole`'s dev-bypass if one exists — check `lib/auth/dal.ts` for how the other 3 routes are tested manually in this repo's README).

- [ ] **Step 3: Confirm the usage-chunk assumption from Task 2's ponytail comment**

```bash
docker exec -it ads-agent-db-1 psql -U ads_agent -d ads_agent -c \
  "SELECT feature, model, prompt_tokens, completion_tokens, cost_usd FROM usage_ledger WHERE feature = 'ads-agent:hermes-chat:copilot' ORDER BY created_at DESC LIMIT 1;"
```
Expected: one row. If `prompt_tokens`/`completion_tokens` are both `0`, Hermes' API server did not send a real `usage` chunk — this confirms the synthesized-fallback path in `lib/hermes/server-client.ts` is firing in production, not just in tests. Record this as a deviation in this plan's "Execution Notes" (add that section now, mirroring the container-install plan's format) rather than silently leaving it: note that Hermes usage is currently under-billed at $0 per turn, and that fixing it requires confirming the exact request shape Hermes' API server expects to emit real usage (check `~/hermes-agent/gateway/platforms/api_server.py` if pursuing this further — out of scope for this plan to fix blind).

- [ ] **Step 4: Verify each of the 4 panels manually**

Open `http://localhost:3030` in a browser, sign in, and for each of Copilot, CRM Assistant, Reports, and the Campaign draft chat: click "Ask Hermes", send a domain-relevant question (e.g. CRM panel: "which opportunities are in the SHORTLIST stage?"), and confirm the reply is plain prose (not a broken OpenUI render) and is grounded in real data (cross-check one fact against the panel's own non-Hermes answer to the same question). Toggle back to the default mode and confirm the panel still works exactly as before (no regression).

- [ ] **Step 5: Check off this spec's success criteria**

Open `docs/superpowers/specs/2026-08-10-hermes-chat-integration-design.md` and check off (`- [x]`) every box in "Success criteria" that Steps 1–4 verified. Leave any box unchecked with an inline note if Step 3 revealed the $0-billing gap and it wasn't separately fixed.

- [ ] **Step 6: Commit**

```bash
cd /Users/swami/Documents/GentleSpace_Web
git add docs/superpowers/specs/2026-08-10-hermes-chat-integration-design.md
git commit -m "docs: check off Hermes chat integration success criteria"
```
