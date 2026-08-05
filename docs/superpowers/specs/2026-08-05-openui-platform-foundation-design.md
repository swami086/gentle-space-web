# OpenUI platform foundation — generative-native, hybrid-rendered admin dashboard

Date: 2026-08-05
Status: approved (pending user review of this written spec)
Related: builds on
[`docs/superpowers/specs/2026-08-04-openui-generative-ui-design.md`](2026-08-04-openui-generative-ui-design.md)
(Spec 1, implemented — shared streaming/metering infrastructure and the `SetupCardView` dual-mode
pattern this spec generalizes; **correction from codebase verification below**: Spec 1 never used
OpenUI's `ToolSpec`/`ToolProvider`/`Query()` mechanism — `SetupCard` is pure structured-output
parsing, no live tool calls — so there is no shipped `campaign-tools.ts` to compose from yet). Establishes the shared architecture that
[`2026-08-04-openui-analytics-surface-design.md`](2026-08-04-openui-analytics-surface-design.md)
(Spec 2) and
[`2026-08-04-openui-crm-chat-surface-design.md`](2026-08-04-openui-crm-chat-surface-design.md)
(Spec 3) — both approved-but-unbuilt — should be implemented against, and that a future Home/global-
Copilot spec will build on. Informed by the visual concept exploration in
`Gentle_Space_Redesign.pen` (workspace root). Includes one shipped fix, found during this spec's own
investigation: a bounded parse-failure retry in Spec 1's Campaign Chat (see Resilience below).

## Problem

Specs 1-3 each treat OpenUI as a bolt-on: a chat panel embedded in an otherwise hand-coded page,
with its own private component library and tool file. That pattern works for one surface at a time,
but it doesn't answer the bigger question this spec exists to settle: **how far does generative UI
reach into the product, and how do the three (soon four+) surfaces relate to each other and to the
rest of the dashboard?** Left unaddressed, three concrete problems compound as more surfaces are
added:

1. **No shared tool registry.** Spec 3's CRM tools and Spec 2's analytics tools are designed as
   fully separate files with no relationship to Spec 1's campaign tools. A user cannot ask one
   question that spans domains ("pause underperforming campaigns and show me this week's hot
   leads") — there is no single conversational surface with access to everything.
2. **No principle for when the model renders vs. when plain data-fetching does.** Nothing stops a
   future surface from wiring every page load through an LLM call (real latency + credit cost per
   navigation), nor is there a documented alternative.
3. **No shared answer-richness bar.** Each spec's component library is narrow (exactly the fields
   that surface's chat needs), so a question slightly outside a library's coverage has nowhere to
   render except plain prose — undermining the "AI-first, visually rich" product direction.

## Goals

1. Establish a **hybrid rendering model**: deterministic data-fetching renders every page by default
   (free, instant, same as today's Overview page); the model only renders when the user asks for it
   — via an embedded chat, the global Copilot, or a new universal per-component "Ask AI" trigger.
2. Generalize Spec 1's existing `SetupCardView` dual-mode pattern (one React component, called
   directly for the deterministic path or wrapped via `defineComponent()` for the model path) into
   the documented convention every future component follows.
3. Add a **composed cross-domain tool/component registry** (`platform-library.ts`/
   `platform-tools.ts`) that merges the existing per-domain files, powering a new persistent global
   Copilot, while embedded per-page chats keep using their narrower domain-only files unchanged.
4. Establish a **rich-by-default response principle**: expand the shared component library with
   general-purpose fallback shapes so the model rarely has nothing to render but plain text, and
   encode the priority (component > plain text) directly in the shared system-prompt instructions.
5. Define the **global Copilot's** behavior (persistent across navigation, full cross-domain tool
   access) and a lightweight **proactive-signaling** convention (rule-based badges, not background
   LLM jobs) that invites the user into the model path rather than pushing unprompted AI content at
   them.
6. Require every surface's model-response handling to follow a **bounded retry-on-parse-failure**
   convention (see Resilience below), so a user is never dead-ended with a generic "I couldn't
   understand that" message on the first structurally-bad model output — the class of error found
   and fixed in Spec 1 during this spec's own investigation (see Related work below).

## Non-goals (this phase)

- **Building CRM or Reports chat surfaces, or retrofitting Home/Settings.** This spec is the shared
  architecture Specs 2/3 (and a future Home/Copilot spec) implement against. No new page ships from
  this spec alone.
