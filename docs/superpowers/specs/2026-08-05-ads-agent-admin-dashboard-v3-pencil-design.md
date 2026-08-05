# ads-agent admin dashboard v3 — Pencil "AI Command Center" redesign

Date: 2026-08-05
Status: approved (pending user review of this written spec)
Related: supersedes the visual language (not the structural pieces) of
[`docs/superpowers/specs/2026-08-04-ads-agent-admin-dashboard-v2-design.md`](2026-08-04-ads-agent-admin-dashboard-v2-design.md)
(v2, implemented — role-grouped `SidebarNav`, breadcrumb `Header`, `⌘K` `CommandPalette`, `UserMenu`;
kept as-is below except restyled). Builds on
[`docs/superpowers/specs/2026-08-05-openui-platform-foundation-design.md`](2026-08-05-openui-platform-foundation-design.md)
(implemented — hybrid rendering, `shared-library.ts`, global Copilot, bounded parse-retry convention —
all reused verbatim). Implements, with one scope amendment each,
[`docs/superpowers/specs/2026-08-04-openui-analytics-surface-design.md`](2026-08-04-openui-analytics-surface-design.md)
(Spec 2, approved-but-unbuilt — implemented as designed, restyled only) and
[`docs/superpowers/specs/2026-08-04-openui-crm-chat-surface-design.md`](2026-08-04-openui-crm-chat-surface-design.md)
(Spec 3, approved-but-unbuilt — implemented with a new persistent board on top of its chat tools; see
Scope amendments below). Visually grounded in `Gentle_Space_Redesign.pen` (concept exploration, not
build-ready itself) and its five exports in `design-exports/*.png`.

## Problem

The v2 Linear-style redesign fixed structural density and role-aware navigation, but the product still
looks and reads like a generic admin CRUD tool: light/dark theme following `prefers-color-scheme`, a
flat six-item sidebar (Overview/Campaigns/Proposals/Credits/Users/Settings), no persistent view of the
CRM pipeline inside `ads-agent` at all (only an aggregate hot/warm/cold count via `fetchLeadSignal()`),
and no single AI-first surface tying marketing, leads, and reporting together. Separately, Specs 2 and 3
were approved months apart from each other and from any visual direction — Spec 3 in particular was
scoped as a chat-only surface with no persistent board, which undersells what the business actually
needs day-to-day: a lead pipeline you can *see* at a glance, not one you have to ask about turn by turn.

The user commissioned a from-scratch visual concept in Pencil (`Gentle_Space_Redesign.pen` →
`design-exports/01-05*.png`) exploring a dark, AI-native "Command Center" aesthetic across five screens:
Home, Marketing Automation, Leads & CRM, Reports & Analytics, Settings & Users. This spec turns that
concept into a buildable design, resolving the concept's conflicts with what's already approved/shipped
(see Scope amendments), and defines the shared token/component layer needed to build all five screens
consistently.

## Goals

1. **Pixel-faithful dark theme**, `ads-agent` only — replace v2's `prefers-color-scheme` dual theme with
   a single fixed dark palette matching the Pencil mocks (see Design tokens). Geist stays as the
   typeface (unchanged from v2 — the mocks use a Geist-compatible sans, not a font swap).
2. **Nav restructure to the Pencil IA**: `Home` / `Marketing Automation` / `Leads & CRM` / `Reports`
   (Workspace group) + `Users` / `Settings` (Admin group). `Proposals` becomes a tab inside Marketing
   Automation; `Usage & Credits` becomes a tab inside Settings. No route slugs are removed — `/campaigns`
   and `/credits` keep working, see Navigation section.
3. **A shared Pencil UI kit** built first (`components/pencil/`): design tokens, `PencilCard`,
   `KanbanBoard`/`KanbanColumn`/`KanbanCard`, `SideAssistantPanel` (the chat shell every AI side-panel in
   every mock shares), `StatusPill`, `TabStrip`. All three new/restyled pages compose from this one
   library — no page invents its own card/board chrome.
4. **Home**: 4 live metric cards, quick-action chips, "Recent AI activity" feed, restyling the existing
   `CopilotFab`/`CopilotPanel` rather than rebuilding them.
5. **Marketing Automation**: `KanbanBoard` (Draft/Active/Paused) over real campaign data, drag-to-column
   calling the existing `updateCampaignStatus`; Campaign Chat restyled into a `SideAssistantPanel`.
