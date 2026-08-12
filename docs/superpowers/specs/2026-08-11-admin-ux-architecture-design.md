# Admin Panel — UX Architecture (Master Design Spec)

Date: 2026-08-11
Status: Draft for review
Scope: Master architecture. Sub-specs are decomposed and dependency-ordered in "Epic breakdown".

---

## Decisions (confirmed)

Captured from the scoping session on 2026-08-11. These are settled; the rest of the spec derives from them.

| # | Decision | Choice |
|---|----------|--------|
| D1 | Flow scope | All admin flows |
| D2 | Audience | **Customer-facing.** External clients log in to approve their own campaigns |
| D3 | Surface split | **One app, RBAC-gated.** No separate client portal |
| D4 | Customer capability | External org admins get **everything an admin can do**, scoped to their own org |
| D5 | Change latitude | Greenfield — treat existing screens as a rough draft |
| D6 | AI surfaces | Consolidate the five surfaces into one context-aware assistant |
| D7 | Security | The unauthenticated endpoints are folded in as a prerequisite epic, not deferred |
| D8 | Architecture | **A — deterministic shell, generative assistant.** See "Resolving D8 against D1" |
| D9 | Money guardrail | Confirmation **plus a cancellable undo window** before execution fires |
| D10 | Deliverable | This master spec + a deep-dive for Epic 0/1 |
| D11 | Primary persona | **A commercial real estate broker**, not a performance marketer |
| D12 | Cognitive load | Hard budget per screen. Plain language over metrics. See "Cognitive load budget" |
| D13 | Design gate | Screens are approved in Pencil (`gentle-space-design.pen`) **before** any code is committed |
| D14 | Visual system | **Linear-grade, dark-first**, replacing the current component set in both panels |
| D15 | Density | **Two modes, one system** — `compact` for Admin, `comfortable` for Broker |
| D16 | Panel split | Admin = staff/cross-org console. Broker = Today, Enquiries, My spaces, Ask, My website, Account |
| D17 | CMS | Full scope — listings, page copy, brand, domain/SEO, lead form, testimonials, arbitrary pages. **Later phase** |

### Resolving D8 against D1

D1 asked to optimise for generative UI (OpenUI is already in the stack); D8 chose the most conservative
architecture. These pull in opposite directions, so the resolution is explicit:

**Architecture A is adopted for the shell. The assistant panel is a first-class generative workspace, not a
bolt-on.** Concretely:

- Navigation, lists, detail pages, forms, and every state-changing control are hand-built React. They are
  deterministic, testable, accessible, and identical for every user.
- The assistant panel is where OpenUI composes freely, and it is given real surface area — full-height,
  dockable, context-aware of the current route and selection.
- Deterministic pages may embed **read-only** generative blocks (an AI-authored explanation of a proposal,
  a narrative summary above a chart). These render OpenUI components but expose **no** actions.
- Every action the assistant offers is a *proposal* handed to the deterministic rail. The assistant never
  mutates state directly.

The graduation path to architecture C (generative surfaces that can also act, through a typed action
contract) is preserved: the action-proposal protocol in Epic 3 is the same contract C would need. Adopting C
later is an additive change, not a rewrite.

---

## Persona (D11)

**The user is a commercial real estate broker.** They lease office, retail, and coworking space in Bangalore.
They are commercially sharp and numerate about *property* — rent per square foot, occupancy, deal pipeline —
and they are not a performance marketer. They do not know or care what impression share is.

What that means concretely:

- They log in **between site visits and client calls**, on a laptop, for two minutes. They are not settling
  in to analyse a dashboard.
- Their real question is always one of three: *Do I have new enquiries? Is my money being wasted? Is there
  anything I have to decide right now?*
- Advertising vocabulary is the product's internal language, not theirs. "Cost per lead" is borderline;
  "impression share lost to budget" is not acceptable in primary copy.
- They will not build a report, configure a dashboard, or learn a keyboard shortcut scheme.

This invalidates part of the pre-D11 design. The approvals table specified below carried CPL, impression
share, keyword-overlap conflicts, and seven sortable columns — a performance-marketing console. It is
retained only for **internal Gentle Space staff** (platform scope), and the broker gets the surface defined
in "Broker surface" below. Same data, same deterministic rail, different presentation.

## Cognitive load budget (D12)

A hard, checkable budget. Any screen exceeding it fails design review.

| Rule | Limit |
|---|---|
| Decisions requested above the fold | **1** primary, at most 3 total |
| Words in a decision headline | **≤ 12**, phrased as a question or plain statement |
| Jargon terms in primary copy | **0** — see "Numbers vs jargon" |
| Competing primary buttons per view | **1** |
| Chart types on Today | **0** — charts are pull, never push |

### Numbers vs jargon

