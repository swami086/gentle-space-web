# Epic 0 & 1 — Tenancy, Authorization & Audit Foundation (Design Spec)

Date: 2026-08-11
Status: Draft for review
Parent: `2026-08-11-admin-ux-architecture-design.md`
Release gate: **No external customer may be issued a login until this ships.**

---

## Decisions (confirmed)

Inherited from the parent spec. Restated because everything below derives from them.

- **D2** — Customer-facing. External clients log in to approve their own campaigns.
- **D3** — One app, RBAC-gated. No separate client portal.
- **D4** — External org admins get the full admin capability set, scoped to their own org.
- **D7** — The seven unauthenticated endpoints are fixed here, not deferred.
- **D9** — Approve is confirmation plus a cancellable undo window. The columns land here; the UI is Epic 2.

---

## Problem

### The exposure

The schema has a split tenancy model. Billing tables carry `org_id`; domain tables do not have the column at
all, so no query can filter by tenant even in principle.

| Table | `org_id` today | Rows visible to an external customer today |
|---|---|---|
| `orgs`, `users`, `org_balances`, `user_balances`, `credit_grants`, `usage_ledger` | ✓ | own org |
| `campaigns` | ✗ | **all orgs** |
| `proposals` | ✗ | **all orgs** |
| `campaign_drafts` | ✗ | **all orgs** |
| `campaign_draft_messages` | ✗ (via `draft_id`) | **all orgs** |
| `performance_snapshots` | ✗ (via `campaign_id`) | **all orgs** |
| `crm_signal_snapshots` | ✗ (via `campaign_id`) | **all orgs** |
| `ai_action_log` | ✗ | **all orgs** |

Seven mutation routes have no authorization check, and `ads-agent/middleware.ts:26` excludes `/api` from its
matcher, so they are reachable with no session at all. The worst is
`POST /api/proposals/[id]/approve` (`approve/route.ts:5`), which calls `decideProposal` then `executeProposal`
inline — provisioning a live Google Ads campaign with a real daily budget
(`ads-agent/lib/executor/execute.ts:40-62`).

**Composite risk:** an unauthenticated stranger who guesses or obtains a proposal UUID can spend an arbitrary
customer's ad budget, and nothing records that it happened.

### Four structural obstacles

1. **Role vocabulary conflict.** `schema.sql` declares `users.role CHECK (role IN ('admin','member'))`;
   `ads-agent/lib/auth/dal.ts:12` declares `"admin" | "operator" | "viewer"`. Two incompatible truths.
2. **`Session.orgId` is nullable.** `dal.ts:13` types it `string | null`, which is why
   `credits/page.tsx:29` uses a non-null assertion and crashes an admin whose JWT lacks an org.
3. **`cron_settings` is a hard global singleton** — `CHECK (id = 1)` with a seeded row. Automation settings,
   and the new undo-window configuration, must become per-org.
4. **Migrations must be idempotent.** `ads-agent/lib/db/migrate.ts:5-9` reads the whole of `schema.sql` and
   executes it as a single query **on every invocation**. `CREATE TABLE IF NOT EXISTS` is a no-op against an
   existing table, so any change expressed only inside a `CREATE TABLE` body silently never applies. The file
   already documents this trap for `proposals_kind_check`. Every change below is therefore written as an
   idempotent `ALTER`.

### Non-goals for this epic

No UI work beyond what authorization forces. The approvals queue, diff detail, undo-window banner, and
navigation changes are Epic 2 and Epic 7. This epic makes the system safe and correct; it does not make it
pleasant.

---

## Approach

### 1. Scope derivation

Two scopes, derived from the **existing** `orgs.kind` column. No new column, no new concept.

```ts
// ads-agent/lib/auth/scope.ts (new)
export type Scope =
  | { kind: "platform"; orgId: string }   // Gentle Space staff; may read across orgs
  | { kind: "org"; orgId: string };       // external customer; hard-bounded to orgId

export function scopeFor(session: Session, orgKind: "internal" | "external"): Scope;
```

`orgs.kind` already exists with `CHECK (kind IN ('internal','external'))` and the seed row is `internal`, so
existing staff keep working through the migration with no data change.

**Platform scope is a read affordance, not a write bypass.** Cross-org writes are permitted only on routes
explicitly marked as support operations, and every one writes an `audit_log` row naming the actor.

### 2. Schema migration

