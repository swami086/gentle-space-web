# MCP-Only Backend Tool Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Parallel execution override:** this plan is explicitly structured into dependency waves (see "Parallelization Map" below) so that all tasks within a wave can be dispatched to **separate subagents concurrently, up to 8 at a time**. This supersedes subagent-driven-development's default "never dispatch implementers in parallel" rule for this plan only, per explicit user instruction. Do not start a wave until every task in the previous wave is committed and its tests pass — cross-wave dependencies are real (see each task's **Interfaces: Consumes**).

> **Validated 2026-08-05** against official sources (`modelcontextprotocol.io`, `docs.getbifrost.ai`, the official MCP TypeScript SDK, `supergateway`, `docs.twenty.com`) — see `docs/superpowers/specs/2026-08-05-mcp-backend-tool-integration-validation.md`. Two corrections from the original plan are baked into every task below: (1) transport is Streamable HTTP, not SSE (SSE is deprecated by the MCP spec); (2) MCP connectivity uses the official `@modelcontextprotocol/client` SDK directly against the Twenty MCP server, **not** Bifrost's proprietary MCP Gateway feature — Bifrost's `config.json` is untouched by this plan. This is a strictly smaller footprint than the original draft: no Bifrost `mcp` config section, no custom allowlist header, no live-discovery step for an internal naming convention.

**Goal:** Replace ads-agent's raw-REST Twenty CRM connector and the client-side OpenUI tool-execution hop with a two-phase, backend-only MCP integration (the official MCP SDK, talking directly to a self-hosted Twenty MCP server), for the Copilot and CRM Assistant chat surfaces — while leaving Reports Chat's analytics tools and Copilot's campaign-draft mutation on their current (unchanged, non-goal) client-Query() path.

**Architecture:** Every CRM-tool-using chat turn now runs a non-streaming **resolve** call plus one MCP round-trip, then the existing streaming **generate** call: fetch the Twenty MCP server's live tool schemas (`list_opportunities`/`get_opportunity` only) via `listTools()`, pass them as Bifrost's plain `tools` param on a non-streaming chat completion, execute any returned tool calls via the same MCP client's `callTool()`, append results as `tool` messages, then re-run the existing streaming call now grounded with real data. No mutating tool's schema is ever built into the `tools` array, so the model cannot request it — enforced structurally, not by a denylist. `twenty-pipeline.ts`'s three functions call the same MCP client wrapper directly (no LLM, no Bifrost involved) for non-chat callers like the `/crm` admin page.

**Tech Stack:** TypeScript, Next.js (ads-agent), Vitest, Bifrost AI gateway (`maximhq/bifrost`, used only for OpenAI-compatible chat completions — its MCP Gateway feature is deliberately not used), `@modelcontextprotocol/client` (official MCP TypeScript SDK, new dependency), `supergateway` (stdio→Streamable HTTP bridge), community `mhenry3164/twenty-crm-mcp-server` (Node/stdio MCP server for Twenty CRM), Docker Compose.

## Global Constraints

