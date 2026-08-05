# MCP-only backend tool integration — design

**Date:** 2026-08-05
**Status:** Validated against official sources — see `docs/superpowers/specs/2026-08-05-mcp-backend-tool-integration-validation.md` for citations. That pass corrected the transport (Streamable HTTP, not SSE) and replaced Bifrost's proprietary MCP Gateway feature with the official `@modelcontextprotocol/client` SDK called directly — this document reflects the validated (revised) architecture, not the original draft.
**Scope:** `ads-agent` only. The root Gentle Space app has no AI-copilot tool-calling surface (confirmed via `torbit` — no `openui`/`copilot` references outside `ads-agent`), so there is nothing to migrate there.

## Problem

`ads-agent`'s four AI chat surfaces (Copilot, CRM Assistant, Campaign Chat, Reports Chat) currently reach external services through hand-written connectors that speak each vendor's REST/SDK directly:

- `lib/connectors/twenty.ts` + `lib/crm/twenty-pipeline.ts` — raw `fetch()` against Twenty's REST API with a static Bearer key.
- `lib/connectors/meta.ts` — Meta Marketing API (unconfigured today, no credentials in `.env.local`).
- `lib/connectors/google-ads.ts` — Google Ads API (unconfigured today, no credentials in `.env.local`).

On top of that, tool *execution* for the OpenUI chat surfaces is a second custom layer: `lib/openui/{crm,analytics,campaign,platform}-tools.ts` declare `ToolSpec`s and a `ToolProviderMap`, and the client-side `http-tool-provider.ts` turns each OpenUI-lang `Query()`/`Mutation()` call into a `POST /api/openui/tools`, which dispatches back into the same tool-provider map on the server. Two bespoke integration layers, one per vendor connector and one per tool-execution hop.

The directive: **replace both with MCP**, so that "AI copilots integrate to external tools via MCP only on the backend" — no custom connector code talking to vendor REST APIs, and no MCP protocol ever reaching the browser.

## Why MCP is viable here (research findings)

- **The Model Context Protocol has an official TypeScript client SDK** (`@modelcontextprotocol/client`, maintained by the MCP org) that talks directly to any MCP server over Streamable HTTP — `Client` + `StreamableHTTPClientTransport` + `listTools()`/`callTool()`. This is the standardised interface the app calls; no AI-gateway-specific "MCP Gateway" feature is required to get MCP into the backend. (Bifrost's own MCP Gateway was evaluated and rejected in favor of this — see the validation doc referenced above.)
- **Real MCP servers exist for all three vendors we integrate**:
  - **Twenty CRM**: native MCP is a *Twenty Cloud* feature (OAuth), not available for our self-hosted instance (re-confirmed against `docs.twenty.com`'s self-host docs during validation). A community OSS server (`mhenry3164/twenty-crm-mcp-server`, 86 stars, CRUD + dynamic schema discovery against any Twenty REST API + key) covers self-hosted instances like ours.
  - **Google Ads**: Google publishes an official MCP server (`developers.google.com/google-ads/api/docs/developer-toolkit/mcp-server`).
  - **Meta Ads**: Meta launched an official hosted MCP endpoint (`mcp.facebook.com/ads`, OAuth, 29 tools) in April 2026.
- **We still avoid Bifrost's Agent Mode** (incompatible with streaming per Bifrost's own docs) — but not by driving *Bifrost's* MCP Gateway ourselves instead. We drive the MCP connection ourselves (official SDK, direct to the Twenty MCP server) and only use Bifrost for what it's actually needed for: an OpenAI-compatible chat completion, with an explicit `tools` param we build from `listTools()`. Streaming (Phase 2) never carries a `tools` param at all, so it's untouched regardless of which MCP integration approach is used.

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
Connect to the Twenty MCP server directly with the official `@modelcontextprotocol/client` SDK (`Client` + `StreamableHTTPClientTransport`, pointed at the `twenty-mcp-gateway` sidecar) and call `listTools()` to get the server's live tool schemas — filtered in our own code to the read-only subset (`list_opportunities`, `get_opportunity`; `update_opportunity`'s schema is never included). Call Bifrost `POST /v1/chat/completions` (no `stream`) with that filtered `tools` array — a plain OpenAI-compatible tool-calling request, nothing Bifrost-specific. If the model returns `tool_calls`:
- Execute each one via the *same* SDK client's `callTool({ name, arguments })`, in parallel, append each result as a `role: "tool"` message.
- Because `update_opportunity`'s schema was never in the `tools` array we sent, the model cannot request it in the first place — mutations are never triggered by model output, only by a human clicking a rendered confirm component. A defensive check still rejects any tool-call name outside the two we advertised, in case the model hallucinates a name it wasn't given.
- Loop up to 2 rounds (covers "list, then get details on one" chains) or until no more tool calls appear.