All statements appended to `ads-agent/lib/db/schema.sql`, all idempotent, in this order. Ordering matters:
add nullable → backfill → constrain.

**2a. Tenancy columns**

```sql
ALTER TABLE campaigns        ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES orgs(id);
ALTER TABLE proposals        ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES orgs(id);
ALTER TABLE campaign_drafts  ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES orgs(id);

UPDATE campaigns       SET org_id = '00000000-0000-0000-0000-000000000001' WHERE org_id IS NULL;
UPDATE proposals       SET org_id = '00000000-0000-0000-0000-000000000001' WHERE org_id IS NULL;
UPDATE campaign_drafts SET org_id = '00000000-0000-0000-0000-000000000001' WHERE org_id IS NULL;

ALTER TABLE campaigns        ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE proposals        ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE campaign_drafts  ALTER COLUMN org_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_campaigns_org        ON campaigns(org_id);
CREATE INDEX IF NOT EXISTS idx_proposals_org_status ON proposals(org_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_drafts_org           ON campaign_drafts(org_id);
```

The backfill targets the seeded internal org, which owns all existing rows.

`campaign_draft_messages`, `performance_snapshots`, and `crm_signal_snapshots` are **not** given `org_id`.
They are strict children and are scoped by joining their parent. This keeps one authoritative owner per
entity and avoids a denormalised column that can drift.

**2b. Role vocabulary**

```sql
UPDATE users SET role = 'admin' WHERE role = 'admin';
UPDATE users SET role = 'operator' WHERE role = 'member';

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('admin','operator','viewer'));
ALTER TABLE users ALTER COLUMN role SET DEFAULT 'viewer';
```

`member` maps to `operator`, preserving today's effective capability. The default drops to `viewer` so a new
user is least-privileged until an admin promotes them.

**2c. Proposal lifecycle (columns only; UI is Epic 2)**

```sql
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS decided_by    UUID REFERENCES users(id);
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS decided_via   TEXT;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS execute_after TIMESTAMPTZ;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS canceled_at   TIMESTAMPTZ;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS reopened_at   TIMESTAMPTZ;

ALTER TABLE proposals DROP CONSTRAINT IF EXISTS proposals_status_check;
ALTER TABLE proposals ADD CONSTRAINT proposals_status_check
  CHECK (status IN ('pending','scheduled','executing','approved','rejected','executed','failed'));

ALTER TABLE proposals DROP CONSTRAINT IF EXISTS proposals_decided_via_check;
ALTER TABLE proposals ADD CONSTRAINT proposals_decided_via_check
  CHECK (decided_via IS NULL OR decided_via IN ('ui','bulk','api','system'));

CREATE INDEX IF NOT EXISTS idx_proposals_due
  ON proposals(execute_after) WHERE status = 'scheduled';
```

`approved` is retained in the CHECK so existing rows remain valid; new transitions use `scheduled`.
The partial index is what the worker polls.

**2d. Per-org settings, replacing the singleton**

```sql
CREATE TABLE IF NOT EXISTS org_settings (
  org_id               UUID PRIMARY KEY REFERENCES orgs(id),
  cron_enabled         BOOLEAN NOT NULL DEFAULT false,
  last_run_at          TIMESTAMPTZ,
  undo_window_seconds  INT NOT NULL DEFAULT 60 CHECK (undo_window_seconds BETWEEN 0 AND 3600),
  approval_threshold_inr NUMERIC,          -- NULL = operators may approve any amount (see Q2)
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO org_settings (org_id, cron_enabled, last_run_at)
SELECT '00000000-0000-0000-0000-000000000001', enabled, last_run_at
FROM cron_settings WHERE id = 1
ON CONFLICT (org_id) DO NOTHING;
```

`cron_settings` is left in place, unread, and dropped in a later cleanup once `org_settings` is proven. This
keeps the migration reversible.

**2e. Audit log**

```sql
CREATE TABLE IF NOT EXISTS audit_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES orgs(id),
  actor_type    TEXT NOT NULL CHECK (actor_type IN ('human','agent','system')),
  actor_user_id UUID REFERENCES users(id),
  action        TEXT NOT NULL,
  entity_type   TEXT NOT NULL,
  entity_id     UUID,
  before        JSONB,
  after         JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_org_time ON audit_log(org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_entity   ON audit_log(entity_type, entity_id);

ALTER TABLE audit_log ADD CONSTRAINT audit_actor_present
  CHECK (actor_type <> 'human' OR actor_user_id IS NOT NULL);
```

