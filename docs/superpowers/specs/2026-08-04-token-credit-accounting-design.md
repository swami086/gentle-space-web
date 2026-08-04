# Token credit accounting — per-org/per-user AI cost tracking with admin visibility

Date: 2026-08-04
Status: approved (pending user review of this written spec)
Related: builds on
[`docs/superpowers/plans/2026-08-04-bifrost-ai-gateway.md`](../plans/2026-08-04-bifrost-ai-gateway.md),
[`docs/superpowers/specs/2026-08-04-bifrost-ai-gateway-design.md`](2026-08-04-bifrost-ai-gateway-design.md)
(Bifrost routing/complexity governance — implemented, `ads-agent/bifrost/`), and
[`docs/superpowers/specs/2026-08-03-ads-agent-admin-dashboard-design.md`](2026-08-03-ads-agent-admin-dashboard-design.md)
(shadcn/ui admin dashboard — implemented, `ads-agent/app/(admin)/`).

## Problem

`ads-agent` is heading toward a real, released, multi-user product (both Gentle Space's own internal
team and external tenants such as agencies), but today has **zero concept of a user, an
organization, or per-caller cost**. Every AI call already routes through the local Bifrost gateway
(`ads-agent/lib/bifrost/client.ts`), which correctly selects models by complexity, but nothing tracks
who is spending what, whether they've hit an allowance, or shows that spend anywhere. Before this can
be released to more than one person, there needs to be an accurate mechanism to: allocate token
credits to an org/user, debit them accurately as AI calls happen, enforce a hard stop when exhausted,
and show current balance + usage history in the admin dashboard.

## Goals

1. A minimal identity model — `orgs` and `users` — sufficient to attach a credit balance to a caller.
   Real authentication (login/session/password flows) is explicitly **not** built here; see Non-goals.
