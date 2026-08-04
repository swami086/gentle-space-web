# OpenUI generative UI — ad-hoc analytics/reporting chat surface (Spec 2 of 3)

Date: 2026-08-04
Status: approved (pending user review of this written spec)
Related: depends on
[`docs/superpowers/specs/2026-08-04-openui-generative-ui-design.md`](2026-08-04-openui-generative-ui-design.md)
(shared streaming/metering/tool-provider infrastructure — must land first). Reads the same data as
the existing Overview dashboard (`ads-agent/app/(admin)/page.tsx`, `lib/db/dashboard.ts`).

## Problem

The Overview page and Proposals list show two fixed views over campaign performance
(`getOverviewStats`, `getSpendCplTrend`, `listCampaignsWithLatestCpl`, `listProposals`). Any question
that doesn't map onto those exact shapes — "compare last week's CPL to the week before by platform",
"which corridor is burning budget fastest", "show me pending proposals over ₹500/day" — currently has
no answer inside the app; someone would have to query Postgres directly or wait for a new dashboard
widget to be built. This spec adds a chat surface where the model picks, from a fixed toolset over the
*existing* read queries, which chart/table shape best answers the question, and OpenUI renders it — no
new dashboard widget code per question.

## Goals

1. A new **Reports** chat page (`/reports`) in the admin dashboard, alongside Overview/Campaigns/
   Proposals, where an operator asks a free-form question and gets back a chart, table, or number
   card — whichever the model judges fits the question and the data shape returned by the tool it
   called.
2. Tools wrap **only already-existing** read functions in `lib/db/dashboard.ts` and
   `lib/db/proposals.ts` — this spec adds zero new SQL beyond one small addition (see Non-goals: date
   range parameterization) needed to make the trend query usefully flexible for arbitrary questions.
3. Reuse Spec 1's `bifrost-stream.ts`, `metered-stream-client.ts`, and `tool-provider.ts` verbatim —
   this spec only adds a new component library, a new tools file, and a new page.
4. Read-only. No tool in this surface can mutate campaigns, proposals, or drafts.

## Non-goals (this phase)

- **New metrics or data sources.** No CTR, impressions, or platform-side (Google/Meta Ads API) data —
  only what `performance_snapshots`/`campaigns`/`proposals` already store. If a question needs data
  the app doesn't have, the model's tool call simply returns what exists (e.g., filtered/aggregated
  differently) or the assistant says the data isn't tracked — it does not trigger new ingestion.
- **Saved reports / scheduled reports / export.** Every session is ephemeral chat; no "save this view"
  feature. Revisit once real usage shows which questions repeat.
- **Cross-org comparison.** Same single-tenant assumption as the rest of `ads-agent` today.
- **Multi-turn drill-down that mutates chart state via prior tool results without a new model call.**
  OpenUI supports client-side re-render from cached tool output, but wiring that up is deferred —
  every follow-up question in v1 re-calls a tool via the model, same generation pattern as Campaign
  Chat. Simpler, consistent with Spec 1, revisit only if latency/cost on follow-ups becomes a
  measured problem.

## One small backend addition (justified, not "no new SQL at all")

`getSpendCplTrend(days: number)` today only takes a lookback window ending at "now." Free-form
questions like "compare this week to last week" need an *arbitrary* `[start, end)` range, not just
"last N days." Rather than have the model awkwardly simulate a date range with two separate
`days`-based calls, `lib/db/dashboard.ts` gets one additional exported function:

```typescript
export async function getSpendCplForRange(startDate: string, endDate: string): Promise<TrendPoint[]>;
// same query shape as getSpendCplTrend, WHERE captured_at >= $1 AND captured_at < $2 — no new table,
// no new column, just a parameterized version of the existing query
```

`getSpendCplTrend` itself is unchanged (still used by the Overview page as-is); the new function is
additive.

## Architecture

```
ads-agent/
  lib/
    db/
      dashboard.ts             # MODIFIED — + getSpendCplForRange(startDate, endDate)
      dashboard.test.ts        # MODIFIED — + range-query test
    openui/
      analytics-library.ts     # NEW — OpenUI component library: StatCard (single number + label),
                                #        TrendChart (wraps existing shadcn `chart`/Recharts line chart
                                #        used on Overview), DataTable (generic sortable table for
                                #        campaign/proposal rows), EmptyState
      analytics-tools.ts       # NEW — tool functions, each a thin wrapper with no new logic:
                                #        get_overview_stats -> getOverviewStats()
                                #        get_spend_trend -> getSpendCplTrend(days) | getSpendCplForRange(...)
                                #        list_campaigns_with_cpl -> listCampaignsWithLatestCpl()
                                #        list_proposals -> listProposals(status?)
      analytics-tools.test.ts  # NEW
  app/
    (admin)/
      reports/
        page.tsx                # NEW — requireRole("operator") gate (matches Campaigns/Proposals),
                                #        renders the OpenUI chat surface (Renderer/AgentInterface,
                                #        analytics-tools.ts as the tool-provider function map)
        ReportsChat.tsx          # NEW — client component, same shape as CampaignDraftChat.tsx but
                                #        stateless (no persisted draft — each session is a fresh
                                #        message thread, not stored in Postgres; see Persistence below)
      layout.tsx                # MODIFIED — add "Reports" nav item to the existing sidebar
    api/
      reports/
        chat/
          route.ts               # NEW — POST, streamed (SSE) response, same protocol shape as
                                 #        Spec 1's campaign-drafts messages route; no draftId param,
                                 #        takes the full message history from the client each turn
                                 #        (see Persistence below)
          route.test.ts          # NEW
```