The load to cut is **jargon, not numbers.** A broker is highly numerate about money and negotiates on
figures daily; vague reassurance ("it's doing well") reads as evasive and costs them trust. An earlier draft
of this spec capped visible numbers, which was wrong and is superseded by this rule:

> **Every number must be in a unit the broker already trades in** — ₹, enquiries, days, square feet, a plain
> percentage. **Derived advertising ratios are banned from primary copy.** Express CPL as "₹840 per
> enquiry". Never surface CTR, CPM, impression share, or quality score outside a "Why?" expansion.

So a decision card leads with the figures, in the broker's units:

- ✅ "Each enquiry is costing ₹840 against the ₹1,200 you set. The budget runs out around 3pm."
- ❌ "It's finding you leads at about half what you budgeted." — too soft, hides the number
- ❌ "CPL is ₹840 with 23% impression share lost to budget." — correct but not their vocabulary

One supporting rule:

- **Every list row ends in a next step.** Borrowed from
  [Zillow Rentals](https://mobbin.com/screens/1e978c16-39c9-4e90-8f1c-6246664286b7), whose lead table has an
  explicit *Next step* column. A row that only reports state makes the broker invent the action.

## Generative vs deterministic split (D1 + D8, resolved for the broker)

The split is decided by **user experience**, not by what is technically possible. One test:

> Does the broker need to **recognise** this, or **read** it?
>
> Recognise → deterministic React. Read → generative OpenUI.

Anything encountered repeatedly must look identical every time so it becomes muscle memory. Anything
encountered once, in response to a specific question, should be shaped to that question.

**Deterministic React owns:**

| Surface | Why |
|---|---|
| Navigation, and the Today screen skeleton | Recognised at a glance; must never move |
| The decision card frame — headline, Yes/Not now, undo banner | The money path. Identical every time, testable, auditable |
| Lead and space lists, and their Next step column | Scanned repeatedly; stable columns beat clever layout |
| Status, confirmations, receipts, errors | Trust surfaces. A model must never phrase these |
| All form inputs and settings | Predictable, validatable, accessible |

**Generative OpenUI owns:**

| Surface | Why |
|---|---|
| The "Why?" expansion behind any recommendation | The argument differs per proposal; a fixed template either over- or under-explains |
| Answers to typed questions ("which space is getting the most interest?") | The answer's shape depends on the question |
| Weekly plain-language summary | Narrative, not tabular |
| Any ad-hoc comparison or breakdown | This is the alternative to a report builder |

**The load-bearing argument: generative UI is how we avoid the analytics wall.** The conventional way to
serve "which space is doing best?" is a dashboard of tiles and filters — the
[Zoho](https://mobbin.com/screens/4291c35e-0712-4202-b7f0-cd495ca409f9) and
[folk](https://mobbin.com/screens/094ce5f2-6f23-402e-bb74-abb16ec8cd05) pattern, where the broker must scan
twelve numbers and derive meaning. Generating one answer to one asked question removes that entire surface.
Generative UI here is a **load-reduction** technique, not a novelty.

Two invariants hold regardless:

1. **The model never renders a control that spends money.** It may end an answer with "Want me to raise the
   budget?" — that hands off to the deterministic decision card, which is the only thing that can act.
2. **Generated content is visually subordinate.** It renders inside a clearly demarcated answer area, never
   restyling the shell, so the broker always knows which parts of the screen are stable.

## Broker surface — screen inventory

Replaces the broker-facing half of "Information architecture". Staff keep the dense console.

| # | Screen | Purpose | Load budget |
|---|---|---|---|
| B1 | **Today** | "2 things need you today." Decisions first, then spaces, then Ask | 1 primary decision, ≤4 numbers |
| B2 | **Decision card (expanded)** | One question, plain-language reasoning, Yes / Not now / Why? | 1 decision, ≤3 numbers |
| B3 | **Undo state** | Countdown + Cancel after approving | 1 action |
| B4 | **Enquiries** | Lead list with a Next step per row | 0 charts |
| B5 | **My spaces** | Per-listing enquiry counts and spend, with next step | ≤3 numbers per row |
| B6 | **Ask** | Generative answer surface with suggested questions | Unbounded, but pull-only |

Navigation collapses from nine items to **four**: Today, Enquiries, My spaces, Ask. Members, Billing, and
Settings move behind the account menu — a broker visits them monthly, not daily.

---

## Problem

The admin panel is a Next.js App Router route group at `ads-agent/app/(admin)/` with ten routes. A full audit
on 2026-08-11 covered every route, its data dependencies, its actions, its states, and its role gating. Three
classes of problem emerged.

### 1. Customer-facing is currently unsafe (blocking)

D2 changes the risk profile of findings that were previously cosmetic. The schema has a **split tenancy
model**: billing tables are org-scoped, domain tables are not scoped at all.

Org-scoped today: `orgs`, `users`, `org_balances`, `user_balances`, `credit_grants`, `usage_ledger`.

**Not scoped at all:** `campaigns`, `proposals`, `campaign_drafts`, `campaign_draft_messages`,
`performance_snapshots`, `crm_signal_snapshots`, `ai_action_log`. None of these has an `org_id` column, so the
queries cannot filter even in principle:

- `listProposals()` — `ads-agent/lib/db/proposals.ts:53` — `SELECT * FROM proposals WHERE status = $1`
- `getProposalById()` — `proposals.ts:62` — no ownership check
- `listCampaignsWithLatestCpl()` — `ads-agent/lib/db/dashboard.ts:81`
- `listOpportunities()` — `ads-agent/lib/crm/twenty-pipeline.ts:176`

Compounding this, seven mutation endpoints have **no authorization check whatsoever**, and
`ads-agent/middleware.ts:26` excludes `/api` from the matcher, so they are reachable unauthenticated:

| Endpoint | File | Effect |
|---|---|---|
| `POST /api/proposals/[id]/approve` | `approve/route.ts:5` | Decides **and executes** — provisions a live Google Ads campaign |
| `POST /api/proposals/[id]/reject` | `reject/route.ts:4` | Terminal reject |
| `PATCH /api/proposals/[id]` | `proposals/[id]/route.ts:8` | Rewrites budget, keywords, final URL |
| `PATCH /api/campaign-drafts/[id]` | `campaign-drafts/[id]/route.ts:6` | Rewrites draft fields |
| `POST /api/campaign-drafts/[id]/create-proposal` | `create-proposal/route.ts:7` | Mints a proposal |
| `POST /api/cycle/run` | `cycle/run/route.ts:5` | Runs the decision engine |
| `PATCH /api/settings` | `settings/route.ts:9` | Toggles automated ad spend |

Taken together: an unauthenticated stranger can approve any client's proposal and spend that client's ad
budget. The schema's own comment still reads *"no auth system exists yet"* — stale since the auth service
shipped.

There is also a **role vocabulary conflict**. `ads-agent/lib/db/schema.sql` defines `users.role` as
`admin | member`; the auth service and `ads-agent/lib/auth/dal.ts:12` use `admin | operator | viewer`.

### 2. The core value loop is the least-supported flow

This is a human-gated approval product. The approval queue is the product. Yet:

- `/proposals` is **absent from navigation** — `ads-agent/lib/nav-config.ts:18-37` has no entry. It is
  reachable only via a tab strip on `/campaigns`, is missing from ⌘K, and falls through to the literal string
  `"ads-agent"` in `Breadcrumb.tsx:22`. `/credits` has the same problem.
- Home computes `pendingProposalCount` in `ads-agent/lib/db/dashboard.ts` and **discards it**; the dashboard
  renders only `activeCampaignCount`, and no stat card is a link.
- **Approve has no confirmation.** `ProposalActions.tsx:24` fires approve → execute against Google Ads on one
  click. The only confirmation dialog in the entire product is the CRM stage change, which spends nothing.
- **The response is discarded.** `ProposalActions.tsx:15` never reads the result, so a 404, 409, or 500
  produces zero user-visible feedback.
- **Terminal states are dead ends.** No retry for `failed`, no reopen for `rejected`, no undo for anything.
- **No approval attribution.** `decideProposal` (`proposals.ts:68-76`) writes only `status` and `decided_at`.
  A human-gated workflow that does not record the human.
- **Reviewing N proposals costs N round trips.** No bulk actions, no "next pending", no back link, and rows
  carry no campaign name, budget delta, or age — you must open each one to learn what it does.
- Non-`create_campaign` proposals render as `JSON.stringify(payload, null, 2)` in a `<pre>`
  (`proposals/[id]/page.tsx:42-44`). Operators approve budget changes by reading a JSON blob.

### 3. Systemic shell problems

- **No `loading.tsx`, `error.tsx`, or `not-found.tsx` anywhere** in `ads-agent/app/`, and no Suspense
  boundaries. Home awaits five calls including two Twenty MCP round trips behind a blank screen, and
  `notFound()` drops the entire admin chrome.
- **No optimistic UI anywhere.** Every mutation is `await fetch()` → `router.refresh()`.
- **Both Kanban boards accept drags and silently discard them** — `onReorderColumn` is never passed
  (`campaigns/page.tsx:78`, `crm/page.tsx:54`) despite `PATCH /api/campaigns/[id]/status` being complete.
- **No card on either board is clickable**; no `/campaigns/[id]` or `/crm/[id]` route exists.
- **Five AI surfaces** (global Copilot, draft chat, CRM rail, Reports, plus an unlabeled "Hermes" toggle on
  each) with four duplicated SSE parsers and divergent error handling. Two of them
  (`CrmAssistantPanel.tsx:74`, `ReportsChat.tsx:70`) silently swallow every network and stream error. The
  Copilot FAB physically overlaps the CRM rail and the Reports send button.
- **`GET /campaigns/new` performs a database write** (`campaigns/new/page.tsx:10`), minting orphan drafts on
  refresh or back-forward, with no index page and no delete.
- Fixed `grid-cols-[220px_1fr]` sidebar with no mobile collapse (`layout.tsx:52`); chat inputs have no
  labels; streaming regions have no `aria-live`.
- `AskAiTrigger.tsx` is fully implemented and unit-tested but has **zero usages** — the documented
  per-component AI handoff does not exist in the shipped UI.

---

## Research

### Approval-queue precedents (Mobbin)

| Reference | Pattern to adopt |
|---|---|
| [Deel — Action required](https://mobbin.com/screens/ebede796-0ca0-408a-bf05-630420732e1f) | Nav item with live count; filter chips; checkbox multi-select; per-row inline ✓/✗; bulk "Approve all pending (71)"; toast confirmation |
| [StackAI — Pull Requests](https://mobbin.com/screens/3ee3b3f3-ee96-480d-bb21-17369bed1b03) | **Model AI proposals as pull requests.** Pending/Approved/Rejected tabs with a "Changes" diff column |
| [Employment Hero](https://mobbin.com/screens/791dadb5-8590-430b-8583-e0674d7cb218) | "Approve Selected" / "Decline Selected"; a **Clashes** column warning of conflicts before approval |
| [PandaDoc](https://mobbin.com/screens/e59a5cad-1b17-4473-8f71-1fe0ea8931c0) | Status-grouped tabs (Drafts / Actions required / Waiting on others / Finalized) with sub-statuses |
| [Remote](https://mobbin.com/screens/68c88a4c-0241-4007-928d-41f2a85f311f) | Row overflow menu: Approve / Decline / View details; sidebar count badge |
| [7shifts](https://mobbin.com/screens/cc7d3fa8-66ee-45cb-9332-e7e557975c70) | Pending Requests card beside an Activity Log card, **on the dashboard** |
| [Miro — Access requests](https://mobbin.com/screens/05e59db8-5f5a-4f08-ae23-292fd64fe663) | Compact ✓/✗ with an expiry indicator |

The StackAI pull-request framing is the organising metaphor for this spec: **the agent opens PRs, humans
merge them.** It gives the diff view, the review states, and the approval semantics for free.

### Generative-UI precedents (Mobbin)

| Reference | Pattern to adopt |
|---|---|
| [Claude](https://mobbin.com/screens/34aa9592-2138-4be6-95f6-4aa7410e9bb9) | Inline numbered choice card with free-text escape and Skip; keyboard hints; connector-status chip row |
| [Emergent](https://mobbin.com/screens/99a1a63e-01dc-4310-b836-f110b0fc30a3) | "Agent has questions for you / Waiting for answers" collapsed pill expanding to a form card with "Question 1 of 4" pagination and Auto-answer |
| [Whop](https://mobbin.com/screens/48fec8bb-3e4b-4862-a50e-eba33a85569e) | Collapsible "Thought for 9s" reasoning above inline option cards |
| [Langdock](https://mobbin.com/screens/4005ec90-b8ee-45c2-888d-a61ee8d33e8b) | Explicit Tools picker in the composer |
| [Microsoft Copilot](https://mobbin.com/screens/d2e0d083-5dbb-4cb4-abf4-3f3299439ead) / [Cohere](https://mobbin.com/screens/a875171a-097b-4014-a497-f7761d450ff1) | Categorised prompt starters — fixes the blank Reports page |
| [ManyChat](https://mobbin.com/screens/1545f393-6813-4733-86f4-61de1f4d6ddd) | "Answered based on: [source]" citation chip plus thumbs feedback |

The Emergent question-card replaces the current chat-left / form-right split on the draft screen, where errors
render in the panel the user is not looking at (`CampaignDraftChat.tsx:52` sets state rendered at `:227`).

### OpenUI foundation already in the codebase

`ads-agent/lib/openui/shared-library.ts:22-34` already exports nine domain-agnostic components — `StatCard`,
`KpiGrid`, `InsightCallout`, `ChecklistCard`, `AlertBanner`, `ComparisonCard`, `Timeline`, `RankedList`, and
**`BatchActionConfirm`**. Domain libraries (`campaign-library`, `crm-library`, `analytics-library`,
`platform-library`, `hermes-library`) compose on top. `BatchActionConfirm` is precisely the primitive bulk
approval needs, and it is already built and tested.

Client-side `Query()` calls already route through `POST /api/openui/tools` → `platformToolProvider`
server-side, keeping `pg` out of the browser bundle. That indirection is the right seam for the
action-proposal protocol in Epic 3.

---

## Approach

### A. Tenancy model

Two scopes, derived from the **existing** `orgs.kind` column rather than a new one:

```
scope(session) = session.org.kind === 'internal' ? 'platform' : 'org'
```

- **Platform scope** — Gentle Space staff. May read across orgs; may act across orgs only where explicitly
  allowed (support operations, all audited).
- **Org scope** — external customers. Hard-bounded to their own `org_id`. Per D4, an `org_admin` has the full
  admin capability set *within that boundary*.

Every domain table gains `org_id UUID NOT NULL REFERENCES orgs(id)`, backfilled to the seed internal org, then
constrained. Every read and write takes an explicit scope argument. Tables that are strictly children
(`campaign_draft_messages` via `draft_id`, `performance_snapshots` and `crm_signal_snapshots` via
`campaign_id`) inherit through their parent and are not denormalised.

Full column list, migration ordering, and backfill are in the Epic 0/1 deep-dive.

### B. Role model

One vocabulary replaces the current two. Roles are org-scoped; the platform tier comes from `orgs.kind`.

| Role | Read | Create/edit drafts | Approve | Billing | Members | Settings |
|---|---|---|---|---|---|---|
| `viewer` | ✓ | — | — | — | — | — |
| `operator` | ✓ | ✓ | ✓ (below org threshold) | — | — | — |
| `admin` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

`schema.sql`'s `admin | member` CHECK is migrated to `admin | operator | viewer` to match
`ads-agent/lib/auth/dal.ts:12`. A platform-scoped `admin` additionally sees cross-org routes.

Authorization is enforced at **two** layers and only two, so there is exactly one place to audit each:

1. **Data layer** — every `lib/db` function takes a scope and filters. No unscoped query survives.
2. **API layer** — `requireApiRole(min)` plus an ownership assertion on every mutation route.

Page-level `requireRole` stays for UX (rendering `ForbiddenNotice` instead of a bare 403) but is explicitly
**not** the security boundary. `middleware.ts` remains cookie-presence only and its matcher is left excluding
`/api` — the fix is real checks in the routes, not middleware.

### C. Proposal lifecycle (the deterministic action rail)

This is the single funnel through which **every** state change passes, whatever its origin — human, cron, or
assistant.

```
                   ┌──────────── edit ────────────┐
                   ▼                              │
  (agent/human) ─→ pending ──approve──→ scheduled ─┴─execute_after──→ executing ──→ executed
                     │  │                   │                             │
                     │  │                 cancel                        error
                     │  │                   │                             ▼
                     │  └──reject──→ rejected ◄─┘                       failed
                     │                    │                               │
                     └────────────────────┴──── reopen ───────────────────┘
```

New states: `scheduled` (approved, inside the undo window), `executing` (worker has picked it up).
`rejected` and `failed` are no longer terminal — both can `reopen` to `pending`.

**The undo window (D9).** Approve does not execute. It transitions to `scheduled` and stamps
`execute_after = now() + org.undo_window_seconds` (default 60). The existing node-cron worker claims rows
where `status = 'scheduled' AND execute_after <= now()`. Until then, a persistent inline banner offers Cancel
with a live countdown. Cancel returns the proposal to `pending`.

This gives three properties the current design lacks: the click is reversible, execution is decoupled from the
request (fixing the unbounded synchronous approve → Google Ads call), and a browser abort can no longer strand
a proposal in `approved`-but-unexecuted.

Approve additionally requires a confirmation step that states the concrete consequence — platform, campaign
name, and daily budget delta — not a generic "Are you sure?".

**What the approver is shown must be the payload, not a description of it (added 2026-08-12).**
Security review raised this once agents became proposers: human approval is the single load-bearing
control in the whole system, and it can be lied to. Invisible-Unicode smuggling — tag-block
(U+E0000–E007F), variation selectors, zero-width characters — makes rendered text differ from what
executes, so an approver can read a harmless summary and authorise something else. Three
requirements follow:

- **Render the literal mutation, diffed against live state** — the actual field-level before/after
  that will be sent to Google Ads. Never the proposing agent's prose summary. An agent's rationale
  may sit *alongside* the diff, clearly labelled as its reasoning, never in place of it.
- **Strip the smuggling character ranges** at every ingest and render boundary.
- **Guard against approval fatigue**, which OWASP flags explicitly. Cap proposals per tenant per
  day, and require a step-up confirmation above a spend threshold. A queue that becomes a
  rubber stamp is the same as having no gate — and the volume risk is real once six agents propose
  freely, which is precisely the calm queue this spec set out to protect.

Bulk approve carries a related trap: each approved proposal gets its own undo window, so one wrong
bulk action needs N separate cancels. Bulk approve must offer a **single bulk cancel** covering the
whole batch for the duration of the window.

**Attribution.** `proposals` gains `decided_by UUID REFERENCES users(id)`, `decided_via TEXT` (`ui`, `bulk`,
`api`), and `canceled_at TIMESTAMPTZ`. Every transition writes an `audit_log` row.

### D. Audit log

`ai_action_log` is too narrow — no actor, and a `CHECK (domain IN ('marketing','crm'))` that excludes
approvals, credit grants, and role changes. It is superseded by:

```sql
CREATE TABLE audit_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES orgs(id),
  actor_type    TEXT NOT NULL CHECK (actor_type IN ('human','agent','system')),
  actor_user_id UUID REFERENCES users(id),          -- NULL for agent/system
  action        TEXT NOT NULL,                      -- 'proposal.approved', 'member.role_changed', ...
  entity_type   TEXT NOT NULL,
  entity_id     UUID,
  before        JSONB,
  after         JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Every mutation writes here. This is what makes "human-gated" verifiable rather than aspirational, and it is a
prerequisite for letting external customers act on their own account.

### E. Information architecture

One app, RBAC-gated (D3). Navigation is rebuilt in `ads-agent/lib/nav-config.ts`:

```
Workspace
  Home
  Approvals        ← live pending count badge; the missing /proposals, promoted
  Campaigns
  Leads
  Reports
Admin              (role: admin)
  Members
  Billing & Credits  ← the missing /credits, promoted
  Settings
Platform           (scope: platform only)
  Organizations
  Cross-org activity
```

Fixes carried by this change: `/proposals` and `/credits` enter nav, ⌘K, and breadcrumbs; both ad-hoc
`TabStrip` pairs are deleted; `Breadcrumb.tsx` no longer falls through to `"ads-agent"`; breadcrumb segments
become links.

⌘K is upgraded from a nav-item lister to real **global search** over proposals, campaigns, leads, and members
— scoped by tenancy — and its Actions group becomes role-filtered (today it offers "Run decision cycle now"
to viewers).

Home changes from a read-only dead end to the entry point of the value loop: `pendingProposalCount` is
surfaced as the primary card, every stat card links to its filtered list, and an Activity feed reads
`audit_log` — the [7shifts](https://mobbin.com/screens/cc7d3fa8-66ee-45cb-9332-e7e557975c70) layout.

### F. Approvals surface

- **List** — filter chips (status, kind, campaign, date, requester), checkbox multi-select, per-row inline
  ✓/✗, bulk approve/reject via the existing `BatchActionConfirm`, pagination, sorting, and a "Conflicts"
  column in the spirit of Employment Hero's Clashes. Rows carry campaign name, budget delta, age, and kind.
  The whole row is the click target.
- **Detail as diff** — per-kind renderers replace `JSON.stringify`. Each of the five kinds
  (`create_campaign`, `pause`, `budget_change`, `add_negative_keyword`, `campaign_strategy`) gets a semantic
  before/after view. `ComparisonCard` already exists for this.
- **Review ergonomics** — back link, breadcrumb, keyboard shortcuts (`j`/`k`, `a`, `r`, `?`), and **Next
  pending** so a queue of N is one pass rather than N round trips.
- **Every response is read and surfaced.** 404, 409, and 500 each get a distinct message. A toast system is
  introduced (there is none today).

### G. Assistant consolidation

Five surfaces collapse to one context-aware assistant with a single shared SSE client, replacing the four
duplicated parsers and their divergent error handling.

- One dockable panel, route- and selection-aware, that no longer collides with page content.
- The **Hermes toggle is removed from the UI.** It becomes a server-side routing decision. It is currently
  unlabeled, resets on navigation, and silently changes persistence semantics — Hermes replies are never
  written to the database while normal replies are (`CampaignDraftChat.tsx:87-97`), so a refresh deletes half
  the conversation. All assistant turns persist uniformly.
- Prompt starters per route ([Copilot](https://mobbin.com/screens/d2e0d083-5dbb-4cb4-abf4-3f3299439ead) /
  [Cohere](https://mobbin.com/screens/a875171a-097b-4014-a497-f7761d450ff1)) fix the blank Reports page.
- `AskAiTrigger` is either wired (it already works, and `seedAndOpen` exists in `CopilotProvider.tsx:38`) or
  deleted. It is not left as tested dead code.
- **Action-proposal protocol** — when the assistant wants to change something it emits a typed proposal that
  the deterministic rail renders as a confirmation. Under architecture A the assistant cannot execute. This
  contract is what a later move to architecture C would build on.

### H. Shell and quality baseline

Applies to every route, and closes the systemic gaps:

- `loading.tsx`, `error.tsx`, and `not-found.tsx` per route group; Suspense around slow server data so the
  chrome never disappears.
- Toast system; optimistic UI on list mutations.
- Responsive sidebar with a mobile drawer, replacing the fixed 220px grid.
- WCAG 2.2 AA: labelled inputs, `aria-live` on streaming regions, visible focus, keyboard reachability.
- Empty states distinguished from error states — today "no leads" and "Twenty CRM is down" are visually
  identical because `listOpportunities` fails soft to `[]` (`twenty-pipeline.ts:176`). **Fixed at the
  source 2026-08-12:** the tenant-resolving client throws instead of returning empty, precisely because
  an empty result and an unreachable CRM must never render the same — that ambiguity is also how a
  tenancy leak would hide.
- `GET /campaigns/new` stops writing. Draft creation becomes a POST from an explicit action, plus a drafts
  index so orphans are reachable and deletable.
- Both Kanban boards either get working persistence (the status APIs exist) or lose the drag affordance. No
  control may appear interactive and silently discard the result.

---

## Epic breakdown

Dependency-ordered. Each epic is independently shippable and gets its own spec and plan.

| Epic | Title | Depends on | Deep-dive |
|---|---|---|---|
| **0** | Tenancy & authorization foundation | — | `2026-08-11-tenancy-authz-foundation-design.md` |
| **1** | Role model, audit log & permission surface | 0 | same document |
| **2** | Approvals: queue, diff detail, lifecycle, undo window | 0, 1 | written after Epic 0/1 review |
| **3** | Assistant consolidation & action-proposal protocol | 2 | written after Epic 2 |
| **4** | Campaign creation: draft → proposal | 2, 3 | written after Epic 3 |
| **5** | Admin ops: members, credits, settings | 1 | written after Epic 1 |
| **6** | CRM & Reports surfaces | 3 | written after Epic 3, gated on Q4 |
| **7** | Shell & quality baseline (loading/error, toasts, a11y, responsive) | — (parallel) | may start immediately |

Epic 7 has no dependencies and can run in parallel with 0–2.

Epic 0 and 1 are **release-blocking for D2.** No external customer may be given a login until both ship.

---

## Visual system (D14, D15)

Linear is the reference. The critical distinction, and the reason both panels can share one system:

> **Adopt Linear's craft everywhere. Adopt Linear's density only where the persona earns it.**

Linear's craft is universal: monochrome base with tiny colour accents, hairline separators instead of cards,
no shadows or gradients, small radii (4–12px, never 20), metadata right-aligned, section headers with counts,
a flush sidebar beside an inset elevated content panel, and measure-limited centred columns on reading
surfaces. Linear's density — ~22px rows, 13px type, keyboard-first — suits a tool someone lives in all day.
That is the Admin console, not the broker.

**Two density modes, one token set:**

| Token | `compact` (Admin) | `comfortable` (Broker) |
|---|---|---|
| Row height | 32px | 52px |
| Body text | 13px | 13.5–14px |
| Title text | 14px | 16.5px |
| Row padding | 6/8px | 11/18px |
| Section gap | 12px | 28px |

Linear ships a "Font size" preference of its own, so density as a first-class setting is their precedent
rather than an invention.

**Dark-first token set** (namespaced `ds-*` so it never collides with the existing light purple marketing
tokens, which the public site keeps):

`ds-bg #08090A` · `ds-panel #0F1011` · `ds-raised #17191B` · `ds-hover #1C1E21` · `ds-border #23252A` ·
`ds-border-soft #191B1E` · `ds-text #F7F8F8` · `ds-text-2 #8A8F98` · `ds-text-3 #62666D` ·
`ds-accent #5E6AD2` · `ds-success #4CB782` · `ds-warning #F2C94C` · `ds-danger #EB5757` ·
radii 4/6/8/12 · Inter.

A style probe rebuilding **Broker — Today** in this system is on the canvas and verified. It tested the
riskiest hypothesis — that Linear's aesthetic, proven for dense power tools, could still feel calm on an
infrequent-use surface. It does.

## CMS (D17) — what the codebase forces

Two constraints found via the code graph, both of which make the CMS a real build rather than a UI layer:

1. **Listings are scrape-only.** `lib/db/schema.sql` constrains
   `source CHECK (source IN ('coworker','myhq','cofynd','gofloaters'))`. There is no way for a broker to
   author a listing. This needs either a new `source` value or a separate broker-owned listings table, plus
   `org_id` from Epic 0.
2. **The marketing site has no content model at all.** `Hero`, `Services`, `HowItWorks`, `About`, `FAQ`,
   `Testimonials`, `MicroMarkets`, and `CtaBand` are hardcoded React in `components/`. Making them
   broker-editable means introducing content tables and making each section data-driven.

**The CMS UI should follow Linear's settings-row grammar**, not a drag-and-drop page builder: a label and a
one-line description on the left, the control on the right, grouped under section headings — exactly
[Linear's preferences](https://mobbin.com/screens/aa0b9e71-c5a0-4245-b30a-ee5059de6235) and
[team settings](https://mobbin.com/screens/487dfeab-4f5e-462a-b57c-009299c36e71). "Hero headline / The first
thing visitors read / Edit". This is far lower cognitive load than a canvas builder, reuses the component
set, and degrades gracefully as sections are added.

**"Arbitrary new pages" resolves to templates.** It is the one CMS requirement the settings-row grammar
cannot express, since a brand-new page has no predefined fields to list. Rather than a block editor or a
canvas builder, the broker picks a **ready-made page template** (Location page, Service page, Space
detail) and fills in a form. Once created, the page's fields are edited through the same settings rows as
everything else, so there is exactly one editing grammar in the product. This keeps output on-brand by
construction, is impossible to visually break, and fits the cognitive-load budget — a broker chooses from a
short list rather than composing a layout.

---

## Non-goals

- Brand and theming for the **public marketing site** — it keeps its existing light purple system.
- Migrating off Next.js App Router, shadcn/ui, or Tailwind.
- Replacing Twenty CRM, Google Ads, or Bifrost integrations.
- Architecture C. The protocol is designed to permit it; adopting it is out of scope.
- Native mobile. Responsive web only.

---

## Open questions

| # | Question | Blocks |
|---|---|---|
| Q1 | Default undo window length. Spec assumes 60s, org-configurable | Epic 2 |
| Q2 | Should `operator` have an approval value threshold above which `admin` is required? | Epic 1 |
| Q3 | Do external orgs self-serve credit top-up, or does Gentle Space staff grant? | Epic 5 |
| ~~Q4~~ | ~~Is Twenty CRM data per-org, or one shared pipeline?~~ **Resolved 2026-08-12:** shared today, one instance per org by design — `2026-08-12-twenty-tenancy-ownership-design.md`. `/leads` and the CRM board are platform-only until every org has its own instance | — |
| Q5 | Notification channel for pending approvals — in-app only, or email/Slack? | Epic 2 |

---

## Files touched (master-level)

Indicative; each epic spec enumerates precisely.

**Schema and data layer**
- `ads-agent/lib/db/schema.sql` — `org_id` columns, role CHECK, `audit_log`, proposal lifecycle columns
- `ads-agent/lib/db/{proposals,campaigns,campaign-drafts,dashboard,credits,settings,snapshots}.ts` — scope arguments
- `ads-agent/lib/db/audit-log.ts` — new, supersedes `ai-action-log.ts`

**Authorization**
- `ads-agent/lib/auth/dal.ts` — scope derivation, ownership assertions
- All seven unauthenticated routes listed in "Problem"

**Shell and IA**
- `ads-agent/lib/nav-config.ts`, `components/Breadcrumb.tsx`, `components/CommandPalette.tsx`
- `ads-agent/app/(admin)/layout.tsx` and new `loading.tsx` / `error.tsx` / `not-found.tsx`

**Approvals**
- `ads-agent/app/(admin)/approvals/**` (replacing `proposals/`)
- `ads-agent/app/api/proposals/**`
- `ads-agent/lib/proposals/diff/**` — new per-kind diff renderers

**Assistant**
- `ads-agent/lib/openui/**`, `components/copilot/**`
- Retire `CrmAssistantPanel`, `ReportsChat`, and the per-surface Hermes toggles in favour of the shared panel

---

## Testing plan

| Layer | Coverage |
|---|---|
| **Tenancy (highest priority)** | For every `lib/db` read and write: a cross-org access attempt must fail. Table-driven over all domain tables. This suite is the release gate for D2. |
| **Authorization** | Each of the seven previously-unauthenticated routes: unauthenticated → 401; wrong role → 403; wrong org → 404 (not 403 — do not leak existence). |
| **Proposal lifecycle** | Every transition in the state machine, including cancel-within-window, cancel-after-window (must fail), reopen from `rejected` and `failed`, and double-approve idempotency. |
| **Undo window** | Worker claims only `scheduled AND execute_after <= now()`; cancel before the boundary prevents execution; concurrent cancel-and-claim resolves to exactly one outcome. |
| **Audit** | Every mutation writes exactly one `audit_log` row with correct actor attribution. |
| **Bulk actions** | Partial failure in a bulk approve reports per-item results; no silent partial success. |
| **Accessibility** | Automated WCAG 2.2 AA pass per route plus keyboard-only traversal of the approval flow. |
| **Regression** | Existing `*.test.ts` files adjacent to each touched module continue to pass. |

---

## Review gate

Per the brainstorming process, this spec requires your review before an implementation plan is written. The
open questions Q1–Q5 do not block review; they block their individual epics.
