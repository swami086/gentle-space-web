# OpenUI generate/execute alignment — stop server-side parse gatekeeping

Date: 2026-08-05
Status: approved (design locked by user; implementation plan next)
Related: builds on and partially supersedes the Resilience section of
[`2026-08-05-openui-platform-foundation-design.md`](2026-08-05-openui-platform-foundation-design.md)
(bounded retry-on-parse-failure convention). Follows repeated patchwork fixes to
`normalize-openui-response.ts` / `normalize-named-kwargs.ts` for Campaign, CRM, and Reports chat
(commits on `main`, 2026-08-05) that treated each new Bifrost output shape as a one-off string
coercion instead of addressing the underlying architecture mismatch.

## Problem

Four surfaces — Campaign draft chat, CRM Assistant, Reports chat, and the global Copilot — dead-end
users with a generic "I had trouble structuring/putting that together — could you rephrase?"
whenever the raw model text doesn't parse into a **complete, error-free** component tree on the
**server**, before anything is ever shown to the user or any tool ever runs. Campaign, CRM, and
Reports have all reproduced this failure against live Bifrost during this investigation; Copilot
runs the identical hard-gate pattern (`copilot-chat.ts`'s `parseCopilotResponse` +
`parseWithBoundedRetry`) and is equally exposed, even though a given live-smoke prompt happened not
to trigger it.

Today's flow for CRM/Reports/Copilot:

```
Bifrost stream → server createParser(text) → must be 100% valid NOW
                                             → if not: generic dead-end message
                                             → if valid: forward text as-is to client Renderer
```