6. **Leads & CRM**: `KanbanBoard` over Twenty's pipeline stages — new backend work (see Scope
   amendments) — plus a CRM Assistant `SideAssistantPanel` implementing Spec 3's tool set, now able to
   also update the board.
7. **Reports**: implement Spec 2 as originally approved (chat-driven, model picks chart/table/number
   shape), restyled only — no structural change.
8. **Moderate motion**: Framer Motion (new dependency) for card/column entrance, Kanban drag-reorder
   (`Reorder.Group`), and chat message stream-in.

## Non-goals (this phase)

- **Rewriting v2's structural pieces.** `SidebarNav`'s role-filtering logic, `Breadcrumb`, `⌘K`
  `CommandPalette`, and `UserMenu`'s sign-out flow are all kept — only their visual tokens change (dark
  Pencil palette instead of the current light/dark theme), and `nav-config.ts`'s data is restructured
  per Goal 2. No new palette actions, no new breadcrumb logic.
- **Twenty's native MCP server**, per Spec 3's own Non-goals — still investigated-and-rejected for the
  same reason (feature-flagged, unverified stability); this spec's new Twenty calls still use the same
  stable REST endpoints `lib/crm/twenty.ts` already depends on.
- **New metrics/data sources for Reports**, per Spec 2's own Non-goals — still only
  `performance_snapshots`/`campaigns`/`proposals`, restyled presentation only.
- **Saved views, scheduled reports, CSV export beyond what Spec 2 already specified.**
- **A generic drag-and-drop library.** Framer Motion's `Reorder` component covers both entrance
  animation and Kanban reordering — no second dependency (e.g. `@dnd-kit`) is introduced.
- **Mobile-specific layout.** Unchanged stance from v1/v2: laptop-first internal tool.
- **Light mode.** This is a deliberate, permanent regression from v2's "both themes get this equally" —
  explicitly decided in brainstorming (Decision 3: pixel-faithful Pencil tokens, dark only), not an
  oversight.

## Scope amendments to Specs 2 and 3 (explicit, not silent)

Decided during brainstorming (surface-shape clarifier): the Pencil mocks show persistent boards/charts
as the primary surface with chat as a side assistant, which is a real scope change from how Specs 2/3
were originally written. Recorded precisely here so it isn't silently absorbed into "just a restyle":

