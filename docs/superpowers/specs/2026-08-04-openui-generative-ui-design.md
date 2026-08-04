# OpenUI generative UI — shared infrastructure + Campaign Draft Chat (Spec 1 of 3)

Date: 2026-08-04
Status: approved (pending user review of this written spec)
Related: builds on
[`docs/superpowers/specs/2026-08-04-bifrost-ai-gateway-design.md`](2026-08-04-bifrost-ai-gateway-design.md)
(Bifrost gateway, `ads-agent/bifrost/`) and
[`docs/superpowers/specs/2026-08-04-token-credit-accounting-design.md`](2026-08-04-token-credit-accounting-design.md)
(credit ledger, `ads-agent/lib/metering/`). Feeds two follow-on specs that reuse this
infrastructure:
[`2026-08-04-openui-analytics-surface-design.md`](2026-08-04-openui-analytics-surface-design.md) and
[`2026-08-04-openui-crm-chat-surface-design.md`](2026-08-04-openui-crm-chat-surface-design.md).

## Problem

`ads-agent`'s Campaign Draft Chat (`components/CampaignDraftChat.tsx` +
`lib/decision-engine/campaign-chat.ts`) already does LLM-driven structured-output-over-chat: the
model replies with JSON matching a hand-written `DRAFT_RESPONSE_SCHEMA` (8 fields — headlines,
descriptions, keywords, corridor, budget, ad group, final URL, assistant reply), and the client maps
that JSON onto a hand-coded, fixed-layout form panel — every field has its own input, its own
`onChange`, its own `patchDraft()` call. Two costs of this today: (1) every new field the model can
propose needs new UI code, new state wiring, and a new server-side parse/validate branch; (2) a
recent incident (`MALFORMED_FUNCTION_CALL` from forced Gemini tool-calling, fixed by moving to
`response_format.json_schema`) shows the hand-rolled JSON parsing has no graceful-degradation story —
a malformed response is a hard failure, not a partial render.

