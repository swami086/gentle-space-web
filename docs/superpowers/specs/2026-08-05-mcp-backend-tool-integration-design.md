# MCP-only backend tool integration — design

**Date:** 2026-08-05
**Status:** Draft, awaiting review
**Scope:** `ads-agent` only. The root Gentle Space app has no AI-copilot tool-calling surface (confirmed via `torbit` — no `openui`/`copilot` references outside `ads-agent`), so there is nothing to migrate there.

## Problem

`ads-agent`'s four AI chat surfaces (Copilot, CRM Assistant, Campaign Chat, Reports Chat) currently reach external services through hand-written connectors that speak each vendor's REST/SDK directly:

- `lib/connectors/twenty.ts` + `lib/crm/twenty-pipeline.ts` — raw `fetch()` against Twenty's REST API with a static Bearer key.
- `lib/connectors/meta.ts` — Meta Marketing API (unconfigured today, no credentials in `.env.local`).
- `lib/connectors/google-ads.ts` — Google Ads API (unconfigured today, no credentials in `.env.local`).

On top of that, tool *execution* for the OpenUI chat surfaces is a second custom layer: `lib/openui/{crm,analytics,campaign,platform}-tools.ts` declare `ToolSpec`s and a `ToolProviderMap`, and the client-side `http-tool-provider.ts` turns each OpenUI-lang `Query()`/`Mutation()` call into a `POST /api/openui/tools`, which dispatches back into the same tool-provider map on the server. Two bespoke integration layers, one per vendor connector and one per tool-execution hop.

The directive: **replace both with MCP**, so that "AI copilots integrate to external tools via MCP only on the backend" — no custom connector code talking to vendor REST APIs, and no MCP protocol ever reaching the browser.

## Why MCP is viable here (research findings)

- **Bifrost (already our AI gateway) has a first-class MCP Gateway**: MCP Client support for STDIO/HTTP/SSE servers, explicit (non-autonomous by default) tool execution via `POST /v1/mcp/tool/execute`, and optional Agent Mode for auto-execution. This is configuration, not new infrastructure.
- **Real MCP servers exist for all three vendors we integrate**:
  - **Twenty CRM**: native MCP is a *Twenty Cloud* feature (OAuth), not available for our self-hosted instance. A community OSS server (`mhenry3164/twenty-crm-mcp-server`, 86 stars, CRUD + dynamic schema discovery against any Twenty REST API + key) covers self-hosted instances like ours.
  - **Google Ads**: Google publishes an official MCP server (`developers.google.com/google-ads/api/docs/developer-toolkit/mcp-server`).
  - **Meta Ads**: Meta launched an official hosted MCP endpoint (`mcp.facebook.com/ads`, OAuth, 29 tools) in April 2026.
- **Agent Mode is incompatible with streaming** (`chat_stream`/`responses_stream` aren't supported per Bifrost's own docs), which would break the token-by-token UX all four chat surfaces have today. We avoid Agent Mode and drive tool resolution ourselves (see Architecture) so streaming is untouched.

## Goals

1. Twenty CRM reads and mutations go through an MCP server instead of raw REST in `twenty-pipeline.ts`.
2. The OpenUI tool-execution hop (`Query()`/`Mutation()` → client `toolProvider` → `/api/openui/tools`) is replaced by server-side MCP tool resolution that happens *before* the model streams its response, removing the client-side execution step for reads entirely.
3. Meta Ads and Google Ads integration points are documented against their official MCP servers so wiring them up later is a credentials-and-config change, not a design change.
4. The existing mutation-safety invariant — no CRM/campaign mutation happens without an explicit human click — is preserved exactly, unchanged.

## Non-goals

- Migrating Meta/Google Ads to live MCP servers now — no credentials exist for either today (`.env.example` ships both as empty), so there's nothing to cut over or test. Documented, not implemented, in this pass.
- Migrating Twenty Cloud / OAuth. We stay self-hosted; the community MCP server is the mechanism for that.
- Touching `campaign-chat.ts`'s `SetupCard` flow — it has no tool calls today (per `docs/superpowers/specs/2026-08-05-openui-generate-execute-alignment-design.md`), so it's out of scope here too.
- Bifrost Agent Mode / autonomous multi-step tool loops. We do single-round, backend-orchestrated resolution (see below), not an autonomous agent.