**Phase 2 — Generate (streaming, unchanged UX).**
Re-send the full conversation — now grounded with real tool results as `tool` messages — as today's normal streaming `chatCompletion`. The model emits OpenUI-lang directly against real data; system prompts drop the `Query("list_opportunities", {}, [])` placeholder pattern since the data is already in context (e.g. `leads = [...]` inlined, or the model composes the component directly from the tool result already visible to it).

This keeps mutation confirmation exactly as it is today: `StageChangeConfirm`'s Confirm button still `PATCH`es `/api/crm/opportunities/[id]/stage` directly from the client — that route's *internals* switch from calling `twenty-pipeline.ts`'s raw `fetch()` to calling the Twenty MCP server, but the human-in-the-loop UX doesn't move.

### Component mapping

| Today | Becomes |
|---|---|
| `lib/connectors/twenty.ts` (`fetchLeadSignal`), `lib/crm/twenty-pipeline.ts` (`listOpportunities`, `getOpportunity`, `updateOpportunityStage`) — raw `fetch()` + Bearer key | Same function signatures, bodies replaced with calls to `lib/bifrost/mcp-client.ts`'s thin wrapper around the official `@modelcontextprotocol/client` SDK, talking directly to the Twenty MCP server (bypassing Bifrost entirely for these calls — no LLM is involved in a plain CRM read, so there's nothing for Bifrost to do here). |
| `lib/connectors/meta.ts`, `lib/connectors/google-ads.ts` | Unchanged for now (Non-goal). Target: MCP client calls to `mcp.facebook.com/ads` and Google's official Ads MCP server, once credentials exist. |
| `lib/openui/crm-tools.ts` (`crmToolProvider`, `crmToolSpecs`), `analytics-tools.ts`, `campaign-tools.ts`'s read tools, `platform-tools.ts`'s `ToolProviderMap` composition | `crm-tools.ts` is retired for reads at the *chat* layer only — its exports are unchanged (it still mocks `twenty-pipeline.ts` in tests) and it stays registered in `platformToolProvider` for `analytics-tools.ts`'s and `campaign-tools.ts`'s sake (see next row). No hand-maintained tool-schema file is needed at all: the app calls the Twenty MCP server's own `listTools()` at request time and hands that JSON Schema straight to Bifrost's `tools` param — the schemas can never drift out of sync with the server, because they're read from it live. |
| `lib/openui/http-tool-provider.ts` (`createHttpToolProvider`) + `app/api/openui/tools/route.ts` | **Kept, not removed** (correction from an earlier draft of this section) — Reports Chat's analytics tools and Copilot's `start_campaign_draft` mutation still call through this path unchanged (both are explicit non-goals). Only the three CRM read tool names (`list_opportunities`, `search_opportunities`, `get_opportunity`) are trimmed out of the two client components (`CopilotPanel.tsx`, `CrmAssistantPanel.tsx`) that no longer emit `Query()` calls for them. |
| `copilot-chat.ts` / `crm-chat.ts` single `runXModel()` streaming call | Each calls the shared `resolveToolsThenGenerate()` for Phase 1, then their existing streaming generator for Phase 2. `reports-chat.ts` is unchanged (see next row). |
| `campaign-chat.ts`, `reports-chat.ts` | Unchanged (Non-goal — analytics tools query our own Postgres, not an external vendor). |