[thesysdev/openui](https://github.com/thesysdev/openui) is a renderer-agnostic Generative UI
framework: the model emits a compact streaming DSL ("OpenUI Lang") instead of JSON, bound to a
component library and a set of app-defined tools. This spec adopts it for Campaign Draft Chat and
builds the shared plumbing (streaming Bifrost client, streaming-aware metering, tool-provider
pattern) two more surfaces will reuse.

## Goals

1. Replace `DRAFT_RESPONSE_SCHEMA`/`parseDraftJson`/`sanitizeReply` with an OpenUI component library
   + tool-provider pair, matching the current 8 draft fields exactly — no new fields, no scope creep.
2. Add streaming support to the Bifrost client and the credit-metering pipeline, so OpenUI's
   progressive (line-by-line) rendering works from day one, not just a design placeholder.
3. Keep `campaign_drafts`/`campaign_draft_messages` (Postgres) as the only source of truth. OpenUI
   "tools" are thin async wrappers around the existing `lib/db/campaign-drafts.ts` functions — no
   schema change, no new persistence layer.
4. Structure the new code (`ads-agent/lib/openui/`) so the streaming client, the metering wrapper, and
   the tool-provider helper are surface-agnostic from the start — Specs 2 and 3 import them rather than
   duplicating them.
5. Visual parity: the rendered "Campaign setup" card must look like today's shadcn `Card`/`Badge`
   layout — OpenUI components wrap the existing `components/ui/*` primitives, not a new design system.

## Non-goals (this phase)

- **Analytics or CRM surfaces.** Covered by Specs 2 and 3, which depend on this one.
- **Twenty CRM's native MCP endpoint.** Not used anywhere yet; see Spec 3's non-goals for why.
- **Incremental/patch editing of previously-generated OpenUI Lang.** OpenUI supports the LLM emitting
  only the changed statements on follow-up turns (`@Reset`, patch merging). Out of scope for v1 — every
  turn regenerates the full component tree, same request shape as today. Documented upgrade path, not
  built speculatively (YAGNI at 8 fields).
- **A published/shared npm package.** `ads-agent/lib/openui/` is reusable *within this repo* by
  Specs 2/3; it is not extracted into a separate package, matching the precedent set by
  `lib/metering/` (see that spec's non-goals).

## Why OpenUI over the alternatives (recap of evaluation)

Full trade-off discussion happened in brainstorming; summarized for the record:

| Option | Trade-off |
|---|---|
| **OpenUI Lang + tool-connected components (chosen)** | Solves the hand-wiring pain and gives built-in graceful handling of malformed model output. Real new engineering cost: streaming support doesn't exist in this app yet. |
| In-house schema-driven form renderer (no new dependency) | Smaller diff, zero new-DSL risk — but doesn't get OpenUI's built-in malformed-output resilience or set up reusable infrastructure for Specs 2/3. Rejected once the analytics/CRM surfaces (genuine "model chooses the UI shape" needs) were identified — building a bespoke schema-form renderer would be one-off, whereas OpenUI's investment pays off three times. |
| MCP client tool-provider (instead of function map) | OpenUI supports both. Function map chosen for this spec because tools are in-process calls to `lib/db/campaign-drafts.ts` — no separate MCP server needed. Revisit for Spec 3, where Twenty CRM's own MCP endpoint is a real (if currently unstable) option. |

React 19.2.4/Next 15.5.21 compatibility confirmed against `@openuidev/react-lang`'s declared peer range
(`react: ^18.3.1 || ^19.0.0`). Gemini-via-Bifrost compatibility relies on OpenUI Lang being taught via
system prompt (not forced function-calling), so it doesn't hit the `MALFORMED_FUNCTION_CALL` failure
class already seen with Gemini; no direct Gemini+OpenUI-Lang benchmark exists publicly, so this is a
residual, accepted risk, not a proven fact.

## Architecture

```
ads-agent/
  lib/
    openui/
      bifrost-stream.ts        # NEW — streamChatCompletion(): POST stream:true +
                                #        stream_options:{include_usage:true} to Bifrost, parses SSE,
                                #        yields delta.content chunks, resolves final `usage`
      bifrost-stream.test.ts   # NEW
      tool-provider.ts         # NEW — defineTool() helper: wraps an async fn as an OpenUI
                                #        ToolSpec (name, description, input/output JSON schema),
                                #        used by every surface's tool file
      campaign-library.ts      # NEW — OpenUI component library: HeadlineList, DescriptionList,
                                #        KeywordTable, BudgetField, CorridorField, AdGroupField,
                                #        FinalUrlField, SetupCard — each defineComponent()'d with a
                                #        Zod schema, each rendering via components/ui/*
      campaign-tools.ts        # NEW — tool functions wrapping lib/db/campaign-drafts.ts:
                                #        update_draft_fields, create_proposal (calls the existing
                                #        create-proposal route logic directly, not via HTTP)
      campaign-tools.test.ts   # NEW
    metering/
      metered-stream-client.ts # NEW — callMeteredStreamingChatCompletion(ctx, request): pre-flight
                                #        balance check (unchanged) → streamChatCompletion() →
                                #        debitUsage() from the final usage chunk once the stream ends
      metered-stream-client.test.ts # NEW
      metered-client.ts         # UNCHANGED — kept for any future non-streaming caller
    decision-engine/
      campaign-chat.ts          # MODIFIED — DRAFT_RESPONSE_SCHEMA/parseDraftJson/sanitizeReply
                                #             removed; buildSystemPrompt() replaced by
                                #             generateSystemPrompt({ library: campaignLibrary,
                                #             promptOptions: { tools: campaignTools, toolCalls: true,
                                #             bindings: true } }); calls
                                #             callMeteredStreamingChatCompletion()
      campaign-chat.test.ts     # MODIFIED
  app/
    api/
      campaign-drafts/[id]/
        messages/
          route.ts              # MODIFIED — returns a streamed (SSE) response instead of one JSON
                                #             blob, matching OpenUI's openAIAdapter() client protocol
          route.test.ts         # MODIFIED
  components/
    CampaignDraftChat.tsx        # MODIFIED — rebuilt around OpenUI's Renderer/AgentInterface with
                                #             a toolProvider function map (campaign-tools.ts);
                                #             message thread and setup card are both OpenUI-rendered
  package.json                  # MODIFIED — adds @openuidev/react-lang, @openuidev/lang-core,
                                #             @openuidev/openui-cli (dev, for `openui generate`)
```

`lib/db/campaign-drafts.ts` and the `campaign_drafts`/`campaign_draft_messages` tables are **not
modified** — every tool in `campaign-tools.ts` calls an existing exported function unchanged.

## Component library

`campaign-library.ts` defines exactly the fields `CampaignDraftFields` already has (`lib/types.ts`):

| Component | Backs field(s) | Renders via |
|---|---|---|
| `HeadlineList` | `headlines: string[]` (3-15, ≤30 chars) | `components/ui/input` × N, same maxLength |
| `DescriptionList` | `descriptions: string[]` (2-4, ≤90 chars) | `components/ui/input` × N |
| `KeywordTable` | `keywords: {text, matchType}[]` | existing keyword row markup (text input + matchType select) |
| `BudgetField` | `dailyBudgetInr: number \| null` | `components/ui/input[type=number]` |
| `CorridorField` | `corridor: string \| null` | `components/ui/input` |
| `AdGroupField` | `adGroupName: string \| null` | `components/ui/input` |
| `FinalUrlField` | `finalUrl: string` | `components/ui/input` |
| `SetupCard` | wraps all of the above + status `Badge` + "Create Proposal" `Button` | `components/ui/card` |

Each is `defineComponent()`'d with a Zod schema matching its prop shape 1:1 with the existing
`CampaignDraftFields` type — the RSA hard limits (≤30/≤90 chars, 3-15/2-4 items) are enforced by
`validateDraftFields()` (`campaign-draft-rules.ts`, unchanged) inside the `update_draft_fields` tool,
not duplicated into the Zod schemas.

## Tools (`campaign-tools.ts`)

```typescript
const tools: ToolSpec[] = [
  {
    name: "update_draft_fields",
    description: "Apply field changes to the campaign draft (partial — only send fields being set).",
    inputSchema: /* CampaignDraftFields shape, mirrors DRAFT_RESPONSE_SCHEMA minus assistantReply */,
  },
  {
    name: "create_proposal",
    description: "Convert a ready draft into a pending proposal for human approval.",
    inputSchema: { type: "object", properties: {} },
  },
];
```

`update_draft_fields`'s handler: validate via `validateDraftFields()` (existing), reject with a tool
error listing violations if invalid (the model gets the error back and can retry in the same turn —
same self-correction loop `campaign-chat.ts` already does manually today, now handled by OpenUI's own
tool-call retry rather than the hand-written two-attempt loop in the current code). On success, call
`updateDraftFields(draftId, fields)` + `setDraftStatus(draftId, isDraftReady(...) ? "ready" :
"chatting")`, matching current behavior exactly.

`create_proposal`'s handler calls the same logic `POST /api/campaign-drafts/[id]/create-proposal`
already runs (extracted to a shared function if not already, called directly — no internal HTTP
round-trip).

## Streaming + metering

`bifrost-stream.ts`:

```typescript
export async function* streamChatCompletion(
  options: ChatCompletionOptions,
): AsyncGenerator<{ delta: string } | { usage: Usage }, void> {
  const res = await fetch(`${baseUrl()}/v1/chat/completions`, {
    method: "POST",
    body: JSON.stringify({ ...requestBody, stream: true, stream_options: { include_usage: true } }),
    // ...headers, signal as today
  });
  // parse `data: {...}\n\n` SSE lines from res.body; yield {delta} for each
  // choices[0].delta.content, yield {usage} once a chunk carries a populated `usage` object
}
```

`metered-stream-client.ts` mirrors `metered-client.ts`'s pre-flight checks exactly (same
`InsufficientCreditsError` throws before any Bifrost call), then consumes the generator, forwarding
`{delta}` chunks to the caller (ultimately the SSE response body) while accumulating tokens, and calls
`debitUsage()` once the `{usage}` chunk arrives — same transactional row-locking function as today,
unchanged.

**Open verification task, not a design gap:** whether Bifrost forwards Vertex/Gemini's usage on the
final streamed chunk when `stream_options.include_usage` is set has not been tested against the
running local Bifrost instance. If it doesn't, the fallback is a client-side token estimate (e.g. via
a tokenizer) purely for metering accuracy — the stream itself still works either way. This is the
first implementation task (see Implementation order) precisely so the fallback path, if needed, is
known before the rest of the stack is built on top of it.