- **Role-based or personalized default layouts.** Not raised as a requirement; the deterministic
  default view is the same for every operator/admin today, and this spec doesn't change that.
- **Background/scheduled AI briefings.** Explicitly rejected in favor of reactive-only generation —
  see Proactive signaling below. No cron job, no "AI wrote this while you were away" content.
- **Voice or command-palette invocation.** Out of scope for this brainstorm.
- **Rewriting Spec 1's shipped Campaign Chat.** It adopts `platform-tools` composition as a small
  additive task (see Migration path); its existing `campaign-library.ts`/`campaign-tools.ts` are not
  rewritten.
- **`HeatmapGrid`, `MapView`, `DiffView`, and a dedicated date-range-picker widget.** Real potential
  value, explicitly deferred — see Component library below for why each is out of scope for now
  rather than silently forgotten.

## Architecture

```
ads-agent/
  lib/
    openui/
      campaign-library.ts     # EXISTING (Spec 1, shipped) — unchanged
      campaign-tools.ts       # DOES NOT EXIST (correction: Spec 1 never defined a ToolSpec/
                               #       ToolProvider — SetupCard is pure structured-output parsing,
                               #       no Query()/Mutation() calls). platform-tools.ts below
                               #       therefore composes zero domain tool sets today — an
                               #       intentional empty, typed, documented extension point, not a
                               #       partially-built merge. Verified via torbit + a source read
                               #       of @openuidev/lang-core's installed .d.cts (confirms the
                               #       real API: ToolSpec/ToolProvider/createQueryManager exist and
                               #       are usable — the gap is that no domain has authored one yet)
      crm-library.ts          # Spec 3 (unbuilt) — implemented per this spec's dual-mode convention
      crm-tools.ts            # Spec 3 (unbuilt)
      analytics-library.ts    # Spec 2 (unbuilt) — implemented per this spec's dual-mode convention
      analytics-tools.ts      # Spec 2 (unbuilt)
      shared-library.ts       # NEW — general-purpose fallback components (StatCard, InsightCallout,
                               #       ComparisonCard, ChecklistCard, KpiGrid, Timeline, RankedList,
                               #       AlertBanner, BatchActionConfirm) + AskAiTrigger wrapper;
                               #       depended on by every domain library, never the reverse
      platform-library.ts     # NEW — createLibrary() merging campaignLibrary + crmLibrary +
                               #       analyticsLibrary + sharedLibrary's components
      platform-tools.ts       # NEW — merges campaignTools + crmTools + analyticsTools into one
                               #       ToolSpec[] for the global Copilot
    metering/
      metered-stream-client.ts  # EXISTING (Spec 1, shipped) — unchanged, reused verbatim
  components/
    copilot/
      CopilotProvider.tsx      # NEW — client context living at (admin)/layout.tsx level; owns
                                #       open/closed state + message history so it survives
                                #       navigation between pages
      CopilotPanel.tsx         # NEW — the floating panel UI (mirrors Gentle_Space_Redesign.pen's
                                #       "Copilot Panel" concept); uses platform-library/platform-tools
      CopilotFab.tsx           # NEW — floating trigger button, shown on every admin page
  app/
    (admin)/
      layout.tsx                # MODIFIED — mounts CopilotProvider + CopilotFab once, so every
                                 #             page gets the persistent Copilot without per-page wiring
      api/
        copilot/
          chat/
            route.ts            # NEW — POST, streamed (SSE), same protocol shape as Spec 1/2's
                                 #        routes; uses platform-tools.ts (full cross-domain access)
```

Embedded per-page chats (Campaign Chat today; CRM Assistant and Reports chat once Specs 2/3 are
built) each keep their own route + domain-only library/tools file, unchanged from how those specs
already describe them. Only the new global Copilot route uses the composed `platform-*` files.

## The hybrid rendering model

Every component in every library (domain-specific or shared) is a plain React function taking typed
props — the same convention `SetupCardView` already establishes in Spec 1:

```typescript
// Convention every new component follows (generalizing campaign-library.ts's existing pattern):
export function KpiGridView(props: KpiGridProps) { /* renders components/ui/card × N */ }

const KpiGrid = defineComponent({
  name: "KpiGrid",
  description: "...",
  props: KpiGridSchema,
  component: ({ props }) => React.createElement(KpiGridView, props),
});
```

- **Deterministic path** (page load, navigation, refresh): a server component or route handler calls
  the same `lib/db/*` function a tool wraps, and renders `<KpiGridView {...directFetchResult} />`
  directly. No LLM call, no token cost, no latency beyond the DB query — identical to how today's
  Overview page works.