The final constraint is the point of the table: a human action **cannot** be recorded without naming the
human. `ai_action_log` is retained read-only for the existing Home tiles until Epic 2 migrates them, then
dropped.

Action vocabulary (extensible): `proposal.created`, `proposal.approved`, `proposal.rejected`,
`proposal.canceled`, `proposal.reopened`, `proposal.executed`, `proposal.failed`, `proposal.edited`,
`draft.created`, `draft.converted`, `member.role_changed`, `member.removed`, `credits.granted`,
`settings.changed`, `cycle.run`.

### 3. Data layer

Every function that touches a scoped table takes `scope: Scope` as its **first** parameter. Making it first
and required means a missed call site is a TypeScript error, not a silent full-table read.

```ts
// ads-agent/lib/db/scope-sql.ts (new)
// Returns a SQL fragment + params that constrain a query to the caller's scope.
// Platform scope yields TRUE; org scope yields "org_id = $n".
export function scopeClause(scope: Scope, column = "org_id"): { sql: string; params: unknown[] };
```

| Module | Functions taking `scope` | Notes |
|---|---|---|
| `proposals.ts` | `createProposal`, `listProposals`, `getProposalById`, `decideProposal`, `markProposalExecuted`, `markProposalFailed`, `updateProposalPayload` | 7 of 7. `decideProposal` also gains `decidedBy` and `decidedVia` |
| `campaigns.ts` | `createCampaignRecord`, `listCampaigns`, `getCampaignById`, `markCampaignActive`, `updateCampaignBudget`, `updateCampaignStatus` | 6 of 6 |
| `campaign-drafts.ts` | `createDraft`, `getDraftById`, `updateDraftFields`, `setDraftStatus`, `markDraftConverted`, `appendDraftMessage`, `listDraftMessages` | 7 of 7. The last two join `campaign_drafts` for scope |
| `dashboard.ts` | `getOverviewStats`, `getSpendCplTrend`, `listCampaignsWithLatestCpl` | 3 of 3 |
| `snapshots.ts` | `recordPerformanceSnapshot`, `recentPerformanceSnapshots`, `recordCrmSignalSnapshot`, `latestCrmSignalSnapshot` | 4 of 4, scoped by joining `campaigns` |
| `settings.ts` | `getCronSettings`, `setCronEnabled`, `touchLastRunAt` | Retargeted at `org_settings`; renamed `getOrgSettings`, `setCronEnabled`, `touchLastRunAt` |
| `credits.ts` | `listMemberBalances`, `getSpendByFeature`, `getSpendByModel`, `getSpendTrend` | Already take `orgId`; converted to `Scope` for consistency |
| `credits.ts` | `listOrgBalances` | **Platform scope only.** Throws if called with org scope |
| `audit-log.ts` (new) | `writeAudit`, `listAudit`, `countAuditToday` | Supersedes `ai-action-log.ts` |
| `twenty-pipeline.ts` | `listOpportunities`, `getOpportunity`, `updateOpportunityStage`, `getPipelineValue` | **Blocked on Q4** — see Open questions |

Thirty-one functions change signature. Adjacent `*.test.ts` files update in the same commit.

`getOverviewStats` additionally stops discarding `pendingProposalCount`; Epic 2 consumes it.

### 3a. Database backstop — row-level security (added 2026-08-12)

`scopeClause` is the front line. It is not sufficient on its own: a single missed call site, or any
future code path that bypasses the data layer, reads across tenants with nothing to stop it. RLS is
the layer that fails closed when the application layer has a bug.

The framing to hold: *"RLS should act as an infrastructure safety net, not your primary
authorization gate."* Both layers, neither alone.

```sql
-- One helper. Nothing sets the variable directly.
CREATE OR REPLACE FUNCTION public.set_tenant(p_org_id UUID) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF p_org_id IS NULL THEN RAISE EXCEPTION 'set_tenant called with NULL org_id'; END IF;
  -- Third argument true => transaction-scoped.
  PERFORM set_config('app.current_tenant_id', p_org_id::text, true);
END; $$;

ALTER TABLE adsagent.proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE adsagent.proposals FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON adsagent.proposals
  USING      (org_id = public.current_tenant())
  WITH CHECK (org_id = public.current_tenant());
```