This is backwards relative to OpenUI's own documented architecture
([How it works](https://www.openui.com/docs/openui-lang/how-it-works)):

> The LLM generates the interface once. After that, the UI runs on its own: fetching data, handling
> state, and responding to user actions — without any LLM involvement... `Query("list_tickets")` →
> the runtime calls your tool directly, no LLM roundtrip.

OpenUI's own parser is explicitly tolerant of imperfect input — `ParseResult.meta.errors` includes
non-fatal codes like `excess-args` ("more positional args than schema params — extras dropped,
**component still renders**"), and the `Renderer` is designed to run against streaming, partial
text (`isStreaming` prop, `partial` field on `ElementNode`). Our own server-side gate is stricter
than OpenUI's own runtime — we are the ones inventing an all-or-nothing failure mode that the spec
does not require, then patching that self-inflicted gate with more and more coercion functions
(`normalizeNamedKwargsLang`, `coerceJsonStyleOpenUi`, `unwrapSpuriousRootWrapper`,
`coerceMacroTrendChart`, `isLikelyTruncatedOpenUi`...) each time a new raw-output shape appears.

**This spec's goal is a 100% root-cause fix, not another coercion function.** Every prior "fix" in
this class of bug has been solving the symptom (a specific raw-text shape the server parser
rejects) rather than the cause (the server parser being a hard gate at all, for surfaces that have
a working client-side `Renderer` + `toolProvider` already wired).

## Non-goals

- **Rewriting Campaign draft chat's persistence model.** Campaign chat's server-side parse of
  `SetupCard` exists because the parsed `headlines`/`descriptions`/`corridor`/etc. fields are
  written into the `campaign_drafts` DB row — this is genuinely server-side business logic, not
  gatekeeping for its own sake. It keeps its own server parse, but is tightened (below), not
  removed.
- **Switching to MCP `toolProvider`.** The existing HTTP function-map `toolProvider`
  (`createHttpToolProvider` → `POST /api/openui/tools`) already matches the documented
  "function map" pattern; no MCP client is needed.
- **Incremental editing (`editMode`) or reactive `$variables`/`@Set`/`@Reset`.** Real OpenUI
  features, out of scope — none of the three surfaces need multi-turn UI patches or client-side
  form state yet.
- **Retrofitting Home/Settings or any deterministic (non-chat) page.** Unaffected by this change.

## Root cause (confirmed via Firecrawl research against official OpenUI docs + source)

1. **CRM/Reports/Copilot never needed a server-side `createParser` call at all.** Each surface's
   client component (`CrmAssistantPanel.tsx`, `ReportsChat.tsx`, `CopilotPanel.tsx`) already
   renders via `<Renderer response={...} library={...} toolProvider={...} isStreaming />` — the
   officially documented Execute phase. The server-side `parseXResponse()` functions in
   `crm-chat.ts` / `reports-chat.ts` / `copilot-chat.ts` duplicate that same parse, but synchronously
   and without a `toolProvider`, so `Query(...)` statements can never resolve server-side and the
   server sees only the unfilled/error state. Any deviation from an immediately-perfect
   single-statement response (JSON fencing, an invented `Root()` wrapper, a malformed `@Each` call
   on a bare tool-function invocation, named kwargs, excess args) trips `result.meta.errors.length >
   0` and the whole turn is discarded — even though the identical text would likely have rendered
   fine in the client `Renderer`, which tolerates `excess-args` (extra *positional* args only —
   verified live-testing, not named ones) and partial/streaming input by design.
2. **The system prompts don't yet use OpenUI's own `tools`/`toolExamples`/`toolCalls` prompt
   options with concrete `Query(...)` examples that correctly reshape tool output.** Each of
   `crmLibrary.prompt(...)` / `analyticsLibrary.prompt(...)` passes `tools`, but `additionalRules`
   never shows the model a worked example using `@Each` to reshape a tool's raw row field names
   (e.g. `date`/`cplInr`/`amountInr`) into a component's expected prop names (e.g.
   `TrendChart`'s `{label, value}`, `OpportunityCard`'s `amountLabel`). Without that concrete
   pattern, the model free-lances (JSON, an invented `Root()` wrapper, calling the tool name as a
   bare function instead of via `Query()`) exactly because it hasn't been shown the real one —
   `@Each` itself is real, spec-supported OpenUI Lang (confirmed against the installed
   `@openuidev/lang-core` package's `evaluateLazyBuiltin()` source), not something to steer the
   model away from.
3. **Campaign chat's failures were a distinct, narrower bug** (truncated `SetupCard` from
   oversized keyword lists exceeding `maxTokens`) already partly addressed (`maxTokens: 4096`,
   keyword cap in the prompt) — this is legitimate server-side validation (Google RSA character
   limits, DB write), not gatekeeping, and stays.

## Goals

1. **CRM, Reports, and Copilot stop parsing/validating on the server before display.** The server's
   job becomes: authenticate, check credits/Bifrost config, stream bytes through, and detect only
   the failure modes that make streaming itself impossible (empty response, provider error,
   credits exhausted). Parsing, tool execution (`Query`/`Mutation`), and error surfacing move to the
   client `Renderer`, which already has a `toolProvider`, `onError`, and streaming-tolerant parser.
2. **System prompts for these three surfaces adopt official `Query`/`Mutation` worked examples**
   per the v0.5 spec, so the model is shown the real target shape instead of inferring it.
3. **Campaign chat keeps server-side parsing** (business requirement: draft persistence) but is
   simplified back toward the official shape — positional-only prompt guidance, real
   `toolExamples`-style worked examples, tightened length rules — with the coercion surface
   *reduced*, not expanded further.
4. **Delete dead coercion code** for the components/shapes only CRM/Reports/Copilot need
   (`coerceJsonStyleOpenUi`, `unwrapSpuriousRootWrapper`, `coerceMacroTrendChart`, the multi-
   component named-kwargs rewriter for non-SetupCard components) once the server no longer gates on
   them. Campaign's own named-kwargs handling for `SetupCard` may stay as a narrow, targeted
   fallback since that surface still hard-parses.
5. **No user-visible generic dead-end** ("I had trouble putting/structuring that together") for
   CRM/Reports/Copilot under normal operation — errors that do occur (tool failure, genuine
   provider outage) are surfaced as *specific*, sourced errors (`OpenUIError.source` /
   `.message`) via the client's `onError`, not a scripted server string.

## Architecture

### Before (all three non-Campaign surfaces)

```
route.ts → draftXChatReply() [generator]
         → runXModel() streams Bifrost deltas to client (delta events)
         → on stream end: parseXResponse(fullText)   ← hard server-side createParser + validation
         → parseWithBoundedRetry (1 retry with model, same hard parse)
         → done event: { reply: <normalized text> } OR { reply: "I had trouble..." }
Client  → Renderer response={message.content} toolProvider={...}   ← re-parses independently,
                                                                        Query() never actually runs
                                                                        against server-parsed text
```

### After (CRM / Reports / Copilot)

```
route.ts → draftXChatReply() [generator]
         → runXModel() streams Bifrost deltas to client (delta events) — unchanged
         → on stream end: soft checks only —
             • empty/whitespace-only response → "no response" (rare, real failure)
             • (existing) credits/Bifrost-unavailable branches — unchanged
         → done event: { reply: fullText }              ← raw model text, once, no server parse
Client  → Renderer response={message.content} toolProvider={...} onError={...}
             → parses, runs Query()/Mutation() against real data, renders partial/full tree
             → onError only for genuine runtime/parser failures → small inline "couldn't render
               this part" affordance scoped to the turn, not a full-turn generic replacement
```

`parseWithBoundedRetry` is removed from these three surfaces' server generators (Campaign keeps
its own, separately-justified retry). The one-retry-with-feedback *pattern* is preserved as a
documented option for a future case where the server genuinely must validate (e.g. if a future
`Mutation`-driven surface needs server-side confirmation before persisting), but is no longer
wired into surfaces that don't need it.

### Campaign draft chat (kept, tightened)

```
route.ts → draftCampaignChatReply() [generator]         — unchanged shape
         → parseSetupCardResponse(fullText)              — kept: this is real business logic
             • normalizeOpenUiResponse (root=, fence-strip, SetupCard named→positional only)
             • isLikelyTruncatedOpenUi guard — kept (real failure mode: maxTokens cutoff)
         → parseWithBoundedRetry — kept (feeds specific errors back, one retry)
         → done event: { reply, fieldUpdates }           — unchanged; fieldUpdates persist to DB
```

Prompt tightened per official docs' positional-args emphasis and the v0.5 spec's `Query`/`Mutation`
example shape (Campaign has no tools today per the platform foundation spec's own correction, so no
`Query` example applies — the tightening is scoped to the existing `SetupCard`-only guidance:
shorter worked example already added, keyword cap already added).

## System prompt changes (all four: Campaign/CRM/Reports/Copilot)

Add one worked `Query(...)` → component example per surface that has tools (CRM, Reports, Copilot),
copied from the shape the v0.5 spec itself documents:

```
# crm-library.ts buildSystemPrompt() additionalRules/toolExamples
toolExamples: [
  `leads = Query("list_opportunities", {}, {rows: []})`,
  `root = OpportunityList(leads.rows)`,
],
```

```
# analytics-library.ts
toolExamples: [
  `trend = Query("get_spend_cpl_trend", {days: 7}, {spend_cpl_trend: []})`,
  `root = TrendChart("CPL Trend This Week", trend.spend_cpl_trend)`,
],
```

Explicit negative guidance stays (no JSON, no invented `Root()`/macros) as prompt-level instruction
— cheap and still useful — but is no longer the thing standing between the user and a rendered
card; it's advisory to the model, not enforced by a server-side reject.

## What gets deleted / demoted

| File | Change |
|------|--------|
| `lib/decision-engine/crm-chat.ts` | Remove `createParser`/`parseCrmResponse`/`parseWithBoundedRetry` call; stream raw text through. Keep Bifrost/credits branches. |
| `lib/decision-engine/reports-chat.ts` | Same as CRM. |
| `lib/decision-engine/copilot-chat.ts` | Same as CRM. |
| `lib/openui/normalize-openui-response.ts` | Keep `stripOuterMarkdownFence`, `ensureOpenUiRootAssignment` (cheap, harmless prompt-hygiene). Remove `coerceJsonStyleOpenUi`, `unwrapSpuriousRootWrapper`, `coerceMacroTrendChart`, `isLikelyTruncatedOpenUi` usage outside Campaign — these existed only to satisfy the server hard-parse we're removing for CRM/Reports/Copilot. |
| `lib/openui/normalize-named-kwargs.ts` | Scope `OPENUI_COMPONENT_PROP_SPECS` back down to `SetupCard` only (Campaign's own need); delete CRM/analytics/shared entries once CRM/Reports/Copilot no longer server-parse. |
| `lib/openui/openui-parse-regression.test.ts` | Rewrite: keep exhaustive fixtures for `SetupCard` (Campaign, still server-parsed); replace non-SetupCard fixtures with client-Renderer-focused tests (parse tolerance, not server-reject assertions) or move them to a `platform-library` parser-tolerance suite that asserts *rendering*, not server-side business rejection. |
| `lib/openui/openui-live-smoke.test.ts` | Update assertions: CRM/Reports/Copilot done-events should no longer ever equal the generic string (this becomes a *stronger* guarantee, structurally impossible rather than empirically absent); Campaign keeps its existing assertion. |
| `components/CrmAssistantPanel.tsx`, `ReportsChat.tsx`, `components/copilot/CopilotPanel.tsx` | Add `onError` to `<Renderer>` to surface real parser/runtime/query/mutation errors distinctly (small inline affordance), replacing reliance on the server's generic string. |

## Testing strategy

1. **Unit (server):** each of the three simplified `draftXChatReply()` generators — assert the
   `done` event's `reply` is always the raw (lightly fence-stripped) model text, never a hard-coded
   apology, for any non-empty input; assert Bifrost/credits branches unchanged.
2. **Unit (client parser tolerance, not server rejection):** move the exhaustive named-kwargs /
   preamble / JSON-shape fixtures to assert `createParser(...).parse(text).root` renders *something*
   reasonable via the real OpenUI parser's own tolerance (`excess-args` still renders), documenting
   what the client Renderer will show — not gating a server response on it.
3. **Live smoke (existing `OPENUI_LIVE_SMOKE=1` gate, updated):** Campaign/CRM/Reports/Copilot
   real-Bifrost calls; assert CRM/Reports/Copilot replies are never the generic string (now
   structurally guaranteed) and Campaign still produces `ok`-parsed `SetupCard` fields.
4. **Manual/browser verification (post-implementation):** re-run the exact prompts that originally
   failed ("propose headlines and descriptions", "show me hot leads", "show CPL trend this week",
   "what's my pipeline value?") against the running dev server and confirm the *actual card renders
   with live data*, not just that no error string appears.

## Rollout

Single PR/commit set on `main` (matches how the prior patchwork fixes landed). No feature flag —
the three surfaces already have a working client `Renderer`+`toolProvider`, so removing the
redundant server gate is a subtraction, not a new dependent system. Campaign chat is untouched in
its externally-visible behavior (still parses, persists, retries).

## Open questions for implementation (none blocking; noted for the plan)

- Whether `onError`'s inline affordance should offer a "regenerate this turn" action (re-sends the
  same user message) — nice-to-have, not required for this fix's success criteria.
- Whether to keep `isLikelyTruncatedOpenUi` for Campaign or rely on the existing
  `parseWithBoundedRetry` feedback loop alone now that `maxTokens` was raised — low-risk either way,
  decide during implementation based on whether the live smoke still needs it.

## Addendum 2: OpenUI best-practices alignment audit (2026-08-05, before implementation)

A dedicated audit of this design against official OpenUI docs and, critically, the **installed
package source** (`node_modules/@openuidev/lang-core/dist/index.mjs`, not just prose) found one
factual error in this design (already corrected above and in the implementation plan) and
confirmed the rest of the architecture is aligned. Findings:

1. **Error — `@Each` was mischaracterized as an "invented macro."** It is not. Reading
   `evaluateLazyBuiltin()` in the installed package confirms `@Each(array, varName, template)`
   evaluates `template` as a general per-item expression (not restricted to component calls) and
   returns the resulting array of plain values — exactly the mechanism needed to reshape a tool's
   raw row field names (`date`, `cplInr`, `amountInr`, ...) into a component's expected prop names
   (`label`/`value`, `amountLabel`, ...). The original live-tested failure that motivated
   `coerceMacroTrendChart` had two *different* real bugs — invoking the tool name as a bare
   function (`get_spend_cpl_trend(7)`) instead of binding it via `Query()` first, and wrapping the
   whole thing in an invented `Root()` — neither of which is a problem with `@Each` itself.
   **Fix applied:** the Root-cause section above, `normalize-openui-response.ts`'s removed-coercion
   comment, and every `toolExamples` entry in the implementation plan now demonstrate `@Each` used
   correctly (`Query()`-bound, reshaping fields, no `Root()`), rather than telling the model to
   avoid a real language feature. This also closes a data-shape gap this design had previously
   deferred as "out of scope" (Non-Goals never listed tool-to-component reshaping, but the fix
   turned out to be a one-line, in-scope prompt correction, not a reshaping *system*).
2. **Confirmed — excess-args tolerance is positional-only.** Live-tested during the original
   investigation (2026-08-05, earlier the same day): `OpportunityCard(name="...", stage="...")`
   parsed with `excess-args` (12 dropped) *and* `null-required` on `name`/`stage`, with
   `result.root` coming back `undefined` — i.e. named kwargs are not rescued by the tolerance the
   original (superseded) design draft assumed. This is why the plan retains the named→positional
   rewrite for every component rather than scoping it to `SetupCard` only (see the plan's Global
   Constraints).
3. **Confirmed — Generate/Execute split, `Query`/`Mutation` positional shape, `toolProvider`
   function-map pattern, `onError` callback, and "positional only" core rule** all match this
   design's Architecture section verbatim against `https://www.openui.com/docs/openui-lang/{how-it-works,specification-v05,renderer}`
   and the `@openuidev/react-lang` API reference. No further corrections needed.
4. **Confirmed — Campaign draft chat's server-side parse is a deliberate, documented departure
   from "pure" Generate/Execute, not an oversight.** OpenUI's own docs describe persistence via
   `Mutation()` tools the *runtime* executes (client-side), not via the LLM's raw component props
   being harvested server-side. Campaign's `parseSetupCardResponse` → DB write is the latter
   pattern. This design's Non-Goals section already excludes rewriting Campaign's persistence
   model to the `Mutation()`-based pattern — that remains the right call for this fix's scope, but
   is flagged here as a known, intentional architecture deviation for a future spec to reconsider
   if Campaign chat grows more interactive fields.

## Addendum: named-kwargs rewrite retained for all components (2026-08-05, during implementation)

An earlier draft of this design's "What gets deleted / demoted" table said to scope
`normalize-named-kwargs.ts`'s `OPENUI_COMPONENT_PROP_SPECS` down to `SetupCard` only, on the theory
that once the server stops hard-gating, the client `Renderer`'s own tolerance (`excess-args`
"extras dropped, component still renders") would cover named-kwargs output for CRM/Reports/Copilot
components too. Live-testing that assumption during implementation (Task 5) showed it does not
hold: OpenUI's real parser's `excess-args` tolerance applies only to *extra positional* arguments,
not to *named* ones — named kwargs on `OpportunityCard` produced `null-required` errors for the
schema's actual required fields (`name`, `stage`), because they were never positionally filled at
all, and `result.root` came back `undefined`. OpenUI Lang is positional-only per
[v0.5 core rule #6](https://www.openui.com/docs/openui-lang/specification-v05#core-rules) with no
runtime fallback for named args. `normalizeOpenUiResponse()`'s named→positional rewrite is
therefore retained for every registered component, applied as a non-blocking hygiene pass on both
the server (before streaming `done`) and, transitively, whatever the client `Renderer` receives.
The only coercions actually removed are the three that rescued *invented* shapes (JSON, a
non-existent `Root()` wrapper, `@Each` macros on tool names) that have no equivalent tolerance
anywhere in OpenUI and are better addressed by the `toolExamples` added in Tasks 1–3.