- **Model path** (embedded chat, global Copilot, or the `AskAiTrigger` handoff below): the model
  calls the same underlying tool, and OpenUI's `Renderer` mounts the `defineComponent()`-wrapped
  version of the identical component.

This is not a new abstraction to build — it is the existing `SetupCardView` pattern, documented as
the convention every future component (Specs 2/3, and the new shared library below) must follow, so
"generative-native" is achieved by reuse of one component tree, not by two parallel UIs that can
drift out of sync.

**`AskAiTrigger` — the per-component handoff.** A new small shared wrapper (`shared-library.ts`,
plain React, not itself an OpenUI component) renders a small sparkle icon, visible on hover, on any
component that opts in (`KpiCard`, `OpportunityCard`, table rows, board cards). Clicking it opens the
relevant chat surface (the embedded page chat if one exists for that domain, otherwise the global
Copilot) with a pre-seeded question referencing that specific item's identity/data (e.g., "Explain
why CPL rose on Whitefield HSR Launch"). This is the concrete mechanism a user has to invoke the
model path when the deterministic default is not enough.

## Response composition: rich-by-default

The model-path response for every surface (embedded chats and the global Copilot alike) follows one
shared priority order, encoded in each surface's `generateSystemPrompt()` call:

1. Render the most specific component that matches the tool result's shape (e.g., a trend query
   result renders `TrendChart`, not `DataTable`).
2. If no domain-specific component fits, render one of the new general-purpose shapes below rather
   than prose.
3. Any plain `assistantReply`/text is capped at one short framing sentence — never the substance of
   the answer.
4. **Exception:** a response with no informational content (a one-word acknowledgment like "Done" or
   "Cancelled" after a confirmed action) stays plain text. Forcing trivial acks into a card is noise,
   not richness — the bar is "does this response carry information," not "is this a chat turn."

## Resilience: bounded retry on parse failure

**Found during this spec's own investigation (2026-08-05):** production users of Spec 1's Campaign
Chat could hit a hard dead end — "I had trouble structuring that — could you rephrase?" — any time
the model's raw output failed to parse into a `SetupCard` at all (missing `root = SetupCard(...)`
statement, truncated/garbled syntax the normalizer couldn't rewrite, empty response). Root cause:
`campaign-chat.ts`'s `parseTurn()` already had a proven one-shot retry-with-feedback pattern for
responses that parsed fine but violated business rules (RSA character limits — feed the specific
errors back to the model, retry once) — but **no equivalent existed for responses that failed to
parse in the first place.** Those immediately surfaced the generic message with zero retry, discarding
the specific parser errors instead of using them to ask the model to self-correct.

Fixed in `ads-agent/lib/decision-engine/campaign-chat.ts` (this spec's investigation, not a future
task): `ParsedTurn`'s parse-error case now carries the parser's specific `errors` and the model's own
`rawText`; the main flow gives the model exactly one retry — pushing its unparseable output back as
an assistant turn plus a user turn stating the specific parser errors and asking for one corrected
`SetupCard(...)` re-emission — before falling back to the clarifying message. Mirrors the existing
validation-error retry exactly, so the two failure classes (unparseable vs. parses-but-invalid) are
now handled symmetrically. Verified via two new tests in `campaign-chat.test.ts` (retry-then-succeed,
and give-up-after-one-failed-retry-with-no-silent-hang) plus the full existing suite (239/239) and
lint on the touched files.

**Convention for every future surface (Specs 2/3, global Copilot):** this bounded-retry behavior is
not optional per-surface — it's a foundation-level requirement, same tier as the dual-mode component
convention. Concretely: any surface parsing model output into a defined component schema must (a)
propagate the specific parse/validation errors rather than discarding them, and (b) attempt exactly
one retry with those errors fed back to the model before showing any user-facing fallback message —
never zero retries, and never more than one (unbounded retries risk masking a genuinely broken model
call behind repeated latency/cost instead of surfacing it). Spec 1's fix is the reference
implementation. Once a second surface implements this (Spec 2 or 3), extract the shared retry
mechanics (not the domain-specific error/prompt text) into a `lib/openui/parse-retry.ts` helper —
not before, since a single caller doesn't yet justify the abstraction.

## Component library

### New shared, general-purpose components (`shared-library.ts`)

