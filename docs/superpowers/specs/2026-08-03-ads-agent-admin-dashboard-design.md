# ads-agent admin dashboard — a real UI for orchestrating marketing automation

Date: 2026-08-03
Status: approved (pending user review of this written spec)
Related: builds on
[`docs/superpowers/specs/2026-08-03-ads-automation-agent-design.md`](2026-08-03-ads-automation-agent-design.md)
(implemented — `ads-agent/`). Depends on nothing new outside `ads-agent/`.

## Problem

`ads-agent`'s admin UI (`/proposals`, `/settings`) works but is unstyled — plain `<table>`/`<p>` tags,
no visual hierarchy, no way to see campaign or spend context without reading raw JSON payloads. The
user wants a real dashboard to orchestrate the whole system (see what's running, what's pending
approval, what the numbers look like) without reading database rows by hand.

## Goals

1. A styled, navigable admin dashboard for `ads-agent` with four pages behind a persistent sidebar:
   **Overview**, **Campaigns**, **Proposals**, **Settings**.
2. Overview surfaces the numbers that matter at a glance: active campaign count, pending proposal
   count, this-month spend, blended CPL vs. breakeven, and a spend/CPL trend chart — wired to real
   data now, even though it will render empty/flat until campaigns actually run.
3. Campaigns page gives read visibility into every campaign (platform, status, budget, corridor,
   latest CPL) without adding any new way to change a live ad account outside the existing
   proposal-approval gate.
4. Proposals and Settings keep their existing behavior (approve/reject, cron toggle, run-cycle-now)
   but get restyled with real components, status badges, and filter tabs. Settings additionally
   surfaces which connector credentials are actually configured (booleans only, never secret values).
5. Consistent visual language (one component library, one accent color, one corner-radius scale)
   across all four pages.

## Non-goals (this phase)

- Any new write path to a live ad account. The Campaigns page is read-only — pausing or rebudgeting
  a campaign still only happens by approving a proposal from the decision engine.
- Auth on the admin UI — unchanged from the original design (local-only, single user).
- Mobile-responsive polish beyond "doesn't break" — this is a local single-user tool used on a
  laptop, not a public-facing surface.
- Historical backfill of spend/CPL data — the trend chart reads whatever's already in
  `performance_snapshots`; no synthetic demo data.
- Notifications/alerts — still out of scope per the original spec.

## Design-system note (`design-taste-frontend` skill)

`design-taste-frontend` was consulted as requested, but its own Section 13 explicitly lists
"dashboards / dense product UI / admin panels" as **out of scope**, pointing instead to its
Section 2.A design-system table. That table's own recommendation for "modern SaaS where you own
the components" is **shadcn/ui** — which is independently what the UI-stack research below already
converged on. So the two aren't in conflict; the skill's landing-page-specific rules (hero
composition, eyebrow rationing, em-dash bans, bento-grid rhythm, marquees, etc.) simply don't apply
here and are not used. What *is* borrowed, because it's universal UI hygiene rather than a
landing-page pattern: dual light/dark mode support, WCAG AA button and form contrast, one accent
color and one corner-radius scale applied consistently, explicit empty/loading/error states, and
`prefers-reduced-motion` respected for any transition used.

## Approaches considered

### UI stack

| Option | Trade-off |
|---|---|
| **shadcn/ui + Tailwind v4 (chosen)** | Free/OSS, matches the main GentleSpace_Web app's existing Tailwind v4, full ownership of component code — needed for the custom approve/reject/toggle flows. Requires installing Tailwind into `ads-agent/` from scratch (currently has none). |
| Tremor | Purpose-built for dashboard charts/KPI cards, faster to a good-looking Overview page, but weaker for the bespoke approve/reject list and forms — would end up mixing two libraries. |
| Paid admin template (e.g. shadcnuikit.com) | Fastest visual polish out of the box, but a new paid dependency for a one-user local tool; not worth the cost for this scope. |

### Chart library

shadcn's `chart` component wraps **Recharts** — chosen because it's the path of least resistance
once shadcn/ui is already the component base (no extra design-system decision needed).

### Icon library

`design-taste-frontend` discourages `lucide-react` as a *landing-page* default, but shadcn/ui's own
ecosystem and generated component code use `lucide-react` throughout. Since this is explicitly an
admin panel (out of scope for that skill) and consistency with shadcn's own generated code avoids
a second icon package, **`lucide-react`** is used here without the discouragement applying.

## Architecture

```
ads-agent/
  app/
    (admin)/
      layout.tsx          # NEW — sidebar + top bar shell, wraps all 4 pages
      page.tsx             # NEW — Overview (KPI cards + trend chart + recent proposals)
      campaigns/
        page.tsx           # NEW — read-only campaigns table
      proposals/
        page.tsx           # RESTYLED — status tabs + table
        [id]/page.tsx      # RESTYLED — detail card + approve/reject
        [id]/ProposalActions.tsx   # RESTYLED (shadcn Button)
      settings/
        page.tsx           # RESTYLED — cron toggle, run-now, connector status panel
        SettingsForm.tsx   # RESTYLED (shadcn Switch, Button)
  components/
    ui/                    # NEW — shadcn-generated primitives (button, card, table,
                            #        badge, switch, tabs, sidebar, chart, separator, ...)
  lib/
    db/
      dashboard.ts          # NEW — aggregate KPI + trend-series queries
    env-status.ts           # NEW — boolean connector-configured checks
```

