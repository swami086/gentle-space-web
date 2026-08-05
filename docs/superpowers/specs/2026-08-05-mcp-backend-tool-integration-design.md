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
| `lib/connectors/twenty.ts` (`fetchLeadSignal`), `lib/crm/twenty-pipeline.ts` (`listOpportunities`, `getOpportunity`, `updateOpportunityStage`) — raw `fetch()` + Bearer key | Same function signatures, bodies replaced with calls to the Twenty MCP server via Bifrost's `/v1/mcp/tool/execute` (or a direct MCP client if we bypass Bifrost for server-to-server calls not tied to a chat turn — see Open Question 1) |
| `lib/connectors/meta.ts`, `lib/connectors/google-ads.ts` | Unchanged for now (Non-goal). Target: MCP client calls to `mcp.facebook.com/ads` and Google's official Ads MCP server, once credentials exist. |
| `lib/openui/crm-tools.ts` (`crmToolProvider`, `crmToolSpecs`), `analytics-tools.ts`, `campaign-tools.ts`'s read tools, `platform-tools.ts`'s `ToolProviderMap` composition | Retired for reads. `crmToolSpecs`-equivalent tool *declarations* (name/description/schema) are still needed to tell the model what it can call in Phase 1 — these move to a new `lib/openui/mcp-tool-registry.ts` that mirrors the MCP server's tool list instead of hand-declared `ToolSpec`s. Mutating tool declarations stay, but their provider function is never wired to auto-execute (see Architecture). |
| `lib/openui/http-tool-provider.ts` (`createHttpToolProvider`) + `app/api/openui/tools/route.ts` | Removed. Reads no longer need a client round-trip; mutations already bypass this path today (`StageChangeConfirm` calls its own PATCH route directly, not `Mutation()`). |
| `copilot-chat.ts` / `crm-chat.ts` / `reports-chat.ts` single `runXModel()` streaming call | Each calls the shared `resolveToolsThenGenerate()` for Phase 1, then their existing streaming generator for Phase 2. |
| `campaign-chat.ts` | Unchanged (Non-goal). |

### Infrastructure