| Component | Renders | Why it's shared (not domain-specific) |
|---|---|---|
| `InsightCallout` | icon + short headline + one supporting stat/badge | Qualitative answers that aren't a chart/table (e.g. "why" questions) — the default fallback for any domain |
| `ComparisonCard` | two-sided before/after or A-vs-B | Generalizes the Reports mockup's grouped-bar comparison; reusable for campaign A/B, this-week-vs-last-week, or lead-tier shifts |
| `ChecklistCard` | short list of items/recommendations, each with a status icon | Multi-item answers ("3 things to review today") instead of a numbered-list paragraph |
| `StatCard` | one number + label + optional delta arrow | Owned here, not by Spec 2, because it's generic (single-metric display has no domain-specific logic) — `analytics-library.ts` imports it rather than redefining it, reversing Spec 2's original ownership |
| `KpiGrid` | grid of `StatCard`s | Lets the model compose a custom scorecard ("show me a scorecard for this campaign") instead of only rendering a fixed 4-stat row |
| `Timeline` | chronological event list | Reusable for CRM lead activity, a campaign change log, or a Reports audit trail — one component, three callers |
| `RankedList` | top-N with rank badges | Reusable for top campaigns by spend, top leads by score, top corridors by budget burn |
| `AlertBanner` | severity-flagged urgent card (distinct visual weight from `InsightCallout`) | What renders when a user clicks a rule-based badge (see Proactive signaling) and asks "why is this flagged?" |
| `BatchActionConfirm` | multi-item version of Spec 3's `StageChangeConfirm` — list of affected items + old/new state + confirm/cancel | The AI acting on multiple items at once ("Pause these 3 underperforming campaigns?") needs a batch-aware confirm step, not N single-item confirms |

All nine are built on existing `components/ui/*` shadcn primitives — no new charting or table
library, consistent with Specs 1-3's existing constraint.

### Explicitly deferred (named, not silently dropped)

