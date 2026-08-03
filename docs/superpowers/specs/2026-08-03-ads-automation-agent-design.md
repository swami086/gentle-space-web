# Ads automation agent (custom Ryze AI-equivalent) — Phase 1: connectors, decision engine, human-gated execution

Date: 2026-08-03
Status: approved (pending user review of this written spec)
Related: supersedes-in-part the unwritten performance-marketing brainstorm from earlier in this
session (budget/audience/landing-page decisions below are carried over from that discussion,
never previously committed to a file), and depends on
[`docs/superpowers/specs/2026-08-01-twenty-crm-local-integration-design.md`](2026-08-01-twenty-crm-local-integration-design.md)
(implemented — `lib/crm/twenty.ts`) for CRM read access.

## Problem

Gentle Space wants to run paid acquisition on Meta and Google Ads without manually operating
either platform's UI — proposing campaigns, monitoring performance, and adjusting budgets/bids/
keywords should happen through code the user owns, modeled on tools like Ryze AI (API-first,
autonomous ad management). No ad accounts have live campaigns yet (Business Manager / Google
Ads accounts exist, but nothing has been launched), and API credentials are only partially in
place. Trust in unsupervised spend decisions has to be earned — there's no historical
performance or CRM conversion data yet to validate a decision engine against.

## Goals

1. A separate, independently-runnable Next.js service (`ads-agent/`, same git repo, own
   package.json/port/Postgres) that can read Meta Marketing API + Google Ads API performance
   data and Twenty CRM lead-quality signals, and propose campaign creation and ongoing
   optimization actions — without the user ever needing to open Ads Manager or Google Ads UI.
2. Every single write action to a live ad account — including the very first campaign ever
   created — goes through one uniform human approval gate (an admin page: Approve/Reject) before
   any API call executes. No autonomous execution in this phase.
3. A cron-driven worker that polls performance + CRM signals on a schedule, gated by a
   persisted on/off toggle the user controls from the admin UI, so testing can be paused/resumed
   without code changes or redeploys.
4. A deterministic (rule-based) decision core so every proposal is explainable and reproducible
   from raw numbers, with an LLM used only to draft the human-readable rationale shown alongside
   each proposal — never to decide the action itself.
5. Full audit trail: every proposed action, why it was triggered, what the user decided, and
   what happened when executed, all in one `proposals` table.

## Non-goals (this phase)

- Autonomous execution without approval. A later phase may remove the gate for narrow,
  well-proven action types once there's a track record — not in scope now.
- Notifications/alerts (Slack/WhatsApp/email) for new proposals — deferred; user checks the
  admin page manually.
- Auth on the admin UI — local-only, single user (the business owner).
- Production deployment (VM, Caddy subdomain, Docker Compose prod) — local-only for this phase.
- Ad creative generation or testing (copy, images/video) — user supplies creative manually when
  a `create_campaign` proposal needs it.
- Channels beyond Meta + Google Ads (e.g. LinkedIn).
- A new/separate git repository — lives inside this repo as a new top-level `ads-agent/` folder.
- Formalizing the underlying paid-media strategy (corridor list, exact negative-keyword list,
  ad copy frameworks) as its own reviewed spec — captured here only as an editable seed config
  (`strategy-config.ts`) sufficient to unblock the decision engine, not a substitute for that
  earlier unwritten brainstorm if the user wants it formalized later.

## Approaches considered

### Scope decomposition (before any architecture)

"All the capabilities of Ryze AI" spans four largely-independent subsystems: platform
connectors, a CRM/performance signal source, a decision engine, and a safety/guardrail layer.
Rather than spec all four with autonomous live writes on day one, this spec covers a
**dry-run-to-human-gated** first phase: full connector + decision-engine capability, zero
unsupervised spend risk, because every write (including initial campaign creation) requires an
explicit approval click. Autonomous execution without approval is an explicit non-goal, deferred
to a future phase once the decision engine has a track record against real data.

### Scheduler mechanism

| # | Approach | Trade-off |
|---|----------|-----------|
| A (chosen) | Standalone `tsx` worker script (`scripts/run-decision-cycle.ts`) using `node-cron`, separate process from the Next.js admin app; checks a DB toggle each tick | Matches this repo's existing background-job convention (`scripts/run-listings-sync.ts` etc.) exactly; two processes to run locally, but each has one job |
| B | In-process scheduler inside a custom Next.js server | One process, but custom servers are a non-default pattern for this project's Next.js version; unverified against current framework docs, added risk for no benefit at this scale |
| C | API route triggered by external/OS cron | Clean decoupling, but for local-only use requires configuring the user's OS-level `crontab` just to test — more setup friction than A for zero benefit right now |