### Infrastructure

Add a `twenty-mcp-gateway` service to `ads-agent/docker-compose.yml`, alongside `bifrost`: `supercorp/supergateway` bridging the community `mhenry3164/twenty-crm-mcp-server` (npx-run, **stdio-only** — confirmed from its README, no built-in HTTP/SSE mode) to **Streamable HTTP** (`--outputTransport streamableHttp`, endpoint `http://twenty-mcp-gateway:8765/mcp` — corrected during validation from an earlier SSE-transport draft; SSE is the deprecated MCP transport as of the 2025-03-26 spec revision), configured with `TWENTY_BASE_URL`/`TWENTY_API_KEY` (same values already in `ads-agent/.env.local`; `TWENTY_BASE_URL` needs `host.docker.internal` from inside the container, not `localhost`).

Bifrost's `config.json` needs **no changes at all** — this is the key simplification from validation. The app's own `lib/bifrost/mcp-client.ts` connects to `twenty-mcp-gateway:8765/mcp` directly with the official MCP SDK; Bifrost never learns the Twenty MCP server exists, so there's no `mcp` config section, no `disable_auto_tool_inject`, and no allowlist header to keep in sync. Reports Chat, Campaign Chat, and Phase 2's streaming calls are automatically safe from ever seeing a `twenty_*` tool, for the simplest possible reason: none of their code paths call `listTools()` or pass a `tools` param, so Bifrost is never even told the tools exist for those requests.

## Data flow example: "show me hot leads"

```
Copilot backend → MCP SDK client.connect() → twenty-mcp-gateway:8765/mcp
                 → client.listTools() → [list_opportunities schema, get_opportunity schema]
Copilot backend → Bifrost POST /v1/chat/completions
                     (tools: [list_opportunities, get_opportunity], stream=false)
                 ← tool_calls: [{ id: "call_1", function: { name: "list_opportunities", arguments: "{}" } }]
Copilot backend → MCP SDK client.callTool({ name: "list_opportunities", arguments: {} })
                 ← { content: [{ type: "text", text: "[...9 real opportunities...]" }] }
Copilot backend → Bifrost POST /v1/chat/completions (stream=true, history + tool result appended, no tools param)
                 ← streams: root = OpportunityList([...9 real rows, no Query() placeholder...])
Client Renderer  → renders directly. No fetch to /api/openui/tools.
```