## Request lifecycle

1. User sends a chat message → `POST /api/campaign-drafts/[id]/messages` (now a streamed response).
2. `campaign-chat.ts` builds messages + `generateSystemPrompt(...)`, calls
   `callMeteredStreamingChatCompletion()`.
3. Pre-flight balance check (unchanged) → stream starts → SSE forwarded to the client as OpenUI Lang
   tokens arrive.
4. Client-side `Renderer` parses progressively; when it hits a `Mutation("update_draft_fields", ...)`
   or `Mutation("create_proposal", {})`, the `toolProvider` function map calls the corresponding
   `campaign-tools.ts` function directly (no LLM round-trip for that call, same "generation vs.
   execution" separation OpenUI provides for every surface).
5. Once the stream ends, `metered-stream-client.ts` debits credits from the final usage chunk.

## Error handling

- **Malformed/partial OpenUI Lang mid-stream:** rely on the framework's built-in graceful handling
  (renders what parsed, drops incomplete trailing statements) instead of the current
  `try { JSON.parse() } catch`.
- **`InsufficientCreditsError` mid-stream:** abort the SSE stream, send a terminal assistant message
  with today's exact copy ("This organization has run out of AI credits…").
- **Tool validation failure** (`update_draft_fields` rejecting RSA-limit violations): return a tool
  error string; the model gets it in-context and can retry within the same turn, same self-correction
  behavior as today's two-attempt `callDraftModel` retry loop, but handled by OpenUI's tool-call
  protocol instead of hand-written retry code.
- **Bifrost fallback chain** (`fallbacksForModel`): unchanged, applies to the streaming request body
  identically to the non-streaming one.

## Testing

Same TDD pattern as the rest of `ads-agent` (mock `fetch`/pg pool, as `campaign-chat.test.ts` already
does):

- `bifrost-stream.test.ts` — SSE parsing (multi-chunk, chunk boundaries mid-JSON-object, final usage
  chunk), and the token-estimate fallback path if the verification task above finds usage isn't
  forwarded.
- `campaign-tools.test.ts` — `update_draft_fields` validation-reject-and-retry shape, `create_proposal`
  happy path and already-converted-draft rejection.
- `metered-stream-client.test.ts` — pre-flight rejection before any stream starts; correct debit amount
  from a mocked multi-chunk stream.
- `campaign-chat.test.ts` — updated for the new system-prompt-generation call, same turn-level
  assertions (headlines+descriptions pairing, corridor/budget extraction) against mocked tool calls
  instead of mocked JSON responses.
- One integration test in `route.test.ts` simulating a full mocked SSE turn end-to-end through to
  `debitUsage()`.

## Success criteria

- `CampaignDraftChat.tsx` renders and behaves identically from a user's perspective (same fields, same
  RSA limits, same "Create Proposal" gating) — verified by re-running the existing
  `CampaignDraftChat`-adjacent tests plus a manual smoke pass.
- A chat turn streams visibly (setup card fields populate progressively, not in one jump) in the
  local dev environment.
- Credits are debited exactly once per turn, for the correct token count, verified against the
  `usage_ledger` table.
- A malformed/truncated model response degrades to a partial render, not a hard error.
- `npm test` and `npm run lint` in `ads-agent/` pass with no new warnings.

## Implementation order (high level)

1. **Verification spike:** confirm (or refute) that Bifrost forwards `usage` on the final SSE chunk
   for `stream_options.include_usage:true` against Vertex/Gemini models. Decides whether
   `bifrost-stream.ts` needs the token-estimate fallback.
2. `bifrost-stream.ts` + `tool-provider.ts` (no UI dependency, TDD'd against mocked `fetch`).
3. `metered-stream-client.ts` wrapping step 2.
4. `campaign-library.ts` + `campaign-tools.ts` (component/tool definitions, TDD'd independently of the
   route/UI wiring).
5. `campaign-chat.ts` rewritten to use `generateSystemPrompt()` + `callMeteredStreamingChatCompletion()`.
6. `route.ts` streamed response.
7. `CampaignDraftChat.tsx` rebuilt around `Renderer`/`AgentInterface` + the tool-provider function map.