| Spec | Originally approved scope | This spec's amendment | Why |
|---|---|---|---|
| Spec 2 (Reports) | Pure chat surface, `/reports` — ask a question, get back a chart/table/card. No persistent dashboard widget. | **No amendment.** The Pencil Reports mock (`04-reports-analytics.png`) *is* a chat-driven feed — "Ask anything" input, an already-asked question rendered as a chat turn, a chart card, a narrative reply, a table — matching Spec 2's design almost exactly. Restyle only. | Verified against the actual export before assuming a conflict existed. |
| Spec 3 (CRM) | Pure chat surface, `/crm` — list/search/get leads, one write tool (advance pipeline stage). No persistent board. | **Adds a persistent `KanbanBoard`** over Twenty's pipeline stages as the page's primary content, with the CRM Assistant chat as a side panel that can also drive the same board (optimistic update after a tool-call result). This requires **new** Twenty REST calls beyond Spec 3's original tool list: `listOpportunities`/`listPeople` for the board's initial render (Spec 3 only specified these as chat tools; now also called directly for the deterministic page load, per the OpenUI foundation's hybrid-rendering convention). | The `03-leads-crm.png` mock shows a real board as the dominant UI element, not a chat transcript — confirmed via Torbit that no list/search/get/update-stage call exists anywhere in the codebase today (`ads-agent/lib/connectors/twenty.ts` only has aggregate `fetchLeadSignal()`; `lib/crm/twenty.ts` only has lead-creation helpers), so this is genuinely new backend work, not a re-skin. The board's actual columns are the 7 real configured stages (`infra/twenty/README.md`), not the mock's guessed 4 labels — see the CRM page section below. |

Marketing Automation has no corresponding "spec" to amend — its Kanban board and Campaign Chat are new
UI over existing data (`listCampaignsWithLatestCpl`, `updateCampaignStatus`) and Spec 1's existing
`campaign-chat.ts`, not a previously-scoped chat-only surface.

## Approaches considered

### Build sequencing across pages

| Option | Trade-off |
|---|---|
| **Design-system-first (chosen)** | One wave builds tokens + `KanbanBoard`/`SideAssistantPanel`/`StatusPill`/`TabStrip` before page wiring. Maximizes parallelism across the up-to-8-subagent implementation plan and guarantees Home/Marketing/CRM/Reports look identical in chrome even though built by different agents. Slightly more upfront design work before any page is "done." |
| Page-by-page | Build Home fully, then CRM, then Reports, extracting shared components opportunistically. Simpler dependency graph, but real risk of visual drift (three different Kanban-card implementations) and less parallelism (each page blocks the next). |
| Hybrid (tokens + `Card`/`KanbanBoard` only, `SideAssistantPanel` per-page) | Rejected — `SideAssistantPanel` is used identically by all three chat surfaces (Campaign Chat, CRM Assistant, Reports chat) and by the global Copilot's visual language; building it three times and reconciling afterward is strictly more work than building it once. |

### CRM board drag-to-stage mutation

| Option | Trade-off |
|---|---|
| **Optimistic client update + `PATCH` to a new `/api/crm/opportunities/[id]/stage` route (chosen)** | Board feels instant (matches the "AI-first, responsive" product direction); on failure, revert the card to its original column and surface a toast — same fail-safe direction as v2's sign-out error handling. |
| Server Action, page reload on success | Simpler, but a full board re-render on every drag defeats the point of a Kanban board (no felt directness); rejected. |

## Design tokens (Pencil dark theme)

Defined once in `ads-agent/app/globals.css`'s `@theme inline` block, replacing the `prefers-color-scheme`
light/dark pair with fixed values (v2's radius scale — `--radius: 0.625rem` — is unchanged):

| Token | Value | Used for |
|---|---|---|
| `--background` | `#0A0A0A` | Page background |
| `--surface` | `#141417` | Sidebar, Kanban columns, cards, chat panel background |
| `--surface-raised` | `#1A1A1E` | Nested cards inside a card (e.g. Campaign Setup Preview inside chat) |
| `--border` | `#26262B` | Hairline borders/dividers (kept subtle, per v2's density goals) |
| `--foreground` | `#F5F5F7` | Primary text |
| `--muted-foreground` | `#8A8A93` | Secondary text, labels |
| `--accent` / `--accent-2` | `#7C5CFF` → `#BF40FF` | Primary buttons, active nav row, chat bubbles, progress bars — rendered as a gradient where the mock shows one (sparkle icons, primary CTA), solid `--accent` elsewhere |
| `--live` | `#00F2FF` | "Bifrost live" indicator, other live/streaming states |
| `--status-hot` | `#EF4444` | Hot lead tag, high-CPL warning |
| `--status-warm` | `#F97316` | Warm lead tag |
| `--status-cold` | `#38BDF8` | Cold lead tag |
| `--status-unscored` | `#6B6B72` | Unscored lead tag |
| `--status-positive` | `#22C55E` | Active campaign dot, low-CPL, positive delta arrows |

Font: Geist Sans (unchanged from v1/v2 — `next/font` config in `app/layout.tsx` is untouched).

## Architecture

```
ads-agent/
  app/
    globals.css                    # MODIFIED — @theme inline block: fixed dark tokens (table above),
                                    #             drop prefers-color-scheme dark: variant block
    (admin)/
      layout.tsx                    # MODIFIED — sidebar/header restyled to dark tokens; structure
                                     #             (breadcrumb, CommandPalette, UserMenu, Copilot) unchanged
      page.tsx                       # MODIFIED — Home: 4 direct StatCardView calls + quick-action
                                       #             chips + activity feed
      campaigns/
        page.tsx                     # MODIFIED — becomes Marketing Automation: KanbanBoard + TabStrip
                                      #             (Board/Proposals tabs navigate between real routes,
                                      #             no content extraction — see Navigation section)
      proposals/
        page.tsx                     # MODIFIED — adds the same TabStrip; list content unchanged
      crm/
        page.tsx                     # NEW — Leads & CRM: KanbanBoard (server component, initial fetch)
                                      #        + CrmAssistantPanel client island
      reports/
        page.tsx                     # NEW — Reports chat page, per Spec 2 (restyled only)
      credits/
        page.tsx                     # MODIFIED — adds the same TabStrip pattern (Workspace Settings/
                                      #             Usage & Credits tabs); listing content unchanged
      settings/
        page.tsx                     # MODIFIED — adds TabStrip; Decision cycle/Connector status
                                      #             content unchanged, restyled tokens only
  components/
    pencil/
      KanbanBoard.tsx                 # NEW — column layout + Framer Motion Reorder.Group wiring
      KanbanColumn.tsx                # NEW — column header (label + count) + card list
      KanbanCard.tsx                  # NEW — base card chrome; Campaign/Lead cards compose it
      SideAssistantPanel.tsx          # NEW — chat shell: header, message list, input bar — used by
                                       #        CampaignChat, CrmAssistantPanel, ReportsChat restyles
      StatusPill.tsx                  # NEW — hot/warm/cold/unscored and active/paused/draft tags
      TabStrip.tsx                    # NEW — Link-based tab nav between sibling routes (Board/
                                       #        Proposals; Workspace Settings/Usage & Credits),
                                       #        active tab derived from usePathname (same pattern as
                                       #        Breadcrumb.tsx), no content duplication
  lib/
    db/
      campaigns.ts                    # UNCHANGED — updateCampaignStatus already exists, reused as-is
    crm/
      twenty-pipeline.ts               # NEW — listOpportunities/listPeople/getOpportunity/
                                        #        updateOpportunityStage against Twenty's REST API
                                        #        (extends the pattern lib/crm/twenty.ts already uses)
      twenty-pipeline.test.ts          # NEW
    openui/
      crm-library.ts                   # NEW — Spec 3's OpportunityCard/OpportunityList/PersonResult/
                                        #        StageChangeConfirm, dual-mode convention, composed
                                        #        into platform-library.ts per the foundation spec
      crm-tools.ts                     # NEW — Spec 3's ToolSpec[] wrapping twenty-pipeline.ts
      analytics-library.ts             # NEW — Spec 2's TrendChart/DataTable, StatCard imported from
                                        #        shared-library.ts per the foundation spec's correction
      analytics-tools.ts               # NEW — Spec 2's ToolSpec[] wrapping lib/db/dashboard.ts/proposals.ts
  app/
    api/
      crm/
        opportunities/
          [id]/
            stage/
              route.ts                 # NEW — PATCH, requireApiRole("operator"), calls
                                        #        updateOpportunityStage; backs both the board's drag
                                        #        action and CRM Assistant's write tool
      crm/
        chat/
          route.ts                     # NEW — POST, streamed, per Spec 3's pattern, reuses
                                        #        bifrost-stream.ts/metered-stream-client.ts verbatim
      reports/
        chat/
          route.ts                     # NEW — POST, streamed, per Spec 2's pattern, same reuse
  package.json                          # MODIFIED — + framer-motion
```

## Navigation restructure

`lib/nav-config.ts`'s `NAV_GROUPS` changes shape and labels; `visibleNavGroups()`'s role-filtering logic
is unchanged:

```typescript
export const NAV_GROUPS: NavGroup[] = [
  {
    key: "workspace",
    label: "Workspace",
    items: [
      { href: "/", label: "Home", icon: LayoutDashboard, minRole: "viewer" },
      { href: "/campaigns", label: "Marketing Automation", icon: Megaphone, minRole: "operator" },
      { href: "/crm", label: "Leads & CRM", icon: Users2, minRole: "operator" },
      { href: "/reports", label: "Reports", icon: LineChart, minRole: "operator" },
    ],
  },
  {
    key: "admin",
    label: "Admin",
    items: [
      { href: "/users", label: "Users", icon: Users, minRole: "admin" },
      { href: "/settings", label: "Settings", icon: SettingsIcon, minRole: "admin" },
    ],
  },
];
```

- `/campaigns` keeps its route slug (renamed label only) so existing bookmarks/links don't break;
  Proposals renders as a tab within that page (`?tab=proposals` or a client-side tab, not a new route).
- `/credits` keeps its route slug too but is no longer in the sidebar — reachable as a tab inside
  `/settings` (Usage & Credits tab), consistent with the mock's "Settings & Users" merged screen.
- `/crm` and `/reports` are genuinely new routes.
- Breadcrumb logic in `components/Breadcrumb.tsx` needs no change — it already derives from
  `NAV_GROUPS`/route match, so new items/routes resolve automatically.

## Shared Pencil UI kit

| Component | Props (shape) | Used by |
|---|---|---|
| `KanbanBoard` | `columns: { key, label, count, cards: ReactNode[] }[]`, `onReorder?` | Marketing Automation, Leads & CRM |
| `KanbanColumn` | `label`, `count`, `children` | `KanbanBoard` (internal) |
| `KanbanCard` | `children`, `className?` — base padding/radius/hover chrome only | `CampaignCard` (Marketing), `LeadCard` (CRM) compose this, own their own content |
| `SideAssistantPanel` | `title`, `icon`, `messages`, `onSend`, `pinnedActionSlot?` (renders a confirm/preview card above the input, e.g. Campaign Setup Preview or Confirm Action) | Campaign Chat, CRM Assistant, Reports chat |
| `StatusPill` | `tone: "hot" \| "warm" \| "cold" \| "unscored" \| "active" \| "paused" \| "draft"`, `label` | Both Kanban boards |

**No new "MetricCard" component** — correction from initial design: `lib/openui/shared-metric-cards.ts`'s
`StatCardView`/`KpiGridView` (shipped in the OpenUI foundation) already render exactly Home's 4-stat
layout (label, value, delta+direction) via a direct, non-model call — building a second component for
the identical shape would violate the foundation spec's own "components render, callers format"
convention. Home imports and calls these directly instead.

All built on existing `components/ui/*` shadcn primitives — no new charting/table library (Reports'
charts reuse the already-installed `recharts`, unchanged from Spec 2's own plan).

## Page: Home (`app/(admin)/page.tsx`)

- 4 stat cards via a direct `StatCardView` call each (not a new component — see Shared Pencil UI kit):
  Active Campaigns (`getOverviewStats().activeCampaignCount`), Hot Leads 7d (`fetchLeadSignal().hotCount`),
  Pipeline Value (**new** — sum of open Twenty opportunity amounts, added to `twenty-pipeline.ts` as
  `getPipelineValue()`), AI Actions Today (**new** — count of rows in a new, small `ai_action_log`
  table, inserted whenever the Copilot/chat surfaces perform a mutation).
- Quick-action chips ("Show hot leads this week", "Pause underperforming campaigns", "Compare CPL vs
  last week") — each opens the global Copilot pre-seeded with that question, reusing `AskAiTrigger`'s
  handoff mechanism from the OpenUI foundation.
- "Recent AI activity" feed — two cards (Marketing, Leads & CRM) summarizing the most recent automated
  action per domain; reads the same `ai_action_log` as the AI Actions Today metric.
- The floating AI panel in the mock is the existing `CopilotFab`/`CopilotPanel`, restyled only.

## Page: Marketing Automation (`app/(admin)/campaigns/page.tsx`)

- `KanbanBoard` with columns Draft/Active/Paused, `CampaignCard` (platform icon, name, status dot,
  budget + progress bar, CPL colored by breakeven) sourced from `listCampaignsWithLatestCpl`.
- Drag a card to a new column → optimistic move + `PATCH` to a new
  `app/api/campaigns/[id]/status/route.ts` (thin wrapper around the already-existing
  `updateCampaignStatus`) → revert + toast on failure.
- Campaign Chat becomes a `SideAssistantPanel` instance; its existing logic
  (`campaign-chat.ts`/`campaign-library.ts`, Spec 1's parse-retry) is unchanged — only its visual shell
  changes.
- Proposals: `TabStrip` at the top of both `/campaigns` and `/proposals` (`[{href:"/campaigns",
  label:"Board"},{href:"/proposals",label:"Proposals"}]`) — real navigation between the two existing
  routes, not a content merge; `/proposals/[id]` is untouched.

## Page: Leads & CRM (`app/(admin)/crm/page.tsx`, new)

- Server component fetches `listOpportunities()` (new, `twenty-pipeline.ts`) grouped by stage for the
  initial deterministic render — per the OpenUI foundation's hybrid-rendering convention, this is a
  direct call, not a tool call, so opening the page never costs a model turn.
- `KanbanBoard` with columns matching Twenty's **actual configured pipeline**, per
  `infra/twenty/README.md`: New Brief (`NEW_BRIEF`) → Shortlist (`SHORTLIST`) → Tour (`TOUR`) →
  Negotiate (`NEGOTIATE`) → Legal (`LEGAL`) → Handover (`HANDOVER`) → Renewal (`RENEWAL`) — **7
  columns, not the 4 the mock's English labels ("New Brief/Qualified/Proposal/Won") suggested.**
  Correction found during spec-writing: the mock's column names were a plausible guess, not
  verified against the live workspace config; the real pipeline is more granular. The board scrolls
  horizontally for 7 columns rather than fitting 4 in the mock's fixed width — a real, deliberate
  deviation from the mock's exact visual layout in favor of representing the actual sales process.
- `LeadCard`: avatar placeholder, name + `StatusPill` (hot/warm/cold/unscored), masked phone, source/
  location, relative timestamp. **Verified via Torbit: no existing phone-masking utility exists anywhere
  in the codebase** (checked `lib/` and `ads-agent/`) — this is new, small logic (`maskPhone()` in
  `twenty-pipeline.ts`, e.g. `+91 8XXXXX-4471` from a full number), not a reuse of prior art.
- Drag a card to a new column → optimistic move + `PATCH /api/crm/opportunities/[id]/stage` (new route,
  wraps new `updateOpportunityStage`).
- CRM Assistant `SideAssistantPanel` implements Spec 3's tools (`crm-library.ts`/`crm-tools.ts`): list/
  search/get/advance-stage. A successful advance-stage tool call updates the board optimistically via
  the same client-side state the drag handler uses (one state owner, two triggers — drag and chat).
  Spec 3's `StageChangeConfirm` component renders as `SideAssistantPanel`'s `pinnedActionSlot`, matching
  the mock's "CONFIRM ACTION" card exactly.
- PII handling: per Spec 3's own explicit decisions (names/phone numbers) — reused verbatim, not
  re-decided here.

## Page: Reports (`app/(admin)/reports/page.tsx`, new)

Implements Spec 2 exactly as approved: `/reports` chat surface, `analytics-library.ts`/
`analytics-tools.ts` wrapping `dashboard.ts`/`proposals.ts` read functions, model picks
chart/table/number-card shape. `SideAssistantPanel` is not used here — Reports' chat *is* the whole
page (matching the mock, which has no separate side panel), so this page composes
`TrendChart`/`DataTable`/`InsightCallout` directly in a scrolling feed layout, with the input bar pinned
to the bottom (visually similar to `SideAssistantPanel`'s input, but the page itself supplies the
message-list layout since there's no adjacent board to share space with).

## Page: Settings & Users

- `/users` keeps its own route + sidebar entry unchanged (per Goal 2 — Users stays a top-level Admin
  item), restyled tokens only, no structural change.
- `/settings` and `/credits` get the same `TabStrip` (`[{href:"/settings",label:"Workspace Settings"},
  {href:"/credits",label:"Usage & Credits"}]`) — real navigation between the two existing routes, same
  pattern as Marketing Automation/Proposals above. Their existing content (Decision cycle/Connector
  status; org balance/members/spend tables) is unchanged, restyled tokens only. The mock's additional
  Notifications/Integrations/API Keys/Access & Roles rows are **not built** in this phase — no task
  below fabricates non-functional nav rows for them (would violate "no placeholders").

## Motion

Framer Motion (new `package.json` dependency):

- `KanbanBoard`/`KanbanColumn` cards: `motion.div` fade+slight-y entrance on mount/filter-change.
- Drag-reorder within and across columns: `Reorder.Group`/`Reorder.Item`, `onReorder` updates local
  column state immediately (optimistic), the drag-end handler fires the `PATCH` described above.
- `SideAssistantPanel` messages: new messages animate in (fade+slide), matching a standard chat feel;
  no per-character streaming animation beyond what the existing `metered-stream-client.ts` SSE handling
  already produces.
- No page-transition animation between routes — out of scope, not mentioned in any mock.

## New backend work summary

| New capability | File | Backs |
|---|---|---|
| `listOpportunities`, `listPeople`, `getOpportunity`, `updateOpportunityStage` | `lib/crm/twenty-pipeline.ts` | CRM board initial render, CRM Assistant tools, drag-to-stage |
| `getPipelineValue` | `lib/crm/twenty-pipeline.ts` | Home's Pipeline Value metric |
| `crm-library.ts`/`crm-tools.ts` | `lib/openui/` | Spec 3, composed into `platform-library.ts`/`platform-tools.ts` per the foundation spec |
| `analytics-library.ts`/`analytics-tools.ts` | `lib/openui/` | Spec 2, same composition |
| `PATCH /api/campaigns/[id]/status` | `app/api/campaigns/[id]/status/route.ts` | Marketing board drag (wraps existing `updateCampaignStatus`) |
| `PATCH /api/crm/opportunities/[id]/stage` | `app/api/crm/opportunities/[id]/stage/route.ts` | CRM board drag + CRM Assistant write tool |
| `ai_action_log` (new table or reuse of an existing audit table if one exists — implementation plan to confirm) | `lib/db/` | Home's "AI Actions Today" metric + "Recent AI activity" feed |

## Testing

Following this repo's existing convention (thin pages, `lib/*.ts` carries logic, colocated `*.test.ts`):

- `lib/crm/twenty-pipeline.test.ts` — mocked Twenty REST responses for list/search/get/update-stage,
  including the masking/PII decisions Spec 3 already specified.
- `lib/openui/crm-library.test.ts`, `analytics-library.test.ts` — static-props render tests, per the
  foundation spec's existing pattern (`shared-library.test.ts`).
- `lib/openui/crm-tools.test.ts`, `analytics-tools.test.ts` — tool schema + parse-retry pair (one
  retry-then-succeed, one give-up-after-one-failure), per the foundation spec's Resilience convention.
- `components/pencil/KanbanBoard.test.tsx`-equivalent structural test (no `@testing-library/react` —
  Vitest structural/snapshot-style tests per the foundation constraint) — column counts, card ordering
  reflects props.
- `nav-config.test.ts` — updated for the new group shape; existing role-filter assertions re-verified
  against the new items.
- Manual smoke: drag a campaign card across columns and confirm `updateCampaignStatus` fires; drag a
  lead card and confirm the new stage PATCH fires; ask CRM Assistant to advance a lead and confirm the
  board updates without a manual refresh; ask Reports a question and confirm a chart/table renders.
- `npm run build && npm run lint && npm test` pass with zero new warnings.

## Success criteria

- All five Pencil screens (Home, Marketing Automation, Leads & CRM, Reports, Settings & Users) are
  live at their routes, matching the mocks' dark palette, layout, and component chrome.
- Sidebar shows the new IA (Home/Marketing Automation/Leads & CRM/Reports, Users/Settings); no existing
  route slug 404s.
- Dragging a card on either Kanban board persists the change (confirmed via a page refresh showing the
  new column, not just optimistic UI).
- CRM Assistant's advance-stage tool call updates the board live, in the same session, without a manual
  refresh.
- Reports renders at least a chart, a table, and a narrative response type across a manual smoke pass,
  per Spec 2's own success criteria (unchanged).
- No page load triggers an LLM call or a credit-ledger debit — same invariant as the foundation spec,
  re-verified for the two new pages (CRM, Reports).
- `npm run build && npm run lint && npm test` pass, zero new warnings.

## Implementation order (high level — informs wave sequencing in the parallel plan)

1. Design tokens (`globals.css`) + shared Pencil UI kit (`components/pencil/*`) + tests — no page
   dependency, can fan out internally (tokens → components in parallel once tokens land).
2. Nav restructure (`nav-config.ts` + `Breadcrumb` verification) — small, unblocks page work referencing
   new routes.
3. Home restyle + new metrics (`getPipelineValue`, `ai_action_log` groundwork) — depends on 1.
4. Marketing Automation board + status route — depends on 1, reuses existing `updateCampaignStatus`.
5. `twenty-pipeline.ts` + `crm-library.ts`/`crm-tools.ts` + stage route — can start in parallel with 3/4
   (no shared files), gates the CRM page.
6. Leads & CRM page (board + CRM Assistant wiring) — depends on 1 and 5.
7. `analytics-library.ts`/`analytics-tools.ts` + Reports page — depends on 1, otherwise independent of
   3-6 (Spec 2 restyle-only, lowest risk, can run anytime after tokens land).
8. Settings & Users tab reorganization — depends on 1 and 2, otherwise independent.
9. Motion pass (Framer Motion install + `Reorder` wiring in `KanbanBoard`) — depends on 4 and 6 (both
   boards must exist), can trail the rest.