## Architecture

### Two-phase call pattern (replaces the single streaming call)

Every chat generator (`copilot-chat.ts`, `crm-chat.ts`, `reports-chat.ts`) currently does one streaming call. It becomes two calls through a new shared helper, `lib/openui/resolve-tools-then-generate.ts`:

**Phase 1 — Resolve (non-streaming, invisible to the user).**
Call Bifrost `POST /v1/chat/completions` (no `stream`) with `tools` = the MCP-discovered tool list for that surface (e.g. `twenty_list_opportunities`, `twenty_search_opportunities`, `twenty_get_opportunity` for CRM/Copilot). If the model returns `tool_calls`:
- For every **read-only** tool call: execute via Bifrost `POST /v1/mcp/tool/execute`, in parallel, append each result as a `role: "tool"` message.
- For every **mutating** tool call (`twenty_update_opportunity_stage`, or any `advance_opportunity_stage`-equivalent): **do not execute it.** Drop it from the loop entirely — mutations are never triggered by model output, only by a human clicking a rendered confirm component. This is a hard rule, not a per-tool config toggle, so a future new mutating tool doesn't silently become auto-executable by omission.
- Loop up to 2 rounds (covers "list, then get details on one" chains) or until no more read tool calls appear.

**Phase 2 — Generate (streaming, unchanged UX).**
Re-send the full conversation — now grounded with real tool results as `tool` messages — as today's normal streaming `chatCompletion`. The model emits OpenUI-lang directly against real data; system prompts drop the `Query("list_opportunities", {}, [])` placeholder pattern since the data is already in context (e.g. `leads = [...]` inlined, or the model composes the component directly from the tool result already visible to it).

This keeps mutation confirmation exactly as it is today: `StageChangeConfirm`'s Confirm button still `PATCH`es `/api/crm/opportunities/[id]/stage` directly from the client — that route's *internals* switch from calling `twenty-pipeline.ts`'s raw `fetch()` to calling the Twenty MCP server, but the human-in-the-loop UX doesn't move.

### Component mapping

| Today | Becomes |
|---|---|
| `lib/connectors/twenty.ts` (`fetchLeadSignal`), `lib/crm/twenty-pipeline.ts` (`listOpportunities`, `getOpportunity`, `updateOpportunityStage`) — raw `fetch()` + Bearer key | Same function signatures, bodies replaced with calls to the Twenty MCP server via Bifrost's `/v1/mcp/tool/execute` — confirmed as the right call for *both* chat-triggered and non-chat server reads (Open Question 1 resolved: `/v1/mcp/tool/execute` needs no preceding chat completion at all, so there's no need for a second, lighter direct-MCP-client code path). |
| `lib/connectors/meta.ts`, `lib/connectors/google-ads.ts` | Unchanged for now (Non-goal). Target: MCP client calls to `mcp.facebook.com/ads` and Google's official Ads MCP server, once credentials exist. |
| `lib/openui/crm-tools.ts` (`crmToolProvider`, `crmToolSpecs`), `analytics-tools.ts`, `campaign-tools.ts`'s read tools, `platform-tools.ts`'s `ToolProviderMap` composition | `crm-tools.ts` is retired for reads at the *chat* layer only — its exports are unchanged (it still mocks `twenty-pipeline.ts` in tests) and it stays registered in `platformToolProvider` for `analytics-tools.ts`'s and `campaign-tools.ts`'s sake (see next row). No `mcp-tool-registry.ts` is needed: Bifrost auto-discovers the MCP server's tool schemas itself once the client is registered — the app's Phase 1 caller only needs the tool *names* (a small constants file, `lib/bifrost/twenty-mcp-tools.ts`) to build the `x-bf-mcp-include-tools` allowlist header, not full re-declared schemas. |
| `lib/openui/http-tool-provider.ts` (`createHttpToolProvider`) + `app/api/openui/tools/route.ts` | **Kept, not removed** (correction from an earlier draft of this section) — Reports Chat's analytics tools and Copilot's `start_campaign_draft` mutation still call through this path unchanged (both are explicit non-goals). Only the three CRM read tool names (`list_opportunities`, `search_opportunities`, `get_opportunity`) are trimmed out of the two client components (`CopilotPanel.tsx`, `CrmAssistantPanel.tsx`) that no longer emit `Query()` calls for them. |
| `copilot-chat.ts` / `crm-chat.ts` single `runXModel()` streaming call | Each calls the shared `resolveToolsThenGenerate()` for Phase 1, then their existing streaming generator for Phase 2. `reports-chat.ts` is unchanged (see next row). |
| `campaign-chat.ts`, `reports-chat.ts` | Unchanged (Non-goal — analytics tools query our own Postgres, not an external vendor). |