(The `tools` param is built explicitly by our own code from `listTools()`'s live result, filtered to the read-only subset, and passed the same way any OpenAI-compatible tool-calling request would — Bifrost isn't aware the Twenty MCP server exists; it's just receiving a normal chat completion request with a `tools` array.)

## Error handling

- **MCP server unreachable / `connect()`, `listTools()`, or `callTool()` throws**: Phase 1 loop returns the original messages unchanged (no tool results appended); Phase 2 proceeds with whatever context is available (possibly none). The model is instructed (system prompt addition) to say plainly it couldn't reach the CRM rather than fabricate data — this is strictly better than today's failure mode, where a missing/broken client-side `Query()` execution could render a plausible-looking but fake `StatCard`.
- **Bifrost itself unreachable**: unchanged — `isBifrostConfigured()` / connection failure produces the existing "Copilot is unavailable right now" message.
- **Model emits a mutating tool call anyway**: defense in depth, two independent gates. First, the `tools` array we build from `listTools()` and pass to Bifrost never includes `update_opportunity`'s schema — the model is structurally unable to be told the tool exists for this call. Second, `resolveToolsThenGenerate()` additionally rejects any returned `tool_calls` entry whose name isn't one of the two we explicitly advertised, so a hallucinated tool-call name can't slip through either. If the model didn't also render the expected confirm component, that surfaces as an unhelpful reply, not a security gap — the PATCH route still requires a human click either way.
- **The Twenty MCP server's tool list drifts** (e.g. it adds/renames tools on a version update): because we read `listTools()` live on every resolve call rather than hardcoding a schema, a renamed tool is simply absent from what we filter for by name — it fails closed (tool no longer offered to the model) rather than failing loud. A genuinely renamed `list_opportunities`/`get_opportunity` would need this repo's filter-by-name constant updated; caught by Task 9's live smoke test failing to find CRM data.

## Testing

- **Unit**: `resolve-tools-then-generate.test.ts` mocks both the Bifrost HTTP client and `lib/bifrost/mcp-client.ts`'s SDK wrapper to verify: read tool calls execute via `callTool()` and their results get appended as `tool` messages; a tool-call name outside the advertised set is rejected, never reaches `callTool()`; the 2-round cap is respected.
- **Live smoke**: extend `lib/openui/openui-live-smoke.test.ts` to run against real Bifrost + the real `twenty-mcp` container (already how the existing live smoke suite works against live Bifrost), asserting a "show me hot leads" turn returns real opportunity data end to end.
- **Regression**: existing `crm-tools.test.ts` / `twenty-pipeline.test.ts` unit tests get rewritten to assert against the new MCP-backed function bodies (same exported function signatures — `listOpportunities()`, `getOpportunity()`, `updateOpportunityStage()` — so callers like `app/(admin)/crm/page.tsx` need zero changes).
- **Meta/Google Ads**: contract/type tests only (mocked tool schemas), since there's nothing live to smoke-test.

## Migration / rollout order

1. Stand up the `twenty-mcp-gateway` sidecar (`supergateway` + the community server) over Streamable HTTP. Verify with the official SDK's `listTools()` (a small ad-hoc script or the Task 1 smoke step) before touching app code (same verification discipline used for the earlier Twenty API key fix).
2. Rewrite `twenty-pipeline.ts`'s three functions to call the MCP server via `lib/bifrost/mcp-client.ts`'s SDK wrapper instead of raw `fetch()`, keeping exact signatures — this alone de-risks the CRM admin dashboard page, which doesn't touch chat at all.
3. Build `resolve-tools-then-generate.ts`; wire into `copilot-chat.ts` and `crm-chat.ts` (the two surfaces with CRM tools today).
4. `reports-chat.ts`'s analytics tools stay as direct function calls (resolved — see Component mapping above): they query our own Postgres, not an external vendor, so MCP-wrapping them is out of scope, not merely deferred.
5. Trim the dead CRM read tool names out of `CopilotPanel.tsx`'s and `CrmAssistantPanel.tsx`'s client-side `createHttpToolProvider([...])` arrays once the model stops emitting `Query()` calls for them. `http-tool-provider.ts` and `app/api/openui/tools/route.ts` themselves are **not** removed (see Component mapping above).
6. Document Meta/Google Ads MCP target config in `ads-agent/README.md`, left disabled until real credentials exist.

## Open questions (resolved during implementation planning and validation)

1. ~~Does Phase 1's tool resolution call Bifrost's `/v1/mcp/tool/execute`, or should server-to-server calls unrelated to a chat turn go through a lighter direct MCP client instead?~~ **Resolved during validation, superseding the original planning answer:** neither call goes through Bifrost at all. Both `twenty-pipeline.ts`'s non-chat callers and the chat-triggered resolve loop call the *same* `lib/bifrost/mcp-client.ts` SDK wrapper directly against the Twenty MCP server — Bifrost is only ever used for its actual job, the chat completion itself. See the validation doc, finding 2.
2. ~~Transport for the community Twenty MCP server (`stdio` vs `http`)?~~ **Resolved: stdio-only** (confirmed from its README — no built-in HTTP/SSE mode), bridged to **Streamable HTTP** (not SSE — corrected during validation, finding 1) via a `supergateway` sidecar.