- Scope is `ads-agent` only; the root Gentle Space app has no AI-copilot tool-calling surface.
- Mutations are never triggered by model output. `advance_opportunity_stage`'s human-confirm-then-PATCH flow (`StageChangeConfirm` → separate route) is unchanged, verbatim, by every task in this plan.
- Meta Ads and Google Ads MCP migration is documentation-only in this pass — no credentials exist for either today (`ads-agent/.env.example` ships both empty). No code task touches `lib/connectors/meta.ts` or `lib/connectors/google-ads.ts`.
- Reports Chat's analytics tools (`get_spend_cpl_trend`, `list_campaigns_with_cpl`, `list_pending_proposals`) query our own Postgres, not an external vendor — they are explicitly out of scope for MCP-wrapping and keep their current client-side `Query()` → `/api/openui/tools` path unchanged.
- Copilot's `start_campaign_draft` mutation keeps its current client-side `Mutation()` → `/api/openui/tools` path unchanged (non-goal, per the design spec — `campaign-chat.ts`'s `SetupCard` flow is untouched).
- `lib/openui/http-tool-provider.ts` and `app/api/openui/tools/route.ts` are **kept**, not removed (this corrects the design spec's Migration step 5 — analytics and the campaign-draft mutation still need them; only the three CRM read tool names are trimmed out of the two client components that no longer need them).
- Every new/changed call to Twenty goes through the MCP server (`twenty-mcp-gateway`), never a raw REST call to Twenty's own API from application code. This is a change from the original draft: MCP tool calls (`listTools`/`callTool`) go directly to `twenty-mcp-gateway`, not through `BIFROST_BASE_URL` — only the model-decision step (Phase 1's resolve chat completion, and Phase 2's generate call) goes through Bifrost. See the validation doc for why.
- Source spec: `docs/superpowers/specs/2026-08-05-mcp-backend-tool-integration-design.md`. Source validation: `docs/superpowers/specs/2026-08-05-mcp-backend-tool-integration-validation.md`.

## Parallelization Map

```
Wave 1 (4 parallel)              Wave 2 (2 parallel)         Wave 3 (2 parallel)        Wave 4 (1)
─────────────────────            ─────────────────────       ─────────────────────      ──────────
Task 1: Twenty MCP infra   ──┐
Task 2: mcp-client.ts       ─┼──▶ Task 5: twenty-pipeline.ts ──▶ Task 7: copilot-chat.ts ──┐
Task 3: bifrost client.ts   ─┘    Task 6: resolve-tools-...  ──▶ Task 8: crm-chat.ts     ──┼─▶ Task 9: live smoke
   types                          then-generate.ts               (Task 6 → both 7 & 8)      + regression check
Task 4: Meta/Google docs (independent of everything, land whenever)
```

Real max concurrency this plan's dependency graph supports is **4** (Wave 1). Waves 2 and 3 support 2-way parallelism each. This is fewer than the 8-subagent ceiling because the work is a surgical, narrowly-scoped swap (one vendor connector + two chat surfaces) — inflating task count to fill 8 slots would mean splitting single-responsibility files across tasks, which the writing-plans skill's Task Right-Sizing rule and this repo's own YAGNI convention both rule out. Dispatch every task in a wave in one batch of parallel subagents; do not start the next wave until all of the current wave's tasks are committed with passing tests.

## Skill Assignment Per Task (from `~/.cursor/skills/engineering-skills2/index.json`, 31-skill catalog)

| Task | Primary skill | Secondary skill | Why |
|---|---|---|---|
| 1. Twenty MCP infra | `senior-devops` | — | Docker Compose service wiring, container networking, env var export pattern |
| 2. `mcp-client.ts` | `senior-backend` | `tdd-guide` | Thin wrapper around the official `@modelcontextprotocol/client` SDK — connection lifecycle + error mapping, not protocol implementation |
| 3. `bifrost/client.ts` types | `senior-backend` | `tdd-guide` | Extending an existing typed HTTP client's request/response shapes |
| 4. Meta/Google Ads docs | `senior-architect` | — | Target-state integration documentation (ADR-adjacent), no code |
| 5. `twenty-pipeline.ts` rewrite | `senior-backend` | `tdd-guide` | Swapping a REST integration's transport while preserving exact function signatures |
| 6. `resolve-tools-then-generate.ts` | `senior-prompt-engineer` | `senior-backend` | Validates agent/tool-calling loop correctness (the mutation-safety allowlist is the highest-stakes logic in this plan) |
| 7. `copilot-chat.ts` + `CopilotPanel.tsx` | `senior-fullstack` | `senior-prompt-engineer` | Server decision-engine + client component together; system-prompt rewrite |
| 8. `crm-chat.ts` + `CrmAssistantPanel.tsx` | `senior-fullstack` | `senior-prompt-engineer` | Same shape as Task 7, smaller surface |
| 9. Live smoke + regression | `senior-qa` | `tdd-guide` | End-to-end verification across all 4 chat surfaces, not just the 2 changed ones |

Each implementer subagent should read `~/.cursor/skills/engineering-skills/<skill-name>/SKILL.md` for its assigned skill(s) before starting, per the `/engineering-skills2` routing convention.

## Model Selection Per Task

Per `subagent-driven-development`'s model-selection rule (least powerful model that can do the job): Tasks 1 and 4 are mechanical/docs (fast/cheap tier). Tasks 2, 3, 5 are mechanical once the brief's code is transcribed (standard tier is the floor — turn count on multi-step TDD tasks makes the cheapest tier a false economy per that skill's own guidance). Task 6 carries the mutation-safety-critical logic and needs judgment (standard-to-most-capable tier). Tasks 7, 8, 9 integrate across files and need standard tier. Always specify the model explicitly when dispatching — never let a dispatch silently inherit the session default.

---

## Task 1: Twenty MCP infrastructure (Wave 1)

**Files:**
- Modify: `ads-agent/docker-compose.yml`
- Create: `ads-agent/lib/bifrost/twenty-mcp-tools.ts`
- Modify: `ads-agent/bifrost/README.md`
- Modify: `ads-agent/package.json` (add `@modelcontextprotocol/client`)
- Test: none (infra task; verified by the manual steps below, consumed by Task 2/5/6 via the constants this task produces)

**Interfaces:**
- Consumes: nothing (first task in the graph).
- Produces: `TWENTY_MCP_URL: string`, `TWENTY_MCP_TOOLS.{listOpportunities,getOpportunity,updateOpportunity}` — exported from `lib/bifrost/twenty-mcp-tools.ts`. Tasks 2, 5, and 6 import these; do not hardcode the tool-name strings or the gateway URL anywhere else.

**This task does not touch `ads-agent/bifrost/config.json` at all** — corrected during validation (see `docs/superpowers/specs/2026-08-05-mcp-backend-tool-integration-validation.md`, finding 2). The app connects to the Twenty MCP server directly with the official `@modelcontextprotocol/client` SDK; Bifrost's own MCP Gateway feature is not used, so there is no Bifrost config, no allowlist header, and no tool-naming-convention discovery step to run.

The community server `github.com/mhenry3164/twenty-crm-mcp-server` only speaks MCP over **stdio** (`npm start` runs a stdio server; there's no built-in HTTP/SSE mode). `supercorp/supergateway` bridges it to **Streamable HTTP** — the current MCP standard transport (SSE was deprecated by the MCP spec's 2025-03-26 revision; see validation finding 1) — as its own sidecar container, and the app's MCP client connects to that sidecar directly.

- [ ] **Step 1: Add the `twenty-mcp-gateway` service to docker-compose.yml**

Add this service (alongside the existing `db` and `bifrost` services — do not remove or reorder those):

```yaml
  twenty-mcp-gateway:
    image: supercorp/supergateway
    command:
      - "--stdio"
      - "npx -y github:mhenry3164/twenty-crm-mcp-server"
      - "--outputTransport"
      - "streamableHttp"
      - "--port"
      - "8765"
    environment:
      TWENTY_API_KEY: ${TWENTY_API_KEY}
      TWENTY_BASE_URL: ${TWENTY_BASE_URL:-http://host.docker.internal:3020}
    ports:
      - "8765:8765"
    restart: unless-stopped
```

`host.docker.internal` (not `localhost`) is required here because `TWENTY_BASE_URL`'s default in `.env.example` points at `localhost:3020`, which from inside this container would resolve to the container itself, not the host machine running Twenty CRM. The Streamable HTTP endpoint defaults to `/mcp` (`supergateway`'s own default path), so the full URL from inside the Docker network is `http://twenty-mcp-gateway:8765/mcp`.

- [ ] **Step 2: Add the official MCP client SDK dependency**

```bash
cd ads-agent
npm install @modelcontextprotocol/client
```

- [ ] **Step 3: Start the sidecar and verify it responds**

```bash
cd ads-agent
export TWENTY_API_KEY="$(grep '^TWENTY_API_KEY=' .env.local | cut -d= -f2-)"
export TWENTY_BASE_URL="$(grep '^TWENTY_BASE_URL=' .env.local | cut -d= -f2-)"
docker compose up -d twenty-mcp-gateway
sleep 5
docker compose logs twenty-mcp-gateway | tail -30
```

Expected: logs show the stdio server started (the community server's own startup banner) and `supergateway` listening on `:8765`. If it fails, check `TWENTY_API_KEY` was exported before `docker compose up` (same gotcha this repo already documents for Bifrost/Vertex in `bifrost/README.md`).

- [ ] **Step 4: Verify `listTools()` against the live sidecar with a throwaway script**

```bash
cd ads-agent
cat > /tmp/verify-twenty-mcp.mjs <<'EOF'
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
const client = new Client({ name: "verify-script", version: "1.0.0" });
await client.connect(new StreamableHTTPClientTransport(new URL("http://localhost:8765/mcp")));
const { tools } = await client.listTools();
console.log(tools.map((t) => t.name));
await client.close();
EOF
node /tmp/verify-twenty-mcp.mjs
```

Expected: an array of tool names including `list_opportunities`, `get_opportunity`, `update_opportunity` (exact real names — confirm these three exist and are spelled this way before Step 5; if the server names them differently, use the real names in Step 5 instead of guessing). Delete `/tmp/verify-twenty-mcp.mjs` when done.

- [ ] **Step 5: Write the tool-name/URL constants file**

```typescript
// ads-agent/lib/bifrost/twenty-mcp-tools.ts

/** Streamable HTTP endpoint for the twenty-mcp-gateway sidecar (see docker-compose.yml). */
export const TWENTY_MCP_URL =
  process.env.TWENTY_MCP_URL || "http://twenty-mcp-gateway:8765/mcp";

/**
 * Real tool names exposed by the Twenty MCP server (github.com/mhenry3164/twenty-crm-mcp-server),
 * confirmed live against the running gateway in Task 1 Step 4 of
 * docs/superpowers/plans/2026-08-05-mcp-backend-tool-integration.md.
 */
export const TWENTY_MCP_TOOLS = {
  listOpportunities: "list_opportunities",
  getOpportunity: "get_opportunity",
  updateOpportunity: "update_opportunity",
} as const;

/**
 * Read-only subset the model is ever allowed to see (Task 6 fetches live schemas via listTools()
 * and filters to exactly these two names — updateOpportunity is deliberately excluded here so the
 * model can never be told a mutating tool exists, let alone request it).
 */
export const TWENTY_MCP_READ_TOOL_NAMES = [
  TWENTY_MCP_TOOLS.listOpportunities,
  TWENTY_MCP_TOOLS.getOpportunity,
] as const;
```

- [ ] **Step 6: Document the new service in bifrost/README.md**

Add a new section at the end of `ads-agent/bifrost/README.md` (despite the filename, this documents an app-level MCP dependency, not a Bifrost config change — noted explicitly so a future reader doesn't go looking in `bifrost/config.json`):

```markdown
## Twenty MCP (self-hosted CRM tools)

`twenty-mcp-gateway` bridges the community `mhenry3164/twenty-crm-mcp-server` (stdio-only) to
Streamable HTTP via `supergateway`. **Bifrost's own config is not involved** — `lib/bifrost/mcp-client.ts`
connects to this sidecar directly with the official `@modelcontextprotocol/client` SDK; Bifrost is
only used for the actual chat completion (`lib/openui/resolve-tools-then-generate.ts` builds an
explicit `tools` param from this server's live schema and passes it to Bifrost like any other
OpenAI-compatible tool-calling request).

1. Export the same `TWENTY_API_KEY`/`TWENTY_BASE_URL` used elsewhere (see step 1 above):
   ```bash
   export TWENTY_API_KEY="$(grep '^TWENTY_API_KEY=' .env.local | cut -d= -f2-)"
   export TWENTY_BASE_URL="$(grep '^TWENTY_BASE_URL=' .env.local | cut -d= -f2-)"
   ```
2. `docker compose up -d twenty-mcp-gateway`
3. Verify: `docker compose logs twenty-mcp-gateway` shows it listening on `:8765`.

Reports Chat, Campaign Chat, and Phase 2 of Copilot/CRM Assistant never call `listTools()` or pass a
`tools` param to Bifrost, so they never see a Twenty tool — there is no allowlist/denylist to keep in
sync, because those code paths simply never mention Twenty at all.
```

- [ ] **Step 7: Commit**

```bash
cd ads-agent
git add docker-compose.yml bifrost/README.md lib/bifrost/twenty-mcp-tools.ts package.json package-lock.json
git commit -m "feat(ads-agent): add self-hosted Twenty MCP gateway (Streamable HTTP)"
```

---

## Task 2: Twenty MCP client wrapper (Wave 1)

**Files:**
- Create: `ads-agent/lib/bifrost/mcp-client.ts`
- Test: `ads-agent/lib/bifrost/mcp-client.test.ts`

**Interfaces:**
- Consumes: `TWENTY_MCP_URL` from `lib/bifrost/twenty-mcp-tools.ts` (Task 1); `Client`/`StreamableHTTPClientTransport` from the official `@modelcontextprotocol/client` SDK.
- Produces: `listTwentyTools(): Promise<McpToolSchema[]>` (used by Task 6 to build Bifrost's `tools` param) and `callTwentyTool(name: string, args: Record<string, unknown>): Promise<unknown>` (used by Task 5's `twenty-pipeline.ts` and Task 6's resolve loop) + the `McpToolSchema` type.

This module is a thin wrapper around the official SDK — it owns nothing MCP-protocol-shaped itself (no hand-rolled JSON-RPC, no Bifrost-specific envelope). It connects fresh per call and closes in a `finally` block, matching the SDK's own documented per-call usage pattern (`docs/clients/connect.md`: *"in a client that can throw between connect and close, put close() in a finally block"*) — appropriate here since Next.js API routes are effectively one-shot per request.

- [ ] **Step 1: Write the failing tests**

```typescript
// ads-agent/lib/bifrost/mcp-client.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const connect = vi.fn();
const listTools = vi.fn();
const callTool = vi.fn();
const close = vi.fn();

vi.mock("@modelcontextprotocol/client", () => ({
  Client: vi.fn().mockImplementation(() => ({ connect, listTools, callTool, close })),
  StreamableHTTPClientTransport: vi.fn().mockImplementation((url: URL) => ({ url })),
}));

import { callTwentyTool, listTwentyTools } from "./mcp-client";

beforeEach(() => {
  connect.mockReset().mockResolvedValue(undefined);
  listTools.mockReset();
  callTool.mockReset();
  close.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("listTwentyTools", () => {
  it("connects, lists tools, and closes the connection", async () => {
    listTools.mockResolvedValue({
      tools: [{ name: "list_opportunities", description: "List opportunities", inputSchema: { type: "object" } }],
    });

    const tools = await listTwentyTools();

    expect(tools).toEqual([{ name: "list_opportunities", description: "List opportunities", inputSchema: { type: "object" } }]);
    expect(connect).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("still closes the connection when listTools throws", async () => {
    listTools.mockRejectedValue(new Error("boom"));
    await expect(listTwentyTools()).rejects.toThrow("boom");
    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe("callTwentyTool", () => {
  it("calls callTool with name/arguments and returns the parsed text content", async () => {
    callTool.mockResolvedValue({ content: [{ type: "text", text: JSON.stringify({ records: [{ id: "1" }] }) }] });

    const result = await callTwentyTool("list_opportunities", { limit: 200 });

    expect(result).toEqual({ records: [{ id: "1" }] });
    expect(callTool).toHaveBeenCalledWith({ name: "list_opportunities", arguments: { limit: 200 } });
  });

  it("returns the raw text when it is not valid JSON", async () => {
    callTool.mockResolvedValue({ content: [{ type: "text", text: "plain text result" }] });
    expect(await callTwentyTool("some_tool", {})).toBe("plain text result");
  });

  it("throws when the tool result has isError set", async () => {
    callTool.mockResolvedValue({ isError: true, content: [{ type: "text", text: "bad stage" }] });
    await expect(callTwentyTool("update_opportunity", {})).rejects.toThrow(/bad stage/);
  });

  it("closes the connection even when callTool throws", async () => {
    callTool.mockRejectedValue(new Error("not found"));
    await expect(callTwentyTool("get_opportunity", { id: "missing" })).rejects.toThrow("not found");
    expect(close).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ads-agent && npx vitest run lib/bifrost/mcp-client.test.ts`
Expected: FAIL — `Cannot find module './mcp-client'`.

- [ ] **Step 3: Implement the module**

```typescript
// ads-agent/lib/bifrost/mcp-client.ts
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { TWENTY_MCP_URL } from "./twenty-mcp-tools";

export type McpToolSchema = {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
};

async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ name: "ads-agent", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(TWENTY_MCP_URL)));
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

/** Live tool schemas from the Twenty MCP server — used to build Bifrost's `tools` param. */
export async function listTwentyTools(): Promise<McpToolSchema[]> {
  return withClient(async (client) => {
    const { tools } = await client.listTools();
    return tools as McpToolSchema[];
  });
}

/**
 * Calls one Twenty MCP tool directly (no LLM, no Bifrost involved) and returns its parsed content.
 * Used both by twenty-pipeline.ts's non-chat callers and by the chat-triggered resolve loop
 * (resolve-tools-then-generate.ts) once a tool_call has been decided by the model.
 */
export async function callTwentyTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  return withClient(async (client) => {
    const result = await client.callTool({ name, arguments: args });
    const text = result.content?.find((block: { type: string }) => block.type === "text")?.text ?? "";
    if (result.isError) {
      throw new Error(`twenty mcp tool "${name}" failed: ${text}`);
    }
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ads-agent && npx vitest run lib/bifrost/mcp-client.test.ts`
Expected: PASS (6/6).

- [ ] **Step 5: Commit**

```bash
cd ads-agent
git add lib/bifrost/mcp-client.ts lib/bifrost/mcp-client.test.ts
git commit -m "feat(ads-agent): add Twenty MCP client wrapper (official SDK)"
```

---

## Task 3: Extend Bifrost client types for tool-calling (Wave 1)

**Files:**
- Modify: `ads-agent/lib/bifrost/client.ts`
- Test: `ads-agent/lib/bifrost/client.test.ts` (existing file — add cases, do not remove existing ones)

**Interfaces:**
- Consumes: nothing new.
- Produces: `ChatMessage` gains `role: "tool"` and optional `tool_calls`/`tool_call_id` fields; `ChatCompletionOptions` gains optional `tools`/`tool_choice` (the standard OpenAI-compatible tool-calling params — not a Bifrost-specific header, corrected during validation from an earlier `headers`-based draft); `ChatCompletionResponse`'s message gains optional `tool_calls`. Task 6 imports all of these.

- [ ] **Step 1: Read the existing test file to match its conventions**

Read `ads-agent/lib/bifrost/client.test.ts` in full before writing new cases — reuse its existing `beforeEach`/`afterEach` fetch-mock setup rather than duplicating it.

- [ ] **Step 2: Write the failing tests**

Add these `describe` blocks to the existing `ads-agent/lib/bifrost/client.test.ts` (append, do not replace existing content):

```typescript
describe("chatCompletion with tool_calls", () => {
  it("passes a tools param through to the request body", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { role: "assistant", content: "hi" } }] }),
    });

    const tools = [{ type: "function" as const, function: { name: "list_opportunities", description: "", parameters: {} } }];
    await chatCompletion({ messages: [{ role: "user", content: "hi" }], tools });

    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.tools).toEqual(tools);
  });

  it("returns tool_calls on the response message when present", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [{ id: "call_1", type: "function", function: { name: "twenty_list_opportunities", arguments: "{}" } }],
            },
          },
        ],
      }),
    });

    const response = await chatCompletion({ messages: [{ role: "user", content: "show leads" }] });

    expect(response.choices?.[0]?.message?.tool_calls).toEqual([
      { id: "call_1", type: "function", function: { name: "twenty_list_opportunities", arguments: "{}" } },
    ]);
  });

  it("accepts a tool-role message with tool_call_id in the request", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { role: "assistant", content: "done" } }] }),
    });

    await chatCompletion({
      messages: [
        { role: "user", content: "show leads" },
        { role: "assistant", content: "", tool_calls: [{ id: "call_1", type: "function", function: { name: "twenty_list_opportunities", arguments: "{}" } }] },
        { role: "tool", content: "[]", tool_call_id: "call_1" },
      ],
    });

    const [, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.messages[2]).toEqual({ role: "tool", content: "[]", tool_call_id: "call_1" });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd ads-agent && npx vitest run lib/bifrost/client.test.ts`
Expected: FAIL — type errors first (TS won't compile `role: "tool"` or `headers` yet), then runtime assertion failures once types are loosened enough to compile.

- [ ] **Step 4: Implement the type + behavior changes**

In `ads-agent/lib/bifrost/client.ts`, replace the `ChatMessage`, `ChatCompletionOptions`, and `ChatCompletionResponse` type declarations and the `chatCompletion` function body:

```typescript
export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
};

/** Standard OpenAI-compatible tool-calling schema — see openai.com/docs/api-reference/chat/create. */
export type ToolDefinition = {
  type: "function";
  function: { name: string; description?: string; parameters: Record<string, unknown> };
};

export type ChatCompletionOptions = {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  responseFormat?: {
    type: "json_schema";
    json_schema: { name: string; schema: Record<string, unknown>; strict?: boolean };
  };
  fallbacks?: string[];
  timeoutMs?: number;
  /** Standard OpenAI-compatible tools param — e.g. the Twenty MCP server's read-only tool schemas. */
  tools?: ToolDefinition[];
  toolChoice?: "auto" | "none";
};

export type ChatCompletionResponse = {
  id?: string;
  model?: string;
  choices?: { message?: { role?: string; content?: string | null; tool_calls?: ToolCall[] } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  extra_fields?: { provider?: string };
};
```

Then update `chatCompletion`'s fetch call to include `tools`/`tool_choice` in the request body when present:

```typescript
export async function chatCompletion(options: ChatCompletionOptions): Promise<ChatCompletionResponse> {
  const url = `${baseUrl()}/v1/chat/completions`;
  if (!baseUrl()) throw new Error("BIFROST_BASE_URL is not set");

  const model = options.model || defaultModel();
  const fallbacks = options.fallbacks ?? fallbacksForModel(model);

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: options.messages,
      temperature: options.temperature ?? 0.3,
      max_tokens: options.maxTokens ?? 600,
      ...(fallbacks.length > 0 ? { fallbacks } : {}),
      ...(options.responseFormat ? { response_format: options.responseFormat } : {}),
      ...(options.tools ? { tools: options.tools, tool_choice: options.toolChoice ?? "auto" } : {}),
    }),
    signal: options.timeoutMs ? AbortSignal.timeout(options.timeoutMs) : undefined,
  });

  if (!res.ok) {
    throw new Error(`bifrost chatCompletion failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as ChatCompletionResponse;
}
```

Leave `isBifrostConfigured`, `fallbacksForModel`, and `firstChoiceContent` unchanged — `firstChoiceContent`'s `typeof content !== "string"` check already safely ignores `null`/tool-call-only messages.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd ads-agent && npx vitest run lib/bifrost/client.test.ts`
Expected: PASS, including every pre-existing test in the file (confirm none regressed — the `content: string` → `content: string | null` widening must not break `firstChoiceContent`'s existing tests).

- [ ] **Step 6: Commit**

```bash
cd ads-agent
git add lib/bifrost/client.ts lib/bifrost/client.test.ts
git commit -m "feat(ads-agent): extend Bifrost client types for MCP tool-calling"
```

---

## Task 4: Document Meta/Google Ads MCP target state (Wave 1)

**Files:**
- Modify: `ads-agent/README.md`
- Test: none (documentation only)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing other tasks import — purely informational.

- [ ] **Step 1: Read the current README's Meta/Google Ads setup sections**

Read `ads-agent/README.md` in full first, to match its existing heading style and locate where the Meta/Google Ads env var setup instructions currently live — add the new subsection immediately after them.

- [ ] **Step 2: Add the target-state MCP documentation**

Add this subsection (adjust the heading level to match whatever level the surrounding Meta/Google Ads section already uses):

```markdown
### Future: MCP-based Meta/Google Ads integration

`lib/connectors/meta.ts` and `lib/connectors/google-ads.ts` are unconfigured today (no credentials
in `.env.local`) — there is nothing live to migrate. When real ad-account credentials are added, the
target end state (matching the Twenty CRM MCP integration — see `bifrost/README.md`'s "Twenty MCP"
section) is the same shape: connect with the official `@modelcontextprotocol/client` SDK directly,
not through Bifrost's MCP Gateway feature.

- **Meta Ads**: Meta's official hosted MCP endpoint, `mcp.facebook.com/ads` (OAuth, 29 tools,
  launched April 2026 as part of Meta's "Ads AI Connectors"). Use `StreamableHTTPClientTransport`
  with the SDK's OAuth client helpers — no self-hosting needed, unlike Twenty.
- **Google Ads**: Google's officially published Google Ads MCP server
  (`developers.google.com/google-ads/api/docs/developer-toolkit/mcp-server`). Self-hosted, similar
  shape to the Twenty MCP setup — check whether it speaks stdio or HTTP natively before deciding if
  it needs a `supergateway`-style bridge like Twenty's does.

Until credentials exist, `lib/connectors/meta.ts` and `lib/connectors/google-ads.ts` keep their
current (direct API, unconfigured) code paths unchanged.
```

- [ ] **Step 3: Commit**

```bash
cd ads-agent
git add README.md
git commit -m "docs(ads-agent): document Meta/Google Ads MCP target integration"
```

---

## Task 5: Rewrite twenty-pipeline.ts to call the Twenty MCP server (Wave 2)

**Files:**
- Modify: `ads-agent/lib/crm/twenty-pipeline.ts`
- Modify: `ads-agent/lib/crm/twenty-pipeline.test.ts`

**Interfaces:**
- Consumes: `callTwentyTool` from `lib/bifrost/mcp-client.ts` (Task 2), `TWENTY_MCP_TOOLS` from `lib/bifrost/twenty-mcp-tools.ts` (Task 1).
- Produces: `listOpportunities()`, `getOpportunity(id)`, `updateOpportunityStage(id, stage)`, `getPipelineValue()`, `maskPhone()`, `PIPELINE_STAGES` — **identical exported signatures and types to today** (verified by Task 5 not touching `crm-tools.ts` or `app/(admin)/crm/page.tsx` at all). `crm-tools.ts`'s existing `vi.mock("../crm/twenty-pipeline", ...)` continues to work unchanged.

The Twenty MCP server's list/get tools return Twenty's native record shape (same `id`/`name`/`stage`/`amount: {amountMicros, currencyCode}`/`pointOfContact`/`source`/`listingName`/`createdAt` fields already handled by `toOpportunity()`), wrapped in `{ records: [...], pageInfo, totalCount? }` instead of today's REST envelope `{ data: { opportunities: [...] } }` — per the server's own README ("List results are returned as `{ records, pageInfo, totalCount? }`"). `get_opportunity` returns a single record directly (not wrapped in `records`). `update_opportunity` takes `{ id, ...fields }` and returns the updated record (or throws via an `isError` MCP result on failure — surfaced by `callTwentyTool` throwing, which this task's `updateOpportunityStage` catches).

- [ ] **Step 1: Write the failing tests**

Replace the entire contents of `ads-agent/lib/crm/twenty-pipeline.test.ts`:

```typescript
// ads-agent/lib/crm/twenty-pipeline.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { callTwentyTool } = vi.hoisted(() => ({ callTwentyTool: vi.fn() }));
vi.mock("../bifrost/mcp-client", () => ({ callTwentyTool }));

import {
  PIPELINE_STAGES,
  getOpportunity,
  getPipelineValue,
  listOpportunities,
  maskPhone,
  updateOpportunityStage,
} from "./twenty-pipeline";

const originalEnv = { ...process.env };

beforeEach(() => {
  process.env.TWENTY_API_KEY = "test-key";
  callTwentyTool.mockReset();
});

afterEach(() => {
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

describe("PIPELINE_STAGES", () => {
  it("has the 7 real configured Twenty stages, in order", () => {
    expect(PIPELINE_STAGES.map((s) => s.value)).toEqual([
      "NEW_BRIEF", "SHORTLIST", "TOUR", "NEGOTIATE", "LEGAL", "HANDOVER", "RENEWAL",
    ]);
    expect(PIPELINE_STAGES[0].label).toBe("New Brief");
  });
});

describe("maskPhone", () => {
  it("masks all but the last 4 digits, keeping the country code visible", () => {
    expect(maskPhone("+918800001234")).toBe("+91 8XXXXX-1234");
  });
  it("returns an empty-safe placeholder for a missing/short number", () => {
    expect(maskPhone("")).toBe("—");
    expect(maskPhone("123")).toBe("—");
  });
});

describe("listOpportunities", () => {
  it("calls the list_opportunities MCP tool and maps records into typed rows", async () => {
    callTwentyTool.mockResolvedValue({
      records: [
        {
          id: "opp-1",
          name: "Office: Priya Sharma",
          stage: "SHORTLIST",
          tier: "HOT",
          amount: { amountMicros: 15000000000, currencyCode: "INR" },
          pointOfContact: { name: { firstName: "Priya", lastName: "Sharma" }, phones: { primaryPhoneNumber: "8800001234", primaryPhoneCallingCode: "+91" } },
          source: "WhatsApp",
          listingName: "Koramangala",
          createdAt: "2026-08-01T00:00:00.000Z",
        },
      ],
      pageInfo: {},
    });

    const rows = await listOpportunities();

    expect(callTwentyTool).toHaveBeenCalledWith("list_opportunities", { limit: 200 });
    expect(rows).toEqual([
      {
        id: "opp-1", name: "Office: Priya Sharma", stage: "SHORTLIST", tier: "HOT",
        amountInr: 15000, contactName: "Priya Sharma", maskedPhone: "+91 8XXXXX-1234",
        source: "WhatsApp", listingName: "Koramangala", createdAt: "2026-08-01T00:00:00.000Z",
      },
    ]);
  });

  it("returns an empty list when Twenty is not configured", async () => {
    delete process.env.TWENTY_API_KEY;
    expect(await listOpportunities()).toEqual([]);
    expect(callTwentyTool).not.toHaveBeenCalled();
  });

  it("returns an empty list when the MCP tool call throws, rather than throwing", async () => {
    callTwentyTool.mockRejectedValue(new Error('twenty mcp tool "list_opportunities" failed: 500'));
    expect(await listOpportunities()).toEqual([]);
  });
});

describe("getOpportunity", () => {
  it("calls get_opportunity with the id and maps the single record", async () => {
    callTwentyTool.mockResolvedValue({
      id: "opp-1", name: "Office: Priya Sharma", stage: "SHORTLIST", tier: "HOT",
      amount: null, pointOfContact: null, source: "WhatsApp", listingName: null,
      createdAt: "2026-08-01T00:00:00.000Z",
    });

    const row = await getOpportunity("opp-1");

    expect(callTwentyTool).toHaveBeenCalledWith("get_opportunity", { id: "opp-1" });
    expect(row?.id).toBe("opp-1");
    expect(row?.amountInr).toBeNull();
    expect(row?.contactName).toBeNull();
  });

  it("returns null when the MCP tool call throws", async () => {
    callTwentyTool.mockRejectedValue(new Error("not found"));
    expect(await getOpportunity("missing")).toBeNull();
  });
});

describe("updateOpportunityStage", () => {
  it("calls update_opportunity with id + stage and returns ok:true on success", async () => {
    callTwentyTool.mockResolvedValue({ id: "opp-1", stage: "TOUR" });

    const result = await updateOpportunityStage("opp-1", "TOUR");

    expect(result).toEqual({ ok: true });
    expect(callTwentyTool).toHaveBeenCalledWith("update_opportunity", { id: "opp-1", stage: "TOUR" });
  });

  it("returns ok:false with an error message when the MCP tool call throws", async () => {
    callTwentyTool.mockRejectedValue(new Error('twenty mcp tool "update_opportunity" failed: bad stage'));
    const result = await updateOpportunityStage("opp-1", "TOUR");
    expect(result).toEqual({ ok: false, error: expect.stringContaining("bad stage") });
  });
});

describe("getPipelineValue", () => {
  it("sums amountInr across all open opportunities", async () => {
    callTwentyTool.mockResolvedValue({
      records: [
        { id: "1", name: "A", stage: "NEW_BRIEF", tier: "HOT", amount: { amountMicros: 10000000000 }, pointOfContact: null, source: null, listingName: null, createdAt: "" },
        { id: "2", name: "B", stage: "RENEWAL", tier: "COLD", amount: { amountMicros: 5000000000 }, pointOfContact: null, source: null, listingName: null, createdAt: "" },
        { id: "3", name: "C", stage: "TOUR", tier: "WARM", amount: null, pointOfContact: null, source: null, listingName: null, createdAt: "" },
      ],
    });
    expect(await getPipelineValue()).toBe(15000);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ads-agent && npx vitest run lib/crm/twenty-pipeline.test.ts`
Expected: FAIL — `listOpportunities`/`getOpportunity`/`updateOpportunityStage` still call `global.fetch`, not the mocked `callTwentyTool`.

- [ ] **Step 3: Implement the rewrite**

In `ads-agent/lib/crm/twenty-pipeline.ts`, keep every type declaration (`PIPELINE_STAGES`, `Opportunity`, `RawOpportunity`, etc.), `maskPhone`, `toAmountInr`, `toContact`, and `toOpportunity` **exactly as they are today** — only replace `isConfigured`/`baseUrl`/`authHeaders` usage and the bodies of `listOpportunities`, `getOpportunity`, and `updateOpportunityStage`:

```typescript
import { callTwentyTool } from "../bifrost/mcp-client";
import { TWENTY_MCP_TOOLS } from "../bifrost/twenty-mcp-tools";

// ... (PIPELINE_STAGES, types, maskPhone, toAmountInr, toContact, toOpportunity unchanged) ...

function isConfigured(): boolean {
  return Boolean(process.env.TWENTY_API_KEY?.trim());
}

/** List every open opportunity, via the Twenty MCP server (github.com/mhenry3164/twenty-crm-mcp-server),
 * called directly through lib/bifrost/mcp-client.ts (no Bifrost involved — this is a plain data read,
 * not a model decision). Fails soft (empty array) on missing config or a failed tool call — same
 * fail-soft convention as before, so an outage degrades the board to "no leads" rather than a
 * crashed page. */
export async function listOpportunities(): Promise<Opportunity[]> {
  if (!isConfigured()) return [];
  try {
    const result = (await callTwentyTool(TWENTY_MCP_TOOLS.listOpportunities, { limit: 200 })) as {
      records?: RawOpportunity[];
    };
    return (result.records ?? []).map(toOpportunity);
  } catch {
    return [];
  }
}

/** Fetch a single opportunity by id via the Twenty MCP server. */
export async function getOpportunity(id: string): Promise<Opportunity | null> {
  if (!isConfigured()) return null;
  try {
    const record = (await callTwentyTool(TWENTY_MCP_TOOLS.getOpportunity, { id })) as RawOpportunity | null;
    return record ? toOpportunity(record) : null;
  } catch {
    return null;
  }
}

export type UpdateStageResult = { ok: true } | { ok: false; error: string };

/** Advance (or move back) an opportunity's stage via the Twenty MCP server. */
export async function updateOpportunityStage(
  id: string,
  stage: PipelineStageValue,
): Promise<UpdateStageResult> {
  if (!isConfigured()) return { ok: false, error: "Twenty is not configured" };
  try {
    await callTwentyTool(TWENTY_MCP_TOOLS.updateOpportunity, { id, stage });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ... (getPipelineValue unchanged — it only calls listOpportunities()) ...
```

Delete the now-unused `baseUrl()` and `authHeaders()` functions entirely (nothing else in the file calls them once the three functions above stop using raw `fetch`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ads-agent && npx vitest run lib/crm/twenty-pipeline.test.ts`
Expected: PASS (11/11).

- [ ] **Step 5: Confirm crm-tools.test.ts and the /crm admin page still pass untouched**

Run: `cd ads-agent && npx vitest run lib/openui/crm-tools.test.ts`
Expected: PASS with zero changes to that file — it mocks `../crm/twenty-pipeline` at the module level, so it never sees the MCP swap.

- [ ] **Step 6: Commit**

```bash
cd ads-agent
git add lib/crm/twenty-pipeline.ts lib/crm/twenty-pipeline.test.ts
git commit -m "feat(ads-agent): route twenty-pipeline.ts through the Twenty MCP server"
```

---

## Task 6: Build the two-phase resolve-then-generate helper (Wave 2)

**Files:**
- Create: `ads-agent/lib/openui/resolve-tools-then-generate.ts`
- Test: `ads-agent/lib/openui/resolve-tools-then-generate.test.ts`

**Interfaces:**
- Consumes: `ChatMessage`, `ChatCompletionResponse`, `ToolDefinition` types from `lib/bifrost/client.ts` (Task 3); `callMeteredChatCompletion` from `lib/metering/metered-client.ts` (already exists, unmodified); `listTwentyTools`, `callTwentyTool` from `lib/bifrost/mcp-client.ts` (Task 2); `TWENTY_MCP_READ_TOOL_NAMES` from `lib/bifrost/twenty-mcp-tools.ts` (Task 1).
- Produces: `resolveToolsThenGenerate(ctx: MeteringContext, messages: ChatMessage[]): Promise<ChatMessage[]>` — Tasks 7 and 8 call this before their existing streaming call, passing its result as the message list instead of their current plain history array.

Mutation safety is enforced structurally, not by a header allowlist (corrected during validation — see `docs/superpowers/specs/2026-08-05-mcp-backend-tool-integration-validation.md`, finding 2): this function fetches the Twenty MCP server's live schemas via `listTwentyTools()`, filters to `TWENTY_MCP_READ_TOOL_NAMES` (`list_opportunities`/`get_opportunity`), and passes *only that filtered array* as Bifrost's `tools` param — `update_opportunity`'s schema is never sent, so the model cannot request it; there is nothing to misconfigure upstream because there's no separate gateway-side filter to keep in sync. A defensive check on the returned `tool_calls` still rejects any name outside the two advertised tools, as a second gate against a hallucinated tool-call name.

- [ ] **Step 1: Write the failing tests**

```typescript
// ads-agent/lib/openui/resolve-tools-then-generate.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const { callMeteredChatCompletion, listTwentyTools, callTwentyTool } = vi.hoisted(() => ({
  callMeteredChatCompletion: vi.fn(),
  listTwentyTools: vi.fn(),
  callTwentyTool: vi.fn(),
}));
vi.mock("../metering/metered-client", () => ({ callMeteredChatCompletion }));
vi.mock("../bifrost/mcp-client", () => ({ listTwentyTools, callTwentyTool }));

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

beforeEach(() => {
  callMeteredChatCompletion.mockReset();
  listTwentyTools.mockReset().mockResolvedValue([
    ...readOnlySchemas,
    { name: "update_opportunity", description: "Update", inputSchema: { type: "object" } },
  ]);
  callTwentyTool.mockReset();
});

describe("resolveToolsThenGenerate", () => {
  it("returns the original messages unchanged when the model requests no tools", async () => {
    callMeteredChatCompletion.mockResolvedValue({
      choices: [{ message: { role: "assistant", content: "no tools needed" } }],
    });

    const result = await resolveToolsThenGenerate(ctx, baseMessages);

    expect(result).toEqual(baseMessages);
    expect(callTwentyTool).not.toHaveBeenCalled();
    const [, options] = callMeteredChatCompletion.mock.calls[0];
    expect(options.tools.map((t: { function: { name: string } }) => t.function.name)).toEqual([
      "list_opportunities",
      "get_opportunity",
    ]);
  });

  it("executes a read tool call and appends the assistant + tool messages", async () => {
    const toolCall = { id: "call_1", type: "function" as const, function: { name: "list_opportunities", arguments: "{}" } };
    callMeteredChatCompletion
      .mockResolvedValueOnce({ choices: [{ message: { role: "assistant", content: null, tool_calls: [toolCall] } }] } as never)
      .mockResolvedValueOnce({ choices: [{ message: { role: "assistant", content: "done" } }] } as never);
    callTwentyTool.mockResolvedValue([{ id: "1" }]);

    const result = await resolveToolsThenGenerate(ctx, baseMessages);

    expect(result).toEqual([
      ...baseMessages,
      { role: "assistant", content: null, tool_calls: [toolCall] },
      { role: "tool", content: JSON.stringify([{ id: "1" }]), tool_call_id: "call_1" },
    ]);
    expect(callTwentyTool).toHaveBeenCalledWith("list_opportunities", {});
    expect(callMeteredChatCompletion).toHaveBeenCalledTimes(2);
  });

  it("executes multiple read tool calls from a single round in parallel", async () => {
    const call1 = { id: "call_1", type: "function" as const, function: { name: "list_opportunities", arguments: "{}" } };
    const call2 = { id: "call_2", type: "function" as const, function: { name: "get_opportunity", arguments: '{"id":"2"}' } };
    callMeteredChatCompletion
      .mockResolvedValueOnce({ choices: [{ message: { role: "assistant", content: null, tool_calls: [call1, call2] } }] } as never)
      .mockResolvedValueOnce({ choices: [{ message: { role: "assistant", content: "done" } }] } as never);
    callTwentyTool.mockResolvedValueOnce([]).mockResolvedValueOnce({});

    const result = await resolveToolsThenGenerate(ctx, baseMessages);

    expect(result).toHaveLength(baseMessages.length + 3);
    expect(callTwentyTool).toHaveBeenCalledTimes(2);
  });

  it("rejects any tool-call name outside the two advertised read tools, and stops the loop", async () => {
    const mutatingCall = { id: "call_1", type: "function" as const, function: { name: "update_opportunity", arguments: '{"id":"1","stage":"TOUR"}' } };
    callMeteredChatCompletion.mockResolvedValue({ choices: [{ message: { role: "assistant", content: null, tool_calls: [mutatingCall] } }] } as never);

    const result = await resolveToolsThenGenerate(ctx, baseMessages);

    expect(callTwentyTool).not.toHaveBeenCalled();
    expect(result).toEqual(baseMessages);
  });

  it("stops after 2 rounds even if the model keeps requesting tools", async () => {
    const toolCall = { id: "call_1", type: "function" as const, function: { name: "list_opportunities", arguments: "{}" } };
    callMeteredChatCompletion.mockResolvedValue({ choices: [{ message: { role: "assistant", content: null, tool_calls: [toolCall] } }] } as never);
    callTwentyTool.mockResolvedValue([]);

    await resolveToolsThenGenerate(ctx, baseMessages);

    expect(callMeteredChatCompletion).toHaveBeenCalledTimes(2);
    expect(callTwentyTool).toHaveBeenCalledTimes(2);
  });

  it("returns the original messages unchanged when listing live tool schemas throws", async () => {
    listTwentyTools.mockRejectedValue(new Error("twenty-mcp-gateway unreachable"));
    const result = await resolveToolsThenGenerate(ctx, baseMessages);
    expect(result).toEqual(baseMessages);
    expect(callMeteredChatCompletion).not.toHaveBeenCalled();
  });

  it("returns the original messages unchanged when the resolve call itself throws", async () => {
    callMeteredChatCompletion.mockRejectedValue(new Error("bifrost unreachable"));
    const result = await resolveToolsThenGenerate(ctx, baseMessages);
    expect(result).toEqual(baseMessages);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ads-agent && npx vitest run lib/openui/resolve-tools-then-generate.test.ts`
Expected: FAIL — `Cannot find module './resolve-tools-then-generate'`.

- [ ] **Step 3: Implement the helper**

```typescript
// ads-agent/lib/openui/resolve-tools-then-generate.ts
import { callMeteredChatCompletion } from "../metering/metered-client";
import { callTwentyTool, listTwentyTools } from "../bifrost/mcp-client";
import { TWENTY_MCP_READ_TOOL_NAMES } from "../bifrost/twenty-mcp-tools";
import type { ChatMessage, ToolDefinition } from "../bifrost/client";
import type { MeteringContext } from "../metering/types";

const MAX_ROUNDS = 2;

/**
 * Phase 1 of the two-phase MCP tool pattern (see
 * docs/superpowers/specs/2026-08-05-mcp-backend-tool-integration-design.md): fetches the Twenty MCP
 * server's live tool schemas, filters to the read-only subset, and lets the model request them via
 * a plain OpenAI-compatible `tools` param on a non-streaming Bifrost call — no AI-gateway-specific
 * MCP feature involved (see the validation doc for why). Tool calls are executed directly against
 * the Twenty MCP server via lib/bifrost/mcp-client.ts, and results are appended as `tool` messages,
 * ready for the caller's existing streaming generate call. Never throws: any failure (MCP server
 * unreachable, Bifrost unreachable, tool execution error) returns the input messages unchanged, so
 * the caller's Phase 2 proceeds with whatever context is available rather than failing the turn.
 */
export async function resolveToolsThenGenerate(
  ctx: MeteringContext,
  messages: ChatMessage[],
): Promise<ChatMessage[]> {
  let readOnlyTools: ToolDefinition[];
  try {
    const liveSchemas = await listTwentyTools();
    readOnlyTools = liveSchemas
      .filter((schema) => (TWENTY_MCP_READ_TOOL_NAMES as readonly string[]).includes(schema.name))
      .map((schema) => ({
        type: "function" as const,
        function: { name: schema.name, description: schema.description, parameters: schema.inputSchema },
      }));
  } catch {
    return messages;
  }

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
        toolCalls.map(async (call) => ({
          role: "tool" as const,
          content: JSON.stringify(await callTwentyTool(call.function.name, JSON.parse(call.function.arguments))),
          tool_call_id: call.id,
        })),
      );
      history = [...history, ...results];
    } catch {
      return messages;
    }
  }

  return history;
}
```

Note the advertised-name filter happens before deciding whether `toolCalls.length === 0` — a response containing *only* an unadvertised/hallucinated call is treated identically to a response with no tool calls at all (the loop breaks, nothing is appended, `messages` flows through unchanged for that round). This matches the "rejects any tool-call name outside the two advertised read tools" test case above.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ads-agent && npx vitest run lib/openui/resolve-tools-then-generate.test.ts`
Expected: PASS (7/7).

- [ ] **Step 5: Commit**

```bash
cd ads-agent
git add lib/openui/resolve-tools-then-generate.ts lib/openui/resolve-tools-then-generate.test.ts
git commit -m "feat(ads-agent): add two-phase MCP resolve-then-generate helper"
```

---

## Task 7: Wire the two-phase pattern into Copilot (Wave 3)

**Files:**
- Modify: `ads-agent/lib/decision-engine/copilot-chat.ts`
- Modify: `ads-agent/components/copilot/CopilotPanel.tsx`
- Test: `ads-agent/lib/decision-engine/copilot-chat.test.ts` (create if it does not already exist; check first)

**Interfaces:**
- Consumes: `resolveToolsThenGenerate` from `lib/openui/resolve-tools-then-generate.ts` (Task 6).
- Produces: nothing other tasks depend on (this is a leaf wiring task; Task 9 exercises it end-to-end).

- [ ] **Step 1: Check whether copilot-chat.ts already has a test file**

Run: `cd ads-agent && ls lib/decision-engine/copilot-chat.test.ts 2>/dev/null || echo "no existing test file"`. If it exists, read it fully first and follow its existing mocking conventions instead of the pattern below; if not, use the pattern below.

- [ ] **Step 2: Write the failing test**

```typescript
// ads-agent/lib/decision-engine/copilot-chat.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const { resolveToolsThenGenerate, getSession } = vi.hoisted(() => ({
  resolveToolsThenGenerate: vi.fn(),
  getSession: vi.fn(),
}));
vi.mock("../openui/resolve-tools-then-generate", () => ({ resolveToolsThenGenerate }));
vi.mock("../auth/dal", () => ({ getSession }));
vi.mock("../metering/metered-stream-client", () => ({
  callMeteredStreamingChatCompletion: vi.fn(async function* () {
    yield { type: "delta", content: "root = OpportunityList([])" };
  }),
}));

import { draftCopilotReply } from "./copilot-chat";

beforeEach(() => {
  process.env.BIFROST_BASE_URL = "http://localhost:8080";
  resolveToolsThenGenerate.mockReset();
  getSession.mockReset().mockResolvedValue(null);
});

describe("draftCopilotReply", () => {
  it("calls resolveToolsThenGenerate before streaming, and streams its result forward", async () => {
    resolveToolsThenGenerate.mockImplementation(async (_ctx, messages) => [
      ...messages,
      { role: "tool", content: "[{\"id\":\"1\"}]", tool_call_id: "call_1" },
    ]);

    const events = [];
    for await (const ev of draftCopilotReply({ history: [], userMessage: "show me hot leads" })) {
      events.push(ev);
    }

    expect(resolveToolsThenGenerate).toHaveBeenCalledTimes(1);
    const [, messagesArg] = resolveToolsThenGenerate.mock.calls[0];
    expect(messagesArg.at(-1)).toEqual({ role: "user", content: "show me hot leads" });
    expect(events.some((e) => e.type === "done")).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd ads-agent && npx vitest run lib/decision-engine/copilot-chat.test.ts`
Expected: FAIL — `draftCopilotReply` doesn't call `resolveToolsThenGenerate` yet.

- [ ] **Step 4: Update copilot-chat.ts**

In `ads-agent/lib/decision-engine/copilot-chat.ts`:

1. Add the import: `import { resolveToolsThenGenerate } from "../openui/resolve-tools-then-generate";`
2. In `buildSystemPrompt()`, replace the CRM-related lines. Change:
   ```typescript
   tools: platformToolSpecs.filter((t) => t.name !== "advance_opportunity_stage"),
   toolExamples: [
     `root = SetupCard("Here's a Whitefield draft at ₹500/day.", "ready", "Whitefield", 500, "HSR seekers", [], ["Headline 1", "Headline 2", "Headline 3"], ["Description one."], "https://www.gentlespacesolutions.com/spaces")`,
     `leads = Query("list_opportunities", {}, [])`,
     `root = OpportunityList(@Each(leads, "lead", {name: lead.name, stage: lead.stage, tier: lead.tier, amountLabel: "" + lead.amountInr, maskedPhone: lead.maskedPhone, source: lead.source}))`,
   ],
   ```
   to:
   ```typescript
   tools: platformToolSpecs.filter(
     (t) => !["advance_opportunity_stage", "list_opportunities", "get_opportunity", "search_opportunities"].includes(t.name),
   ),
   toolExamples: [
     `root = SetupCard("Here's a Whitefield draft at ₹500/day.", "ready", "Whitefield", 500, "HSR seekers", [], ["Headline 1", "Headline 2", "Headline 3"], ["Description one."], "https://www.gentlespacesolutions.com/spaces")`,
     `root = OpportunityList([{name: "Office: Priya Sharma", stage: "SHORTLIST", tier: "HOT", amountLabel: "15000", maskedPhone: "+91 8XXXXX-1234", source: "WhatsApp"}])`,
   ],
   ```
3. Add a new line to `additionalRules`, immediately after the `"When the user asks to create, start, or sample a campaign..."` rule:
   ```typescript
   "CRM opportunity/lead data (if relevant to this question) is already provided to you above as a " +
     "tool result — build OpportunityList/OpportunityCard directly from that data, reshaping each " +
     "row into the component's exact prop names (see the worked example). Do not call Query() for " +
     "opportunity data; it is not fetched that way anymore.",
   ```
4. Change the line `"Use Query() only with the registered tools. For stage moves, ALWAYS render StageChangeConfirm "` + `"(include opportunityId) and wait for the user to click Confirm — the Confirm button PATCHes "` + `"the stage route; do not call advance_opportunity_stage yourself."` to:
   ```typescript
   "For stage moves, ALWAYS render StageChangeConfirm (include opportunityId) and wait for the " +
     "user to click Confirm — the Confirm button PATCHes the stage route; do not call " +
     "advance_opportunity_stage yourself. Use Query() only for start_campaign_draft's Mutation() " +
     "and the analytics tools (get_spend_cpl_trend, list_campaigns_with_cpl, list_pending_proposals).",
   ```
5. In `draftCopilotReply`, insert the resolve step before building `messages` for the model — the function currently builds `messages` once and passes it straight to `runCopilotModel`. Change:
   ```typescript
   const messages: ChatMessage[] = [
     { role: "system", content: buildSystemPrompt() },
     ...input.history.map((m) => ({ role: m.role, content: m.content })),
     { role: "user", content: input.userMessage },
   ];

   let raw: string;
   try {
     raw = yield* runCopilotModel(ctx, messages);
   ```
   to:
   ```typescript
   const baseMessages: ChatMessage[] = [
     { role: "system", content: buildSystemPrompt() },
     ...input.history.map((m) => ({ role: m.role, content: m.content })),
     { role: "user", content: input.userMessage },
   ];
   const messages = await resolveToolsThenGenerate(ctx, baseMessages);

   let raw: string;
   try {
     raw = yield* runCopilotModel(ctx, messages);
   ```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd ads-agent && npx vitest run lib/decision-engine/copilot-chat.test.ts`
Expected: PASS.

- [ ] **Step 6: Trim the dead CRM read tool names from CopilotPanel.tsx**

In `ads-agent/components/copilot/CopilotPanel.tsx`, change:
```typescript
const copilotToolProvider = createHttpToolProvider([
  "start_campaign_draft",
  "list_opportunities",
  "search_opportunities",
  "get_opportunity",
  "get_spend_cpl_trend",
  "list_campaigns_with_cpl",
  "list_pending_proposals",
]);
```
to:
```typescript
const copilotToolProvider = createHttpToolProvider([
  "start_campaign_draft",
  "get_spend_cpl_trend",
  "list_campaigns_with_cpl",
  "list_pending_proposals",
]);
```
The model no longer emits `Query("list_opportunities"/"search_opportunities"/"get_opportunity", ...)` per the updated system prompt (Step 4), so these three names would never be invoked through this client-side path anyway — this just removes dead, potentially-misleading wiring.

- [ ] **Step 7: Commit**

```bash
cd ads-agent
git add lib/decision-engine/copilot-chat.ts lib/decision-engine/copilot-chat.test.ts components/copilot/CopilotPanel.tsx
git commit -m "feat(ads-agent): wire Copilot through the MCP resolve-then-generate pattern"
```

---

## Task 8: Wire the two-phase pattern into CRM Assistant (Wave 3)

**Files:**
- Modify: `ads-agent/lib/decision-engine/crm-chat.ts`
- Modify: `ads-agent/components/CrmAssistantPanel.tsx`
- Test: `ads-agent/lib/decision-engine/crm-chat.test.ts` (create if it does not already exist; check first, same as Task 7 Step 1)

**Interfaces:**
- Consumes: `resolveToolsThenGenerate` from `lib/openui/resolve-tools-then-generate.ts` (Task 6).
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Check for an existing test file**

Run: `cd ads-agent && ls lib/decision-engine/crm-chat.test.ts 2>/dev/null || echo "no existing test file"`. Follow its conventions if present; otherwise use the pattern below (identical shape to Task 7's).

- [ ] **Step 2: Write the failing test**

```typescript
// ads-agent/lib/decision-engine/crm-chat.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const { resolveToolsThenGenerate, getSession } = vi.hoisted(() => ({
  resolveToolsThenGenerate: vi.fn(),
  getSession: vi.fn(),
}));
vi.mock("../openui/resolve-tools-then-generate", () => ({ resolveToolsThenGenerate }));
vi.mock("../auth/dal", () => ({ getSession }));
vi.mock("../metering/metered-stream-client", () => ({
  callMeteredStreamingChatCompletion: vi.fn(async function* () {
    yield { type: "delta", content: "root = OpportunityList([])" };
  }),
}));

import { draftCrmChatReply } from "./crm-chat";

beforeEach(() => {
  process.env.BIFROST_BASE_URL = "http://localhost:8080";
  resolveToolsThenGenerate.mockReset();
  getSession.mockReset().mockResolvedValue(null);
});

describe("draftCrmChatReply", () => {
  it("calls resolveToolsThenGenerate before streaming, and streams its result forward", async () => {
    resolveToolsThenGenerate.mockImplementation(async (_ctx, messages) => [
      ...messages,
      { role: "tool", content: "[{\"id\":\"1\"}]", tool_call_id: "call_1" },
    ]);

    const events = [];
    for await (const ev of draftCrmChatReply({ history: [], userMessage: "show me hot leads" })) {
      events.push(ev);
    }

    expect(resolveToolsThenGenerate).toHaveBeenCalledTimes(1);
    const [, messagesArg] = resolveToolsThenGenerate.mock.calls[0];
    expect(messagesArg.at(-1)).toEqual({ role: "user", content: "show me hot leads" });
    expect(events.some((e) => e.type === "done")).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd ads-agent && npx vitest run lib/decision-engine/crm-chat.test.ts`
Expected: FAIL — same reason as Task 7.

- [ ] **Step 4: Update crm-chat.ts**

In `ads-agent/lib/decision-engine/crm-chat.ts`:

1. Add the import: `import { resolveToolsThenGenerate } from "../openui/resolve-tools-then-generate";`
2. In `buildSystemPrompt()`, change:
   ```typescript
   tools: crmToolSpecs.filter((t) => t.name !== "advance_opportunity_stage"),
   toolExamples: [
     `leads = Query("list_opportunities", {}, [])`,
     `root = OpportunityList(@Each(leads, "lead", {name: lead.name, stage: lead.stage, tier: lead.tier, amountLabel: "" + lead.amountInr, maskedPhone: lead.maskedPhone, source: lead.source}))`,
   ],
   ```
   to:
   ```typescript
   tools: [],
   toolExamples: [
     `root = OpportunityList([{name: "Office: Priya Sharma", stage: "SHORTLIST", tier: "HOT", amountLabel: "15000", maskedPhone: "+91 8XXXXX-1234", source: "WhatsApp"}])`,
   ],
   ```
3. Replace the line `"Use Query() for list/search/get opportunity tools; reshape each tool row into the exact "` + `"OpportunityCard field names via @Each(rows, \"lead\", {...}) — the tool's own field names (e.g. "` + `"amountInr) do not match the component's props, so passing rows through unreshaped will "` + `"fail to render. For stage moves, render StageChangeConfirm with opportunityId, "` + `"opportunityName, fromStage, toStage — never call advance_opportunity_stage yourself; the "` + `"Confirm button PATCHes the stage route."` with:
   ```typescript
   "Opportunity/lead data is already provided to you above as a tool result — reshape each row " +
     "into the exact OpportunityCard/OpportunityList prop names (see the worked example); the " +
     "tool's own field names (e.g. amountInr) do not match the component's props, so passing rows " +
     "through unreshaped will fail to render. Do not call Query() for opportunity data; it is not " +
     "fetched that way anymore. For stage moves, render StageChangeConfirm with opportunityId, " +
     "opportunityName, fromStage, toStage — never call advance_opportunity_stage yourself; the " +
     "Confirm button PATCHes the stage route.",
   ```
4. In `draftCrmChatReply`, apply the identical change as Task 7 Step 4.5 — insert `const messages = await resolveToolsThenGenerate(ctx, baseMessages);` between building `baseMessages` and calling `runCrmModel`.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd ads-agent && npx vitest run lib/decision-engine/crm-chat.test.ts`
Expected: PASS.

- [ ] **Step 6: Remove the now-empty tool wiring from CrmAssistantPanel.tsx**

All three tools `CrmAssistantPanel.tsx` previously wired (`list_opportunities`, `search_opportunities`, `get_opportunity`) are CRM reads the model no longer calls via `Query()`. Change:
```typescript
import { createHttpToolProvider } from "@/lib/openui/http-tool-provider";
```
```typescript
/** Names only — do not import crm-tools (pulls Twenty/pg into the client bundle). */
const crmChatToolProvider = createHttpToolProvider([
  "list_opportunities",
  "search_opportunities",
  "get_opportunity",
]);
```
to remove the import and the constant entirely, and update both `<Renderer toolProvider={crmChatToolProvider} ...>` usages to `toolProvider={{}}` (an empty tool map — the CRM Assistant's Renderer no longer needs to execute any Query()/Mutation() calls, since stage moves already bypass it via StageChangeConfirm's own PATCH button, not `Mutation()`).

- [ ] **Step 7: Commit**

```bash
cd ads-agent
git add lib/decision-engine/crm-chat.ts lib/decision-engine/crm-chat.test.ts components/CrmAssistantPanel.tsx
git commit -m "feat(ads-agent): wire CRM Assistant through the MCP resolve-then-generate pattern"
```

---

## Task 9: Live smoke extension + four-surface regression check (Wave 4)

**Files:**
- Modify: `ads-agent/lib/openui/openui-live-smoke.test.ts`
- Test: itself (this task's deliverable is the test file)

**Interfaces:**
- Consumes: `draftCrmChatReply`, `draftCopilotReply` (now MCP-backed for CRM), `draftReportsChatReply`, `draftCampaignChatReply` (both unchanged, regression-only) — all four already imported by this file today.
- Produces: nothing further downstream; this is the final task.

- [ ] **Step 1: Add MCP-grounding assertions to the existing CRM and Copilot smoke cases**

In `ads-agent/lib/openui/openui-live-smoke.test.ts`, the existing `"crm: show me hot leads"` and `"copilot: what's my pipeline value?"` cases only assert the reply is non-empty and not the generic parse-fail message. Strengthen both to also assert the reply contains no leftover `Query("list_opportunities"` (which would mean the system-prompt change in Tasks 7/8 didn't take, and the model is still emitting the old placeholder pattern the client Renderer can no longer resolve for CRM reads):

```typescript
  it(
    "crm: show me hot leads — no generic parse fail, no stale Query() placeholder",
    async () => {
      const reply = await drainDone(
        draftCrmChatReply({ history: [], userMessage: "show me hot leads" }),
      );
      expect(reply.length).toBeGreaterThan(0);
      expect(reply).not.toMatch(GENERIC_FAIL);
      expect(reply).not.toContain('Query("list_opportunities"');
      expect(reply).not.toContain('Query("get_opportunity"');
    },
    60_000,
  );
```

```typescript
  it(
    "copilot: what's my pipeline value? — no generic parse fail, no stale Query() placeholder",
    async () => {
      const reply = await drainDone(
        draftCopilotReply({ history: [], userMessage: "what's my pipeline value?" }),
      );
      expect(reply.length).toBeGreaterThan(0);
      expect(reply).not.toMatch(GENERIC_FAIL);
      expect(reply).not.toContain('Query("list_opportunities"');
      expect(reply).not.toContain('Query("get_opportunity"');
    },
    60_000,
  );
```

Replace the two existing `it(...)` blocks with these (same `describe`, same `LIVE` skip guard — do not change the file's `describe.skipIf(!LIVE)` wrapper or the other two surfaces' tests).

- [ ] **Step 2: Run the live smoke suite against the real stack**

Requires Twenty CRM, Bifrost, and the `twenty-mcp-gateway` sidecar all running (Task 1's Step 3).

```bash
cd ads-agent
export TWENTY_API_KEY="$(grep '^TWENTY_API_KEY=' .env.local | cut -d= -f2-)"
export TWENTY_BASE_URL="$(grep '^TWENTY_BASE_URL=' .env.local | cut -d= -f2-)"
docker compose up -d twenty-mcp-gateway bifrost
OPENUI_LIVE_SMOKE=1 npx vitest run lib/openui/openui-live-smoke.test.ts
```

Expected: all 4 tests PASS, including the two strengthened ones. If the CRM or Copilot case fails on the new `not.toContain` assertions, re-check Task 7/8 Step 4's system-prompt edits landed correctly — this is the regression this task exists to catch.

- [ ] **Step 3: Manually verify the two unchanged surfaces still work (regression guard)**

This is the check for the plan's most important invariant: Reports Chat and Campaign Chat/Copilot's campaign-draft mutation must be completely unaffected by everything in Waves 1–3. Unlike the original plan's `disable_auto_tool_inject` gateway-side gate, this now holds for the simplest possible reason: `reports-chat.ts` and `campaign-chat.ts` never import `lib/bifrost/mcp-client.ts` or `resolve-tools-then-generate.ts` at all, so they have no code path that could reach the Twenty MCP server even by mistake.

```bash
cd ads-agent
npm run dev &
sleep 5
curl -s -X POST http://localhost:3000/api/reports/chat \
  -H "Content-Type: application/json" \
  -d '{"content": "show CPL trend this week", "history": []}' | head -c 500
```

Expected: a streamed OpenUI-lang response referencing `TrendChart`, with no error about missing tools and no connection attempt to `twenty-mcp-gateway` in `docker compose logs twenty-mcp-gateway` for this request.

- [ ] **Step 4: Commit**

```bash
cd ads-agent
git add lib/openui/openui-live-smoke.test.ts
git commit -m "test(ads-agent): strengthen live smoke to catch stale CRM Query() placeholders"
```

---

## Self-Review Notes (completed during planning, not a task)

- **Spec coverage:** Every "Goals" item in the design spec has a task — Twenty MCP reads/mutations (Tasks 1, 5), OpenUI tool-execution hop replaced for CRM (Tasks 6, 7, 8), Meta/Google Ads documented (Task 4), mutation safety preserved (Task 6's structural filter + Task 9's regression check). The design spec's Migration step 5 ("remove http-tool-provider.ts") was found inaccurate during planning — corrected in this plan's Global Constraints, since Reports Chat and Copilot's campaign-draft mutation still need it; no task removes those files.
- **Type consistency:** `ChatMessage`/`ToolCall`/`ToolDefinition` (Task 3) → consumed identically by `resolve-tools-then-generate.ts` (Task 6), which builds `ToolDefinition[]` from `mcp-client.ts`'s (Task 2) `McpToolSchema` results. `TWENTY_MCP_TOOLS`/`TWENTY_MCP_READ_TOOL_NAMES`/`TWENTY_MCP_URL` (Task 1) are the single source of truth for tool-name strings and the gateway address — Tasks 2, 5, and 6 import them, never re-declare them.
- **Validation pass (2026-08-05):** researched against official sources and applied two corrections — Streamable HTTP instead of the deprecated SSE transport, and the official `@modelcontextprotocol/client` SDK called directly instead of Bifrost's proprietary MCP Gateway feature (removes a config section, a custom header, and a live tool-naming-discovery step from Task 1, net negative code). Full findings: `docs/superpowers/specs/2026-08-05-mcp-backend-tool-integration-validation.md`.
- **No placeholders:** the one genuinely unverifiable detail (Bifrost's exact function-calling name format for MCP tools) is resolved by a live curl check with a concrete expected value in Task 1 Step 4, not left as a guess.