| Component | Why deferred |
|---|---|
| `HeatmapGrid` | Real value (time/geo performance heatmaps) but needs dedicated visual design work beyond this spec's scope |
| `MapView` | Would pull live map rendering into the chat surface — a heavier dependency than any component above; revisit only if a corridor-geography question becomes a proven repeat ask |
| `DiffView` | Field-level before/after diff — narrow use case (mainly campaign-edit approval), no current caller across Specs 1-3 |
| Dedicated date-range-picker widget | Natural-language date ranges already work in chat (see Spec 2's `getSpendCplForRange`); a widget is a nice-to-have, not a gap |

## The global Copilot

- **Persistence:** `CopilotProvider` lives at `(admin)/layout.tsx`, so the panel's open/closed state
  and message history survive navigation between Home/Marketing/CRM/Reports — a floating overlay
  with one continuous conversation, not a fresh thread per page.
- **Tool access:** full cross-domain access via `platform-tools.ts` — a single turn can call
  campaign, CRM, and analytics tools together (e.g., "pause underperforming campaigns and show me
  hot leads" spans two domains in one exchange).
- **Persistence model:** ephemeral, client-side message history sent in full per request — same
  pattern as Spec 2's Reports chat (no new database table). Trimming/condensing older turns to bound
  token cost on long sessions is a reasonable follow-up, not required for v1.
- **RBAC:** gated at `requireRole("operator")`, the minimum already used by Campaigns/Proposals/
  Reports — the Copilot exposes no data or mutation a user couldn't already reach through the
  per-page surfaces it composes.

## Proactive signaling (deliberately minimal)

No background LLM jobs, no scheduled "AI wrote this while you were away" content. Instead:

- Simple rule-based, SQL/code-computed badges — e.g. a red dot on the Copilot FAB when a threshold
  trips (a lead sits unqualified >48h, a campaign's CPL exceeds its configured breakeven), or an
  inline chip like "CPL up 17%" computed by a plain comparison query.
- These are pure data signals, not generated text — clicking one uses the same handoff mechanism as
  `AskAiTrigger` (opens the relevant chat, pre-seeded with a question about the flagged item) for
  the actual explanation, rather than a separate interaction pattern.
- This keeps "the AI is watching" perceptible without any new infrastructure (no cron, no job
  queue, no proactive-generation budget to meter) — an explicit, deliberate trade-off against the
  bigger "scheduled proactive briefing" alternative considered and rejected during brainstorming.

## Migration path for Specs 1-3

- **Spec 1 (Campaign Chat, shipped):** no rewrite. Adopts the dual-mode convention it already
  pioneered (`SetupCardView`) as-is. The only additive change: `campaignLibrary`'s component is
  imported into `platform-library.ts` for the global Copilot's benefit — a composition change, zero
  modification to Spec 1's own files. There is no `campaignTools` to import (see Architecture
  correction above) — `platform-tools.ts` ships with zero entries from Spec 1 until Campaign Chat
  (or Spec 2/3) authors its first real `ToolSpec`. Its parse-failure retry gap (see Resilience
  above) is already fixed as part of this spec's own investigation, not deferred work.
- **Spec 2 (Reports, unbuilt):** implemented as originally designed, with three adjustments: (a) its
  `TrendChart`/`DataTable`/`EmptyState` components follow the dual-mode convention above so the
  Overview page's future refresh can call them directly, (b) `StatCard` is defined once in
  `shared-library.ts` instead of `analytics-library.ts` (it's generic, not analytics-specific — see
  Component library above) and Spec 2's implementation imports it rather than redefining it, and
  (c) `analyticsLibrary`/`analyticsTools` are composed into `platform-library.ts`/`platform-tools.ts`.
- **Spec 3 (CRM, unbuilt):** same treatment — dual-mode convention for `OpportunityCard`/
  `OpportunityList`/`PersonResult`/`StageChangeConfirm`/`EmptyState`, composed into the platform
  files.
- Neither Spec 2 nor Spec 3's own documents need to be rewritten; this spec is the shared
  architecture layer they implement against, referenced from their own future implementation
  plans.

## Testing

- `shared-library.test.ts` — each of the 9 new components renders correctly from static props
  (matching Spec 2/3's existing "visually smoke-tested with static props before model wiring"
  approach).
- `platform-library.test.ts` / `platform-tools.test.ts` — composition correctness (all domain
  components/tools present exactly once, no name collisions across domains).
- `CopilotProvider.test.tsx` — state (open/closed, message history) survives a simulated route
  change.
- `route.test.ts` (new `/api/copilot/chat`) — mocked streamed turn spanning two domains in one
  request (e.g. a campaign tool call followed by a CRM tool call), verifying `requireApiRole
  ("operator")` gate.
- Manual smoke: confirm at least one cross-domain Copilot question in local dev renders two
  different domain components in a single turn.
- Every future surface's test suite includes the same pair Spec 1's fix added: one test proving a
  parse failure retries and succeeds, one proving a second consecutive failure gives up gracefully
  (not a silent hang or unbounded retry loop).

## Success criteria

- A page load/navigation never triggers an LLM call or a credit-ledger debit — verified by checking
  `usage_ledger` shows no new rows from simply browsing Home/Marketing/CRM/Reports without opening a
  chat.
- The global Copilot, opened on one page, remains open with history intact after navigating to a
  different page.
- A single Copilot turn can be shown to call tools from at least two different domains.
- A manual smoke pass across all shared components (`InsightCallout` through `BatchActionConfirm`)
  confirms each renders correctly from both a direct prop call and a model-driven `defineComponent()`
  call.
- No plain-text-only response is produced for any question carrying actual information during manual
  smoke testing (only true one-word acknowledgments render as text).
- No surface dead-ends a user on the first structurally-bad model response — every surface retries
  exactly once with specific feedback before showing any fallback message (verified for Spec 1 now;
  required for Specs 2/3 and the Copilot when built).
- `npm test` and `npm run lint` in `ads-agent/` pass with no new warnings.

## Implementation order (high level)

1. `shared-library.ts` + tests — the 8 new components, TDD'd against static props independently of
   any tool/model wiring (no dependency on Specs 2/3 being built first).
2. `AskAiTrigger` wrapper component + tests — pure UI, no backend dependency.
3. `platform-library.ts` / `platform-tools.ts` — composition layer; can be built incrementally as
   each domain file (`campaign-*` today, `crm-*`/`analytics-*` once Specs 2/3 land) becomes
   available.
4. `CopilotProvider.tsx` + `CopilotFab.tsx` + `(admin)/layout.tsx` wiring — state/UI shell, testable
   independently of the chat route.
5. `/api/copilot/chat/route.ts` + `CopilotPanel.tsx` — wired to `platform-tools.ts`/
   `platform-library.ts`, reusing Spec 1's `metered-stream-client.ts` verbatim.
6. Retrofit Spec 1's `campaign-library.ts` components to confirm they already satisfy the dual-mode
   convention (expected: yes, no changes needed — this is a verification step, not new work).