### Infrastructure

Add a `twenty-mcp-gateway` service to `ads-agent/docker-compose.yml`, alongside `bifrost`: `supercorp/supergateway` bridging the community `mhenry3164/twenty-crm-mcp-server` (npx-run, **stdio-only** — confirmed from its README, no built-in HTTP/SSE mode) to SSE, configured with `TWENTY_BASE_URL`/`TWENTY_API_KEY` (same values already in `ads-agent/.env.local`; `TWENTY_BASE_URL` needs `host.docker.internal` from inside the container, not `localhost`). Register it as an MCP client in `ads-agent/bifrost/config.json`'s `mcp.client_configs` with `connection_type: "sse"` (Open Question 2 resolved: the community server is stdio-only, and Bifrost's own Docker image has no `npx`/`node` to spawn a stdio subprocess itself — Bifrost's docs explicitly recommend "use HTTP/SSE connections to externally hosted MCP servers" for exactly this case — hence the `supergateway` sidecar rather than a custom Bifrost image). `tools_to_execute` is `["list_opportunities", "get_opportunity", "update_opportunity"]` — scoped to exactly what this app uses, not `["*"]` (the community server also exposes person/company/note/task/batch CRUD tools this app never calls). `mcp.tool_manager_config.disable_auto_tool_inject: true` is set globally so these tools are invisible to every Bifrost request except ones sending the `x-bf-mcp-include-tools` allowlist header — this is the mechanism that keeps Reports Chat, Campaign Chat, and Phase 2's streaming calls from ever seeing a `twenty_*` tool. No `tools_to_auto_execute` (we drive execution ourselves in Phase 1, not Bifrost's Agent Mode).

## Data flow example: "show me hot leads"

```
Copilot backend → Bifrost POST /v1/chat/completions
                     (header: x-bf-mcp-include-tools: twenty-list_opportunities,twenty-get_opportunity, stream=false)
                 ← tool_calls: [{ id: "call_1", function: { name: "twenty_list_opportunities", arguments: "{}" } }]
Copilot backend → Bifrost POST /v1/mcp/tool/execute ({ id: "call_1", function: { name: "twenty_list_opportunities", ... } })
                 ← { role: "tool", content: "[...9 real opportunities...]", tool_call_id: "call_1" }
Copilot backend → Bifrost POST /v1/chat/completions (stream=true, history + tool result appended, no include-tools header)
                 ← streams: root = OpportunityList([...9 real rows, no Query() placeholder...])
Client Renderer  → renders directly. No fetch to /api/openui/tools.
```

(The `tools` the model can call aren't passed explicitly in the request body — Bifrost auto-discovers the MCP server's schemas once the client is registered; `x-bf-mcp-include-tools` only filters *which* of those discovered tools are visible for this one request, per `mcp.tool_manager_config.disable_auto_tool_inject: true` above.)

## Error handling

- **MCP server unreachable / tool execution error/timeout** (Bifrost returns `tool_execution_error` or the request times out): Phase 1 loop breaks after the failed attempt; Phase 2 proceeds with whatever `tool` messages were successfully collected (possibly none). The model is instructed (system prompt addition) to say plainly it couldn't reach the CRM rather than fabricate data — this is strictly better than today's failure mode, where a missing/broken client-side `Query()` execution could render a plausible-looking but fake `StatCard`.
- **Bifrost itself unreachable**: unchanged — `isBifrostConfigured()` / connection failure produces the existing "Copilot is unavailable right now" message.
- **Model emits a mutating tool call anyway**: defense in depth, two independent gates. First, `x-bf-mcp-include-tools` is a strict allowlist of read-only tools for Phase 1's resolve call — the mutating tool is never even advertised to the model. Second, `resolveToolsThenGenerate()` additionally filters any returned `tool_calls` entry matching the mutating tool's name before executing anything, so even a Bifrost misconfiguration upstream can't cause a silent mutation. If the model didn't also render the expected confirm component, that surfaces as an unhelpful reply, not a security gap — the PATCH route still requires a human click either way.
- **The Twenty MCP server's tool list drifts** (e.g. it adds/renames tools on a version update): Phase 1 tool-call requests for an unknown/renamed tool name fail at Bifrost's `/v1/mcp/tool/execute` with `"tool not found"` — surfaced the same way as any other tool execution error above, not a crash.

## Testing

- **Unit**: `resolve-tools-then-generate.test.ts` mocks the Bifrost HTTP client (same shape as today's `crm-tools.test.ts` mocks) to verify: read tool calls execute and their results get appended as `tool` messages; mutating tool calls are dropped, never reach `/v1/mcp/tool/execute`; the 2-round cap is respected.
- **Live smoke**: extend `lib/openui/openui-live-smoke.test.ts` to run against real Bifrost + the real `twenty-mcp` container (already how the existing live smoke suite works against live Bifrost), asserting a "show me hot leads" turn returns real opportunity data end to end.
- **Regression**: existing `crm-tools.test.ts` / `twenty-pipeline.test.ts` unit tests get rewritten to assert against the new MCP-backed function bodies (same exported function signatures — `listOpportunities()`, `getOpportunity()`, `updateOpportunityStage()` — so callers like `app/(admin)/crm/page.tsx` need zero changes).
- **Meta/Google Ads**: contract/type tests only (mocked tool schemas), since there's nothing live to smoke-test.

## Migration / rollout order

1. Stand up the `twenty-mcp-gateway` sidecar (`supergateway` + the community server) + Bifrost MCP client config. Verify with a raw `curl` against `/v1/mcp/tool/execute` before touching app code (same verification discipline used for the earlier Twenty API key fix).
2. Rewrite `twenty-pipeline.ts`'s three functions to call the MCP server via Bifrost instead of raw `fetch()`, keeping exact signatures — this alone de-risks the CRM admin dashboard page, which doesn't touch chat at all.
3. Build `resolve-tools-then-generate.ts`; wire into `copilot-chat.ts` and `crm-chat.ts` (the two surfaces with CRM tools today).
4. `reports-chat.ts`'s analytics tools stay as direct function calls (resolved — see Component mapping above): they query our own Postgres, not an external vendor, so MCP-wrapping them is out of scope, not merely deferred.
5. Trim the dead CRM read tool names out of `CopilotPanel.tsx`'s and `CrmAssistantPanel.tsx`'s client-side `createHttpToolProvider([...])` arrays once the model stops emitting `Query()` calls for them. `http-tool-provider.ts` and `app/api/openui/tools/route.ts` themselves are **not** removed (see Component mapping above).
6. Document Meta/Google Ads MCP target config in `ads-agent/README.md`, left disabled until real credentials exist.

## Open questions (resolved during implementation planning)

1. ~~Does Phase 1's tool resolution call Bifrost's `/v1/mcp/tool/execute`, or should server-to-server calls unrelated to a chat turn go through a lighter direct MCP client instead?~~ **Resolved: `/v1/mcp/tool/execute` for both.** It needs no preceding chat completion — it's a standalone tool-execution endpoint — so `twenty-pipeline.ts`'s non-chat callers (the `/crm` admin page, `getPipelineValue()`) and the chat-triggered resolve loop both call it directly; no second client implementation needed.
2. ~~Transport for the community Twenty MCP server (`stdio` vs `http`)?~~ **Resolved: stdio-only** (confirmed from its README — no built-in HTTP/SSE mode), bridged to SSE via a `supergateway` sidecar rather than a custom Bifrost image, per Bifrost's own documented guidance for stdio servers under Docker.