**Decision:** Approach A. Confirmed with user.

### Decision engine intelligence

| # | Approach | Trade-off |
|---|----------|-----------|
| Rules-only | Pure deterministic thresholds, no LLM | Fully predictable, but proposals in the admin UI are just raw numbers — harder to skim/trust at a glance |
| LLM-driven | Feed raw performance + CRM data to an LLM each cycle, let it reason out proposals | Most "autonomous-feeling," but risks an LLM inventing a numerically bad decision — unacceptable given real ad spend is on the line |
| Hybrid (chosen) | Deterministic rules/thresholds decide **whether** a proposal fires; an LLM call drafts only the **human-readable rationale** shown in the admin UI | Predictable + explainable action semantics, with LLM value confined to something a bad LLM call can only degrade cosmetically (fallback string), never corrupt a decision |

**Decision:** Hybrid. Confirmed with user.

## Architecture

```text
ads-agent/                         (new top-level folder, own package.json, own port e.g. 3030)
  app/                             Next.js admin UI + API routes
    (admin)/proposals/             List + detail pages, Approve/Reject buttons
    (admin)/settings/              Cron enabled/disabled toggle, last_run_at, manual "Run now"
    api/proposals/[id]/approve/    POST → executor → real Meta/Google API call → status: executed
    api/proposals/[id]/reject/     POST → status: rejected, no API call
  lib/
    connectors/meta.ts             Wraps facebook-nodejs-business-sdk (read insights; write campaign/adset/ad/budget)
    connectors/google-ads.ts       Wraps google-ads-api (GAQL reporting; write campaign/ad group/ad/budget)
    connectors/twenty.ts           Read-only: lead tier/stage signal, extends lib/crm/twenty.ts's client pattern
    decision-engine/strategy-config.ts   Editable seed config: budget, audience split, corridors, negative-keyword seeds, breakeven CPL
    decision-engine/rules.ts       Deterministic threshold checks → 0+ Proposal objects per cycle
    decision-engine/rationale.ts   LLM call (reuses lib/ai/client.ts's provider-agnostic facade pattern) drafts rationale text
    decision-engine/cycle.ts       One decision cycle: fetch signals → run rules → write `proposals` rows
    executor/execute.ts            Approved proposal → matching connector write call → records result
    db/                            Postgres client + schema/migrations (own local Postgres, Docker, mirrors infra/twenty/)
  scripts/
    run-decision-cycle.ts          node-cron wrapper; checks cron_settings.enabled each tick before running lib/decision-engine/cycle.ts
    run-once.ts                    Manual single-cycle trigger for testing, bypasses the schedule
```

### Data flow (one decision cycle)

1. Worker checks `cron_settings.enabled` — if `false`, skip and exit.
2. Pull performance via `connectors/meta.ts` + `connectors/google-ads.ts` (spend, clicks,
   impressions, conversions per campaign/ad group), write to `performance_snapshots`.
3. Pull CRM signal via `connectors/twenty.ts` (Hot/Warm/Cold/Unscored counts, attributed to a
   campaign via `corridor`/source where possible), write to `crm_signal_snapshots`.
4. `decision-engine/rules.ts` evaluates every rule against latest snapshots + `strategy-config.ts`
   → zero or more triggered rules.
5. For each trigger, `decision-engine/rationale.ts` drafts a short plain-English explanation.
6. Each triggered rule becomes one `proposals` row (`status: pending`) with the exact API-call
   payload the executor would use, plus `triggered_rule` and `rationale`.
7. User reviews `/proposals` in the admin UI, clicks Approve or Reject.
8. On approve, `executor/execute.ts` calls the real connector write method → `status: executed`
   (or `failed`, with `error` populated — never auto-retried).

Nothing calls a Meta/Google **write** endpoint without a corresponding `proposals` row first
being explicitly approved by the user — including the first campaign ever created.

## Data model (own local Postgres, Docker Compose, mirrors `infra/twenty/`)