2. An accurate, race-safe ledger: every metered AI call debits the right org (and, if configured, the
   right user's individual cap) for its actual token cost, converted to an abstract "credit" unit at
   a fixed rate — never the raw dollar cost, so margin can move later without changing anything
   user-facing.
3. Admins can allocate ("grant") credits to an org's pool, and optionally cap individual members
   within that pool, entirely through the admin dashboard — no billing/payment step in this phase.
4. A new **Usage & Credits** page in `ads-agent`'s existing admin dashboard shows: org/member
   balances, an allocate-credits action, and spend broken down by feature/model/user over time,
   refreshing every ~15s.
5. Enforcement happens in the app, not by depending on Bifrost's own budget feature — see "Why not
   rely on Bifrost's budgets" below for the concrete reason.

## Non-goals (this phase)

- **Real authentication.** No login, sessions, password reset, or SSO. `users`/`orgs` exist purely as
  the minimal data model credits attach to; a seeded user is used in dev. A follow-up spec covers
  actual auth once this ledger exists to attach it to.
- **Billing/payment processing.** No Stripe, no credit-card top-ups. Credits are allocated manually
  by an admin from the dashboard. The schema (a simple append-only `credit_grants` log) is shaped so
  a real payment flow can write to the same table later without a rewrite.
- **Anonymous/system-triggered AI usage.** The main `GentleSpace_Web` site's direct Vertex calls
  (`lib/vertex/client.ts` — search rewrite, entity extraction, listing insight, lead qualification)
  have no logged-in caller and are explicitly out of scope; they stay untracked by this system for
  now.
- **Multi-org membership.** Each user belongs to exactly one org. Nothing here blocks adding a join
  table later if that's ever needed — it's just not built speculatively.
- **Bifrost's own budget/rate-limit enforcement as the enforcement mechanism** — see below.
- **A shared package usable by other repos/surfaces.** This is built inside `ads-agent/`, since it's
  the only product with multi-user Bifrost usage today. Module boundaries (see Architecture) are kept
  clean so it *can* be extracted later, but nothing is built for a second consumer that doesn't exist
  yet.

## Why not rely on Bifrost's budgets

Bifrost's governance system (Virtual Keys → Teams → Customers, each with independent $ budgets) looks
like a natural fit, and was evaluated directly against the running local instance (`v1.6.7`):

- Automatic cost calculation from token usage × provider pricing, and hierarchical
  org/team/user budgets, are real and documented.
- However, live-testing against the actual running gateway found that **budgets cannot be reliably
  created or edited through its REST API in this version**: embedding `budget` in
  `POST /api/governance/virtual-keys` silently didn't attach, `PUT` with a budget silently no-op'd,
  and `POST /api/governance/budgets` returned `405 Method Not Allowed`. Budgets appear to only take
  effect via the declarative `config.json`, which needs a reload for every change — not workable for
  "an admin clicks allocate credits."
- Bifrost's own docs additionally state that OSS keeps budget/usage state **in memory**, with the
  database as a "dumb store" not read back on node init — a durability risk for something that needs
  to be an accurate, audit-grade ledger.
- Bifrost has no end-user login system and no end-user-facing dashboard.

Conclusion: Bifrost remains the routing and token/cost-accounting engine, but this app's own Postgres
is the enforcement point and source of truth. Revisiting Bifrost's budgets as a defense-in-depth
backstop is a reasonable future follow-up, not a dependency of this phase.

## Approaches considered

| Option | Trade-off |
|---|---|
| **App-authoritative ledger, Bifrost for cost math only (chosen)** | Every metered call reads token usage from Bifrost's synchronous response and debits a Postgres ledger in one transaction. No dependency on Bifrost's budget API (proven unreliable above) or its in-memory persistence risk. Exactly-once, immediately-consistent accounting. |
| Async event log + background aggregator | Append-only `usage_events`, aggregated into balances by a periodic job. Nice audit trail, but opens a double-spend window sized by the aggregation interval, for no real benefit over the chosen option's own ledger table. |
| Bifrost as enforcement, app as mirror | Configure real budgets in Bifrost `config.json`, poll its logs to mirror into the dashboard. Rejected as primary because it leans on exactly the two things found unreliable above (config.json-only budget edits, in-memory state). |

## Architecture

```
ads-agent/
  lib/
    metering/
      types.ts            # NEW — MeteringContext, MeteredUsage, InsufficientCreditsError
      pricing.ts           # NEW — small per-model $/1K-token map for the 3 Vertex models in use,
                            #        + CREDITS_PER_USD conversion constant
      ledger.ts            # NEW — getOrgBalance, getUserCap, grantCredits, debitUsage
                            #        (debitUsage is the one transactional, row-locking function)
      metered-client.ts    # NEW — callMeteredChatCompletion(ctx, request): wraps the existing
                            #        lib/bifrost/client.ts call with pre-flight check + post-call debit
      ledger.test.ts        # NEW
      metered-client.test.ts # NEW
    db/
      credits.ts            # NEW — dashboard read queries: org/member balances, spend-by-feature,
                            #        spend-by-model, spend trend over time
      credits.test.ts        # NEW
      schema.sql             # MODIFIED — new tables, see Data model
  app/
    (admin)/
      credits/
        page.tsx             # NEW — Usage & Credits page (org/member balances, allocate action,
                            #        spend tables/charts)
        AllocateCreditsForm.tsx  # NEW — shadcn form, writes a credit_grants row
      layout.tsx             # MODIFIED — add "Usage & Credits" nav item to existing sidebar
  lib/decision-engine/
    campaign-chat.ts         # MODIFIED — calls callMeteredChatCompletion instead of the bare
                            #             Bifrost client, once a MeteringContext is available
```

`lib/bifrost/client.ts` itself is unchanged — `metered-client.ts` wraps it, it doesn't replace it.

## Data model

Appended to `ads-agent/lib/db/schema.sql`:

```sql
CREATE TABLE IF NOT EXISTS orgs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'external' CHECK (kind IN ('internal','external')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id),
  email TEXT NOT NULL UNIQUE,
  display_name TEXT,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Org-wide pool. Always exists (created alongside the org).
CREATE TABLE IF NOT EXISTS org_balances (
  org_id UUID PRIMARY KEY REFERENCES orgs(id),
  balance_credits NUMERIC NOT NULL DEFAULT 0 CHECK (balance_credits >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Per-user sub-cap. A row only exists if an admin configured an individual cap for that member;
-- absence means "no individual cap, draws freely from the org pool".
CREATE TABLE IF NOT EXISTS user_balances (
  user_id UUID PRIMARY KEY REFERENCES users(id),
  org_id UUID NOT NULL REFERENCES orgs(id),
  balance_credits NUMERIC NOT NULL DEFAULT 0 CHECK (balance_credits >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Append-only allocation log (admin grants, and later — real top-ups/payments).
CREATE TABLE IF NOT EXISTS credit_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id),
  user_id UUID REFERENCES users(id), -- NULL = grant to the org pool; set = per-user sub-cap grant
  amount_credits NUMERIC NOT NULL CHECK (amount_credits > 0),
  granted_by TEXT NOT NULL, -- admin identifier; free text until real auth exists
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Append-only, one row per metered call.
CREATE TABLE IF NOT EXISTS usage_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES orgs(id),
  user_id UUID NOT NULL REFERENCES users(id),
  feature TEXT NOT NULL, -- e.g. 'ads-agent:campaign-chat'
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_tokens INT NOT NULL,
  completion_tokens INT NOT NULL,
  total_tokens INT NOT NULL,
  cost_usd NUMERIC NOT NULL,
  credits_debited NUMERIC NOT NULL,
  request_id TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

### Key TypeScript surfaces

```typescript
// lib/metering/types.ts
export type MeteringContext = { orgId: string; userId: string; feature: string };
export class InsufficientCreditsError extends Error {}

// lib/metering/ledger.ts
export async function getOrgBalance(orgId: string): Promise<number>;
export async function getUserCap(userId: string): Promise<number | null>; // null = no cap configured
export async function grantCredits(input: {
  orgId: string; userId?: string; amountCredits: number; grantedBy: string; note?: string;
}): Promise<void>;
export async function debitUsage(input: {
  orgId: string; userId: string; feature: string; provider: string; model: string;
  promptTokens: number; completionTokens: number; totalTokens: number;
  costUsd: number; creditsDebited: number; requestId: string | null;
}): Promise<void>; // throws InsufficientCreditsError if the CHECK constraint would be violated
// creditsDebited is the already-converted amount (costUsd * CREDITS_PER_USD), computed by the
// caller (metered-client.ts, via pricing.ts) — ledger.ts never imports pricing.ts, it only
// persists the number it's given.

// lib/metering/metered-client.ts
export async function callMeteredChatCompletion(
  ctx: MeteringContext,
  request: BifrostChatCompletionRequest, // re-exported from lib/bifrost/client.ts
): Promise<BifrostChatCompletionResponse>;
```

`debitUsage` is the one function that matters for correctness: inside a single transaction it
`SELECT ... FOR UPDATE`s the `org_balances` row (and the `user_balances` row, only if one exists for
that user), subtracts `credits_debited` from both, and inserts the `usage_ledger` row. The
`CHECK (balance_credits >= 0)` constraint is the final backstop against a race producing a negative
balance.

Every org gets its `org_balances` row created at `0` in the same transaction as its `orgs` insert
(there's no meaningful state for an org without one — a balance of `0` and "org doesn't exist yet" are
different things the pre-flight check needs to tell apart). `user_balances` rows are created only
when `grantCredits` is called with a `userId` for the first time for that user.

### Cost → credits conversion

Bifrost's synchronous `/v1/chat/completions` response includes `usage` (prompt/completion/total
tokens) but — verified against the running instance — **not** a reliable top-level `cost` field on
every response shape. Rather than depend on an unverified field, `lib/metering/pricing.ts` keeps a
small, explicit `$/1K tokens` map for the three Vertex models actually routed to
(`gemini-2.5-flash-lite`, `gemini-2.5-flash`, `gemini-2.5-pro`), computes `cost_usd` from
`response.usage` directly, and converts to credits via a single `CREDITS_PER_USD` constant. This is a
few lines, not a general pricing service — YAGNI for the 3 models this app actually calls.

## Request lifecycle

1. **Pre-flight**: `callMeteredChatCompletion` reads `getOrgBalance(orgId)` (and `getUserCap(userId)`
   if a cap row exists). If either is `<= 0`, throw `InsufficientCreditsError` before calling Bifrost
   at all.
2. **Call Bifrost** via the existing `lib/bifrost/client.ts`, unchanged.
3. **Debit for actual usage**: compute `cost_usd`/`credits_debited` from the response's `usage`, then
   `debitUsage(...)` in one transaction.

Because exact token cost is only known after the response completes, a single request can push a
balance from just-above-zero to negative when it's debited — the `CHECK` constraint then blocks every
*subsequent* request until a new grant arrives, but it can't retroactively stop the one request already
in flight. This is the same trade-off Bifrost's own budget docs describe
(`"Provider=$6/$5 ... next request blocked"`). Mitigated by capping `max_tokens` per feature so any
single overage is bounded, not unbounded.

## Admin dashboard — "Usage & Credits" page

New entry in the existing sidebar (`ads-agent/app/(admin)/layout.tsx`), alongside
Overview/Campaigns/Proposals/Settings:

- Org list → drill into an org → org pool balance, member list with individual caps (if any).
- "Allocate credits" form → writes a `credit_grants` row (org-level or a specific member).
- Spend tables/charts: by feature, by model, by user, over time — reusing the shadcn `chart`
  (Recharts) component already established for the Overview trend chart.
- Polls every ~15s (plain re-fetch; no websocket/SSE, per the "poll-refresh" choice).

### UI states

Following the same "always implement full cycles" pattern as the existing dashboard spec:

- Zero orgs/no data yet → "No organizations yet" empty state, not a blank table.
- An org with a zero balance → balance shown as `0`, not blank, with a visible "Allocate credits"
  call-to-action.
- A rejected request (insufficient credits) surfaces as a clear inline error to the caller, not a
  generic 500.

## Testing

Same TDD pattern as the rest of `ads-agent` (mock the pg pool, as `campaigns.test.ts` /
`proposals.test.ts` already do):

- `lib/metering/ledger.test.ts` — grant + debit arithmetic; org-pool-ok-but-user-cap-exhausted cross
  check (and the reverse); concurrent-debit race (two simultaneous debits against a low balance —
  assert only as many succeed as the balance actually allows, none go negative).
- `lib/metering/metered-client.test.ts` — pre-flight rejection when balance is `<= 0` (Bifrost is
  never called); successful call debits the correct credits from a mocked Bifrost response.
- `lib/db/credits.test.ts` — balance/spend aggregation queries, including the zero-org and
  zero-usage empty cases.

## Success criteria

- `orgs`/`users`/`org_balances`/`user_balances`/`credit_grants`/`usage_ledger` tables exist via
  `lib/db/migrate.ts`.
- An admin can allocate credits to an org (and optionally cap a member) from the new Usage & Credits
  page, and see the balance update.
- A metered call through `campaign-chat.ts` debits the correct org (and user cap, if configured) for
  its actual token cost, converted to credits.
- A caller with zero balance is rejected before Bifrost is called, with a clear error.
- Concurrent calls against a near-exhausted balance never leave `balance_credits` negative.
- `npm test` and `npm run lint` in `ads-agent/` pass with no new warnings.

## Implementation order (high level)

1. Schema migration: `orgs`, `users`, `org_balances`, `user_balances`, `credit_grants`,
   `usage_ledger` (no UI dependency, can be TDD'd first).
2. `lib/metering/pricing.ts` + `lib/metering/ledger.ts`, TDD (pure logic + DB, no Bifrost dependency
   yet).
3. `lib/metering/metered-client.ts` wrapping the existing `lib/bifrost/client.ts`.
4. Wire `campaign-chat.ts` to call `callMeteredChatCompletion` once a `MeteringContext` is available
   (dev: a seeded org/user).
5. `lib/db/credits.ts` read queries (depends on 1, independent of 2-4).
6. Usage & Credits page + sidebar entry (depends on 1-5).