Three details, each of which silently defeats the whole mechanism if missed.

**The third argument to `set_config` is not optional.** Both apps construct `pg.Pool`, so
connections are reused across requests. Without transaction scoping the setting persists on the
connection, and the next request inherits the previous tenant's context — RLS then faithfully
enforces the *wrong* tenant. No error, no log line. This is the failure mode most likely to reach
production undetected.

**`FORCE ROW LEVEL SECURITY`, not merely `ENABLE`.** Table owners ignore row security unless forced.
An application connecting as the owner would set the tenant variable correctly and enforce nothing.

**Connect as a non-owner role.** Application and agent connections use roles holding only the
privileges they need; `BYPASSRLS` and superuser stay out of application code paths entirely. The MCP
context server (agent spec) gets a `SELECT`-only role over tenant-scoped views.

**`WITH CHECK` as well as `USING`.** `USING` stops a tenant reading another's rows; `WITH CHECK`
stops it *writing* rows carrying another tenant's `org_id`.

This extends the release gate below: the cross-tenant suite must run **against a pooled connection**
and assert that a second request on a reused connection cannot see the first request's tenant.
Full DDL for every table is in `2026-08-12-data-model.md` §1.

### 4. API layer

Two guarantees on every mutation route: the caller is authorized, and the caller owns the entity.

```ts
// ads-agent/lib/auth/guard.ts (new)
export async function guard(min: MemberRole): Promise<
  | { ok: true; session: Session; scope: Scope }
  | { ok: false; response: NextResponse }
>;

// Loads the entity under scope. A miss returns 404 — never 403 — so the response
// cannot be used to probe whether another tenant's UUID exists.
export async function ownedOr404<T>(
  loader: (scope: Scope) => Promise<T | null>,
  scope: Scope,
): Promise<{ ok: true; entity: T } | { ok: false; response: NextResponse }>;
```

**Error semantics.** Unauthenticated → `401`. Authenticated but insufficient role → `403`. Authenticated,
sufficient role, wrong tenant → **`404`**. Returning 403 for a cross-tenant hit would confirm the UUID exists
and leak the shape of other customers' data.

The seven unguarded routes:

| Route | Minimum role | Ownership check |
|---|---|---|
| `POST /api/proposals/[id]/approve` | `operator` | `getProposalById` under scope; plus `approval_threshold_inr` if set |
| `POST /api/proposals/[id]/reject` | `operator` | `getProposalById` under scope |
| `PATCH /api/proposals/[id]` | `operator` | `getProposalById` under scope |
| `PATCH /api/campaign-drafts/[id]` | `operator` | `getDraftById` under scope |
| `POST /api/campaign-drafts/[id]/create-proposal` | `operator` | `getDraftById` under scope |
| `POST /api/cycle/run` | `admin` | scope-bounded; runs only the caller's org |
| `PATCH /api/settings` | `admin` | writes only the caller's `org_settings` row |

Already-guarded routes (`credits/grant`, `campaign-drafts/[id]/messages`, `copilot/chat`, `crm/chat`,
`reports/chat`, `hermes/chat`, `openui/tools`, `crm/opportunities/[id]/stage`, `campaigns/[id]/status`) keep
their role check and **gain** the ownership assertion.

Two UI consequences fall out immediately and are fixed here rather than deferred, because they are
authorization bugs rather than polish:

- `layout.tsx:78` renders `RunNowButton` for every role including `viewer`. It becomes `admin`-only.
- `CommandPalette.tsx:68-73` offers "Run decision cycle now" to viewers because its Actions group is not
  role-filtered. It is filtered.

### 5. Session hardening

`Session.orgId` becomes non-nullable at the point of use. `requireSession()` already renders a
pending-approval card when `role` is null (`layout.tsx:19-43`); the same gate now covers a null `orgId`,
so no downstream code needs a non-null assertion. This removes the `credits/page.tsx:29` crash class
outright rather than patching that one call site.

`ensureShadowRows` (`dal.ts:35-48`) continues to upsert `orgs` and `users`, and additionally upserts an
`org_settings` row so a newly-onboarded org has defaults from its first request.

### 6. Rollout sequence

Each step is independently deployable and safe to stop at.