```sql
campaigns (
  id              uuid primary key,
  platform        text not null,        -- 'meta' | 'google'
  external_id     text,                 -- null until the create_campaign proposal is approved
  name            text not null,
  status          text not null,        -- 'proposed' | 'active' | 'paused' | 'removed'
  daily_budget    numeric,
  corridor        text,                 -- e.g. 'whitefield' — links to landing page / CRM source tag
  created_at      timestamptz default now()
)

performance_snapshots (
  id              uuid primary key,
  campaign_id     uuid references campaigns(id),
  captured_at     timestamptz not null,
  spend           numeric, clicks int, impressions int, conversions int,
  cpl             numeric,              -- computed: spend / conversions
  raw             jsonb                 -- full API response, kept for debugging
)

crm_signal_snapshots (
  id              uuid primary key,
  campaign_id     uuid references campaigns(id),   -- nullable — not every lead is attributable yet
  captured_at     timestamptz not null,
  hot_count int, warm_count int, cold_count int, unscored_count int
)

proposals (
  id              uuid primary key,
  kind            text not null,        -- 'create_campaign' | 'pause' | 'budget_change' | 'add_negative_keyword'
  campaign_id     uuid references campaigns(id),   -- null for create_campaign
  payload         jsonb not null,       -- exact API call args the executor uses if approved
  triggered_rule  text not null,
  rationale       text,                 -- LLM-drafted explanation; falls back to a generic string on LLM failure
  status          text not null default 'pending',  -- 'pending' | 'approved' | 'rejected' | 'executed' | 'failed'
  error           text,
  created_at      timestamptz default now(),
  decided_at      timestamptz,
  executed_at     timestamptz
)

cron_settings (
  id              int primary key default 1,
  enabled         boolean not null default false,   -- starts OFF
  last_run_at     timestamptz
)
```

Every write action traces back to exactly one `proposals` row — the audit trail is: what was
proposed, why (`triggered_rule` + `rationale`), what the user decided, and what happened on
execution.

## Decision engine detail

```ts
// ads-agent/lib/decision-engine/strategy-config.ts
export const STRATEGY = {
  monthlyBudgetInr: 70_000,
  audienceSplit: { tenant: 0.8, owner: 0.2 },
  optimizeFor: "hot_warm_leads",       // quality over volume — from earlier planning session
  breakevenCplInr: 2_500,              // PLACEHOLDER — a guessed default, not derived from real
                                        // deal economics; user was unsure of the real figure.
                                        // Revisit once ≥30 days of real conversion data exists.
  corridors: ["whitefield", "koramangala", "hsr", /* extend as needed */],
  negativeKeywordSeeds: ["residential", "rent flat", "pg", "1bhk", /* extend as needed */],
};
```

| Rule | Trigger | Proposal kind |
|---|---|---|
| Kill rule | CPL > 1.4× `breakevenCplInr` for 3+ consecutive days on a campaign | `pause` |
| Budget reallocation | Campaign's Hot+Warm lead share is ≥2× the account average | `budget_change` (increase, capped by budget ceiling guard below) |
| Negative keyword | Google search-terms report shows a query matching `negativeKeywordSeeds` patterns, clicks with 0 conversions | `add_negative_keyword` |
| Budget ceiling guard | Sum of active campaigns' daily budgets would exceed `monthlyBudgetInr / 30` | Hard cap — blocks proposal creation entirely, does not even reach `pending` |
| New campaign proposal | Manually triggered (not cron) for a chosen corridor/intent | `create_campaign`, structure per `STRATEGY.corridors` + Brand/Non-brand/Competitor/Remarketing split from earlier planning session |

`decision-engine/rationale.ts` calls `lib/ai/client.ts`'s existing provider-agnostic facade (same
pattern as `qualifyLead`/`explainListingFit`) with the rule's raw numbers, producing 2-3 sentences
of plain-English rationale for the admin page. This never influences *whether* a rule fires — a
failed/malformed LLM call falls back to a generic string, never blocks or alters the proposal.

## Admin UI, executor, credentials

**Admin UI (`app/(admin)/`)**
- `/proposals` — table (kind, campaign, triggered rule, rationale snippet, created date, status),
  filterable, defaults to `pending`.
- `/proposals/[id]` — full payload rendered readably, full rationale, Approve/Reject buttons.
- `/settings` — `cron_settings.enabled` toggle, `last_run_at` display, manual "Run cycle now"
  button (calls `decision-engine/cycle.ts` directly, useful without waiting on the schedule).
- No authentication in this phase — local-only, single user.