Add a `twenty-mcp` service to `ads-agent/docker-compose.yml`, alongside `bifrost`: the community `mhenry3164/twenty-crm-mcp-server` image/build, configured with `TWENTY_BASE_URL`/`TWENTY_API_KEY` (same values already in `ads-agent/.env.local`), internal-only (matches Bifrost's existing "do not expose via Caddy" convention). Register it as an MCP client in `ads-agent/bifrost/config.json`'s `mcp.client_configs` (`connection_type: "http"` or `"stdio"` depending on the image's transport — confirm during implementation), with `tools_to_execute: ["*"]` and **no** `tools_to_auto_execute` (we drive execution ourselves in Phase 1, not Bifrost's Agent Mode).

## Data flow example: "show me hot leads"

```
Copilot backend → Bifrost POST /v1/chat/completions (tools=[twenty_list_opportunities, ...], stream=false)
                 ← tool_calls: [{ name: "twenty_list_opportunities", arguments: "{}" }]
Copilot backend → Bifrost POST /v1/mcp/tool/execute ({ name: "twenty_list_opportunities", ... })
                 ← [{ role: "tool", content: "[...9 real opportunities...]", tool_call_id: "..." }]
Copilot backend → Bifrost POST /v1/chat/completions (stream=true, history + tool result appended)
                 ← streams: root = OpportunityList([...9 real rows, no Query() placeholder...])
Client Renderer  → renders directly. No fetch to /api/openui/tools.
```

## Error handling

- **MCP server unreachable / tool execution error/timeout** (Bifrost returns `tool_execution_error` or the request times out): Phase 1 loop breaks after the failed attempt; Phase 2 proceeds with whatever `tool` messages were successfully collected (possibly none). The model is instructed (system prompt addition) to say plainly it couldn't reach the CRM rather than fabricate data — this is strictly better than today's failure mode, where a missing/broken client-side `Query()` execution could render a plausible-looking but fake `StatCard`.
- **Bifrost itself unreachable**: unchanged — `isBifrostConfigured()` / connection failure produces the existing "Copilot is unavailable right now" message.
- **Model emits a mutating tool call anyway**: never executed regardless of prompt-following; this is enforced structurally in `resolveToolsThenGenerate()` (an explicit denylist check, not a config flag), so it can't regress silently. If the model didn't also render the expected confirm component, that surfaces as an unhelpful reply, not a security gap — the PATCH route still requires a human click either way.
- **`mcp-tool-registry.ts` tool list drifts from what the MCP server actually exposes** (e.g. the community server adds/renames tools on update): Phase 1 tool-call requests for an unknown tool name fail at Bifrost's `/v1/mcp/tool/execute` with `"tool not found"` — surfaced the same way as any other tool execution error above, not a crash.

## Testing

- **Unit**: `resolve-tools-then-generate.test.ts` mocks the Bifrost HTTP client (same shape as today's `crm-tools.test.ts` mocks) to verify: read tool calls execute and their results get appended as `tool` messages; mutating tool calls are dropped, never reach `/v1/mcp/tool/execute`; the 2-round cap is respected.
- **Live smoke**: extend `lib/openui/openui-live-smoke.test.ts` to run against real Bifrost + the real `twenty-mcp` container (already how the existing live smoke suite works against live Bifrost), asserting a "show me hot leads" turn returns real opportunity data end to end.
- **Regression**: existing `crm-tools.test.ts` / `twenty-pipeline.test.ts` unit tests get rewritten to assert against the new MCP-backed function bodies (same exported function signatures — `listOpportunities()`, `getOpportunity()`, `updateOpportunityStage()` — so callers like `app/(admin)/crm/page.tsx` need zero changes).
- **Meta/Google Ads**: contract/type tests only (mocked tool schemas), since there's nothing live to smoke-test.

## Migration / rollout order

1. Stand up `twenty-mcp` sidecar + Bifrost MCP client config. Verify with a raw `curl` against `/v1/mcp/tool/execute` before touching app code (same verification discipline used for the earlier Twenty API key fix).
2. Rewrite `twenty-pipeline.ts`'s three functions to call the MCP server via Bifrost instead of raw `fetch()`, keeping exact signatures — this alone de-risks the CRM admin dashboard page, which doesn't touch chat at all.
3. Build `resolve-tools-then-generate.ts` + `mcp-tool-registry.ts`; wire into `copilot-chat.ts` and `crm-chat.ts` (the two surfaces with CRM tools today).
4. Wire `reports-chat.ts`'s analytics tools (internal DB queries, not an external vendor — confirm during implementation whether these need MCP-wrapping at all, or stay as direct function calls since there's no external API involved; likely the latter, since MCP is for *external* tool integration and analytics tools query our own Postgres).
5. Remove `http-tool-provider.ts` and `app/api/openui/tools/route.ts` once nothing references them.
6. Document Meta/Google Ads MCP target config in `ads-agent/README.md`, left disabled until real credentials exist.

## Open questions

1. **Does Phase 1's tool resolution call Bifrost's `/v1/mcp/tool/execute`, or should server-to-server calls unrelated to a chat turn (e.g. `getPipelineValue()` for the Home stat card, which isn't a chat tool call at all) go through a lighter direct MCP client instead of round-tripping through Bifrost?** Leaning toward: keep non-chat server reads (dashboard stat cards, the `/crm` admin page) on a plain MCP client call (no LLM involved, no need for Bifrost's tool-call framing) — only chat-triggered tool resolution goes through Bifrost's endpoints. Worth confirming during implementation once the MCP server's actual client library/transport is known.
2. **Transport for the community Twenty MCP server** (`stdio` vs `http`) isn't confirmed yet — depends on how `mhenry3164/twenty-crm-mcp-server` is packaged; resolve when adding the docker-compose service.