1. Schema migration 2a–2e. Additive only; nothing reads the new columns yet.
2. `Scope`, `scopeClause`, `guard`, `ownedOr404`, `audit-log.ts`. New code, no call sites.
3. Data layer signatures, module by module, tests alongside. Type errors enumerate every call site.
4. API guards on all seven routes, plus ownership assertions on the nine already-guarded routes.
5. Session hardening and the two role-gating UI fixes.
6. Cross-tenant test suite green → **release gate for D2 lifts.**
7. Cleanup: drop `cron_settings`, drop `ai_action_log` (after Epic 2 repoints Home).

Steps 1–5 are behaviour-preserving for the current single internal org, so they can ship continuously without
a flag.

---

## Files touched

**New**
- `ads-agent/lib/auth/scope.ts`
- `ads-agent/lib/auth/guard.ts`
- `ads-agent/lib/db/scope-sql.ts`
- `ads-agent/lib/db/audit-log.ts`
- `ads-agent/lib/db/org-settings.ts`
- Tests adjacent to each

**Modified**
- `ads-agent/lib/db/schema.sql`
- `ads-agent/lib/db/{proposals,campaigns,campaign-drafts,dashboard,snapshots,settings,credits}.ts`
- `ads-agent/lib/auth/dal.ts`
- `ads-agent/app/api/proposals/[id]/{route,approve/route,reject/route}.ts`
- `ads-agent/app/api/campaign-drafts/[id]/{route,create-proposal/route,messages/route}.ts`
- `ads-agent/app/api/{cycle/run,settings,credits/grant,campaigns/[id]/status}/route.ts`
- `ads-agent/app/api/{copilot,crm,reports,hermes}/chat/route.ts`, `app/api/openui/tools/route.ts`
- `ads-agent/app/api/crm/opportunities/[id]/stage/route.ts`
- `ads-agent/app/(admin)/layout.tsx`, `components/CommandPalette.tsx`
- `ads-agent/lib/decision-engine/cycle.ts`, `ads-agent/lib/executor/execute.ts`
- All adjacent `*.test.ts`

**Retained, unread, dropped in step 7**
- `ads-agent/lib/db/ai-action-log.ts`, `cron_settings`

---

## Testing plan

### Cross-tenant isolation — the release gate

A table-driven suite over every scoped function. Fixtures: org A (external), org B (external), org I
(internal). For each function:

| Case | Expected |
|---|---|
| Org A scope reads org A entity | success |
| Org A scope reads org B entity | `null` / empty, never a row |
| Org A scope writes org B entity | no rows affected, no error swallowed |
| Platform scope reads org A and org B | success |
| Platform scope writes without a support marker | rejected |

This suite must be exhaustive over the module inventory, not a sample. A new scoped function without a
corresponding case fails a meta-test that compares exported function names against covered names.

### Authorization

For each of the sixteen mutation routes: no cookie → `401`; `viewer` where `operator` required → `403`;
valid session, other org's UUID → `404` (asserted explicitly — a `403` here is a test failure).

### Audit

Every mutation writes exactly one `audit_log` row with the correct `actor_type` and, for `human`, a non-null
`actor_user_id`. A negative test confirms the `audit_actor_present` constraint rejects a human row with a
null actor.

### Migration

Applied twice in succession against a provisioned database — the idempotency property that
`ads-agent/lib/db/migrate.ts` demands. Assertions: no duplicate columns, no duplicate constraints, backfill
leaves zero `org_id IS NULL` rows, `users.role` contains no `member`, and `org_settings` inherits the
`cron_settings` values.

### Regression

Existing `*.test.ts` files pass after signature changes. `lib/db/migrate.test.ts` extends to cover the new
statements.

---

## Open questions

| # | Question | Blocks | Default if unanswered |
|---|---|---|---|
| Q2 | Should `operator` have an approval value threshold above which `admin` is required? | Role table | Column ships nullable; NULL means no threshold |
| Q4 | Is Twenty CRM data per-org, or one shared pipeline? | `twenty-pipeline.ts` scoping | **Hard blocker.** If shared, `/leads` must be hidden from external orgs until Twenty is partitioned |
| Q6 | Do external orgs self-register, or does staff provision them? | `ensureShadowRows`, onboarding | Staff-provisioned |

**Q4 is the one that can stall the release gate.** Twenty is an external system; if its pipeline is not
partitioned by org, no amount of scoping in this repo makes `/leads` tenant-safe, and the route must be
platform-only until it is.

---

## Review gate

This spec requires your review before an implementation plan is written.