**Executor (`lib/executor/execute.ts`)**
- Takes one `proposals` row where `status = 'approved'`.
- Switches on `kind` → calls the matching connector write method.
- Success: `status = 'executed'`, `executed_at` set; for `create_campaign`, the `campaigns` row
  gets its real `external_id` and `status = 'active'`.
- Failure: `status = 'failed'`, `error` populated with the API's error message. **Never
  auto-retried** — sits for the user to inspect and re-approve or fix manually.

**Credentials (documented in `ads-agent/README.md`, manual bootstrap)**

| Platform | What's needed | Lead time |
|---|---|---|
| Meta | Developer app + `ads_management` permission (Standard/Limited Access auto-granted for own ad account — no app review required) | Same day |
| Google Ads | Developer token, apply for **Basic Access** (15,000 ops/day) | ~5 business days — start early, in parallel with implementation, not sequentially after |
| Twenty | Reuse existing `TWENTY_BASE_URL` / `TWENTY_API_KEY` | None — already live |

```bash
# ads-agent/.env.example
META_APP_ID=
META_APP_SECRET=
META_ACCESS_TOKEN=
META_AD_ACCOUNT_ID=
GOOGLE_ADS_DEVELOPER_TOKEN=
GOOGLE_ADS_CLIENT_ID=
GOOGLE_ADS_CLIENT_SECRET=
GOOGLE_ADS_REFRESH_TOKEN=
GOOGLE_ADS_CUSTOMER_ID=
TWENTY_BASE_URL=http://localhost:3020
TWENTY_API_KEY=
DATABASE_URL=postgres://...   # ads-agent's own local Postgres, distinct from listings PG and Twenty's PG
```

## Testing

- `decision-engine/rules.ts`: pure functions; one unit test per rule with synthetic data both
  crossing and just-under each threshold.
- `connectors/*`: integration tests run against a **test ad account** (Meta test account /
  Google Ads test manager account) — never the real account in automated tests.
- `executor/execute.ts`: unit test with a mocked connector — asserts a `failed` proposal is never
  retried automatically; asserts `campaigns.external_id`/`status` update correctly on a
  successful `create_campaign` execution.
- End-to-end smoke test (manual, once real credentials exist): `cron_settings.enabled = false`
  by default → confirm the worker skips → flip to `true` → confirm one cycle runs and writes
  proposals but executes nothing → approve one → confirm it hits the real (or test) API.

## Success criteria

- [ ] `ads-agent/` runs locally (`npm run dev` + `npm run worker`) against its own Postgres,
      independent of the main site's processes and database.
- [ ] With `cron_settings.enabled = false`, the worker ticks on schedule but performs zero API
      calls (verified via logs).
- [ ] Flipping the toggle to `true` via `/settings` causes the next tick to run a real decision
      cycle and write ≥0 `proposals` rows.
- [ ] An approved `create_campaign` proposal results in a real (or test-account) campaign
      existing on the target platform, and the local `campaigns` row receives the real
      `external_id`.
- [ ] A rejected proposal never triggers any platform API call.
- [ ] A failed execution is visibly marked `failed` with an error message in the admin UI, and
      is never retried automatically.
- [ ] Stopping the worker process or disabling the toggle immediately halts all future decision
      cycles — no in-flight autonomous action continues afterward.

## Implementation order (high level)

1. Scaffold `ads-agent/` (Next.js app, own `package.json`/port, Postgres via Docker Compose
   mirroring `infra/twenty/`).
2. Data model + migrations (`campaigns`, `performance_snapshots`, `crm_signal_snapshots`,
   `proposals`, `cron_settings`).
3. `connectors/twenty.ts` (read-only — no ad-platform credentials required, unblocks earliest
   testing).
4. Apply for Google Ads Basic Access + set up the Meta developer app **now**, in parallel with
   steps 1-3 (5-business-day lead time on the Google side is the long pole).
5. `connectors/meta.ts` + `connectors/google-ads.ts` — read methods first, write methods as
   clearly separate, distinctly-named functions.
6. `decision-engine/rules.ts` + `strategy-config.ts` + unit tests.
7. `decision-engine/rationale.ts` (reusing `lib/ai/client.ts`).
8. Admin UI: `/proposals`, `/proposals/[id]`, `/settings`.
9. `executor/execute.ts` wired to the Approve action.
10. `scripts/run-decision-cycle.ts` (worker) + `scripts/run-once.ts` (manual trigger).
11. Smoke-test every path end-to-end against test ad accounts before pointing at real spend.

Detailed task breakdown follows in a writing-plans doc after this spec is reviewed.