## Component library

| Component | Renders | Backing tool output shape |
|---|---|---|
| `StatCard` | one number + label + optional delta arrow | `OverviewStats` fields, one at a time or as a row of 4 |
| `TrendChart` | line chart, spend and/or CPL over time | `TrendPoint[]` from either trend tool |
| `DataTable` | generic sortable/filterable table | `CampaignWithCplRow[]` or `Proposal[]` |
| `EmptyState` | "No data for that range/filter" | any empty array result |

All four are built on the existing shadcn `components/ui/card`, `components/ui/table`, and the
Overview page's existing Recharts `chart` wrapper — no new charting library, no new table library.

## Tools (`analytics-tools.ts`)

```typescript
const tools: ToolSpec[] = [
  { name: "get_overview_stats", description: "Current active campaigns, pending proposals, month-to-date spend and blended CPL.", inputSchema: {} },
  { name: "get_spend_trend", description: "Daily spend/CPL trend. Provide either `days` (lookback from today) or `startDate`+`endDate` (ISO dates) for an arbitrary range.", inputSchema: /* oneOf {days} | {startDate, endDate} */ },
  { name: "list_campaigns_with_cpl", description: "All campaigns with their latest CPL, status, budget, platform.", inputSchema: {} },
  { name: "list_proposals", description: "Proposals, optionally filtered by status (pending/approved/rejected).", inputSchema: { status: z.enum([...]).optional() } },
];
```

Every handler is a direct pass-through — no filtering/reshaping logic beyond what the underlying
`lib/db/*` function already does. This keeps the "new code" surface of this spec small: two new files
of thin wrappers, one new query, one new page.

## RBAC decision

`requireRole("operator")` — same minimum as `/campaigns` and `/proposals` (spend and CPL data is
already visible to operators there; this surface exposes nothing more sensitive). Explicit decision,
not deferred: analytics data here is a strict subset of what Overview/Proposals already show any
operator, so gating it to `admin` would be inconsistent with existing precedent for the same data.

## Persistence decision

Unlike Campaign Chat, **no `reports_chat_messages` table.** Each Reports session's message history
lives in client-side React state only (like a normal chat UI) and is sent in full with every request
to `/api/reports/chat` (bounded by a reasonable max-turns-sent window, same pattern OpenUI's own
`AgentInterface` expects). Rationale: report Q&A has no draft-to-approve lifecycle like campaigns
do — there's nothing to persist *to* (no `reports` table exists or is being created — see Non-goals).
If session persistence across page reloads becomes a real ask, that's a small additive follow-up
(store the message array in `localStorage` first, before reaching for a DB table).

## Testing

- `dashboard.test.ts` — new `getSpendCplForRange` test (mocked pg pool, arbitrary range, empty-range
  case).
- `analytics-tools.test.ts` — each tool's pass-through mapping, including the `get_spend_trend`
  days-vs-range branch and the zero-results empty-array case for each.
- `route.test.ts` — mocked streamed turn, verifies `requireApiRole("operator")` gate rejects a viewer.
- Manual smoke: ask 3-4 varied questions ("show this month's spend trend", "which campaigns have the
  worst CPL", "how many pending proposals") and confirm each renders a sensible chart/table rather than
  always defaulting to one component type.

## Success criteria

- `/reports` renders behind the operator role gate; a `viewer`-role session is redirected/forbidden,
  matching `/proposals`' existing behavior.
- At least the 4 tool calls above each successfully drive a distinct rendered component in manual
  testing.
- No new database tables; `dashboard.test.ts`'s new test is the only schema-adjacent change (a new
  function, not a new table).
- `npm test` and `npm run lint` in `ads-agent/` pass with no new warnings.

## Implementation order (high level)

1. `getSpendCplForRange` + test (pure DB addition, no OpenUI dependency, can land independently).
2. `analytics-library.ts` (component definitions, can be visually smoke-tested with static props
   before any tool/model wiring exists).
3. `analytics-tools.ts` + tests (depends on 1, independent of 2).
4. `/api/reports/chat/route.ts` using Spec 1's `metered-stream-client.ts` + `generateSystemPrompt()`
   with `analytics-library.ts`/`analytics-tools.ts`.
5. `ReportsChat.tsx` + `/reports/page.tsx` + sidebar entry.