The existing `app/(admin)/proposals/*` and `app/(admin)/settings/*` route structure and API routes
(`app/api/proposals/[id]/approve`, `/reject`, `app/api/settings`, `app/api/cycle/run`) are unchanged
— this is a presentation-layer pass plus two new read-only pages, not a re-architecture.

### Sidebar layout

```
┌─────────────┬──────────────────────────────────────────────┐
│  ads-agent  │  Cron: ● ON  ·  Last run: 2h ago   [Run now] │
├─────────────┤──────────────────────────────────────────────┤
│ ◆ Overview  │                                              │
│   Campaigns │                <page content>                │
│   Proposals │                                              │
│   Settings  │                                              │
└─────────────┴──────────────────────────────────────────────┘
```

The top bar's cron status/run-now control is shared across all four pages (rendered once in
`(admin)/layout.tsx`), so "run cycle now" no longer lives only on Settings — Settings keeps the
toggle itself plus the new connector-status panel.

## Data model changes

No new tables. Two new read-only modules on top of the existing schema:

### `lib/db/dashboard.ts`

```typescript
export type OverviewStats = {
  activeCampaignCount: number;
  pendingProposalCount: number;
  monthSpendInr: number;
  blendedCplInr: number | null; // null if zero conversions this month
};

export type TrendPoint = { date: string; spendInr: number; cplInr: number | null };
export type CampaignRow = {
  id: string; name: string; platform: Platform; status: CampaignStatus;
  dailyBudget: number | null; corridor: string | null; latestCplInr: number | null;
};

export async function getOverviewStats(): Promise<OverviewStats>;
export async function getSpendCplTrend(days: number): Promise<TrendPoint[]>;
export async function listCampaignsWithLatestCpl(): Promise<CampaignRow[]>;
```

- `getOverviewStats`: active count from `campaigns`, pending count from `proposals`, spend/CPL
  aggregated from `performance_snapshots` where `captured_at >= date_trunc('month', now())`.
- `getSpendCplTrend`: `performance_snapshots` grouped by day for the last N days (default 30),
  summed spend, blended CPL (`spend / conversions`, null when conversions is 0).
- `listCampaignsWithLatestCpl`: `campaigns` left-joined to each campaign's most recent
  `performance_snapshots` row (`DISTINCT ON (campaign_id) ... ORDER BY captured_at DESC`).

### `lib/env-status.ts`

```typescript
export type ConnectorStatus = { meta: boolean; googleAds: boolean; twenty: boolean; openai: boolean };
export function getConnectorStatus(): ConnectorStatus;
```

Pure boolean presence checks (`Boolean(process.env.META_ACCESS_TOKEN?.trim())`, etc.) — synchronous,
no I/O, never returns or logs the actual values.

## UI states

Per page, following the "always implement full cycles" hygiene borrowed from the design skill:

- **Overview**: if there are zero campaigns yet, KPI cards show `0` / `—` (not blank), and the
  trend chart area shows "No performance data yet — once campaigns run, this fills in" instead of
  an empty chart canvas.
- **Campaigns**: empty table state — "No campaigns yet. Proposals will appear here once the
  decision engine creates one." (mirrors the existing Proposals empty state pattern).
- **Proposals / Settings**: unchanged behavior, restyled with the same empty/error states already
  written (e.g. "No pending proposals.").
- Errors from a failed action (e.g. approve → execute failure) continue to surface via the existing
  `proposal.error` field, now rendered as an inline alert instead of a raw paragraph.

## Testing

Same TDD pattern as the rest of `ads-agent`:

- `lib/db/dashboard.test.ts` — mock the pg pool (as `campaigns.test.ts` / `proposals.test.ts`
  already do) and assert the SQL/aggregation logic for each of the three functions, including the
  zero-conversions-null-CPL edge case and the zero-campaigns empty case.
- `lib/env-status.test.ts` — set/unset env vars per test, assert booleans, assert no secret value
  ever appears in the returned object.
- Page components stay thin (server components rendering the above query results plus shadcn
  primitives); the query-layer tests carry the real logic coverage, matching how `proposals/page.tsx`
  is structured today. No new component-testing framework is introduced.

## Success criteria

- `npm run dev` in `ads-agent/` shows a styled sidebar with 4 working pages.
- Overview renders real numbers (zero-state correct with no campaigns yet).
- Campaigns table lists whatever's in the `campaigns` table with correct status badges; no new
  write actions are reachable from that page.
- Proposals/Settings retain all existing approve/reject/toggle/run-now behavior, restyled.
- Settings shows accurate configured/not-configured status for Meta, Google Ads, Twenty CRM, and
  OpenAI, with zero secret values ever rendered or logged.
- `npm test` and `npm run lint` pass with no new warnings introduced.

## Implementation order (high level)

1. Install Tailwind v4 + shadcn/ui into `ads-agent/` (`components.json`, `lib/utils.ts`, base
   primitives: button, card, table, badge, switch, tabs, separator, sidebar, chart).
2. `lib/db/dashboard.ts` + `lib/env-status.ts`, TDD (these have no UI dependency, can go first/parallel).
3. `(admin)/layout.tsx` sidebar + top bar shell.
4. Overview page (depends on 1-3).
5. Campaigns page (depends on 1-3).
6. Restyle Proposals list + detail + Settings (depends on 1-3; independent of 4-5).
