# RP-W0 — Foundation: autonomy engine, channel registry, tenant config, publish contract

Date: 2026-08-13  
Status: approved  
Program: [`2026-08-13-rp-program-design.md`](2026-08-13-rp-program-design.md)  
Depends on: S11 decision engine (approve → scheduled + undo window), S5a outbox, `ai_action_log`, org scoping + RLS  
Blocks: W1, W2, W3, W4, W5, W6, W7, W8  
Migration range: **120–129**  
Owned paths: `ads-agent/lib/autonomy/`, `ads-agent/lib/channels/`, `ads-agent/lib/tenant-config/`, `ads-agent/lib/publish/`

## Problem

Eight workstreams each need to answer the same four questions: may this write execute without a human, how do I talk to an ad platform, what are this tenant's values, and how do I publish a page. Left to each workstream, those get answered eight incompatible ways. W0 answers them once and freezes the interfaces.

## Goals

1. A pure, testable autonomy decision function plus its policy store, promotion mechanics and kill switches (GC1).
2. A `ChannelAdapter` interface and registry that wraps today's Google/Meta connector functions without changing their behaviour, and yields tool descriptors for W4.
3. A tenant/vertical config store that replaces `strategy-config.ts` constants as the source of CRE values (GC2).
4. A versioned publishing contract and typed client that W5/W6/W7 code against from day one.

## Non-goals

- Any product surface: no new admin page, no new agent, no new channel. W0 ships libraries, migrations and one settings panel for autonomy policy.
- Changing existing proposal flow semantics for kinds that stay gated.
- Implementing `cms-service` (W7 implements the contract W0 defines).

## Approaches considered

| # | Approach | Trade-off |
|---|----------|-----------|
| 1 | Autonomy as a flag on `proposals` | Minimal change; no per-kind promotion, no guardrail history, cannot express "auto for budget nudges, gated for campaign creation" |
| 2 (chosen) | Separate `autonomy_policies` table + pure `evaluate()` | Per-kind granularity, promotion/demotion is data, decision function unit-testable without a DB |
| 3 | Policy engine as an external service (OPA-style) | Most general; new deployment surface and network hop for a decision made on every write |

## Architecture

```text
proposal (any workstream)
      │
      ▼
preflight (existing)  ──►  autonomy.evaluate(action, policy, recentActivity)
      │                              │
      │                              ├─ 'gate'  → proposals.status = 'pending'  → admin approves
      │                              ├─ 'auto'  → proposals.status = 'auto_executed'
      │                              └─ 'block' → proposals.status = 'blocked' (+ reasons)
      ▼
executor ──► ChannelAdapter.execute() | publish client → cms-service
      │
      ▼
outbox event + ai_action_log  (identical shape for gated and auto paths — GC4)
```

## Component 1: autonomy engine (`ads-agent/lib/autonomy/`)

### Data model (migration 120)

```sql
CREATE TABLE adsagent.autonomy_policies (
  org_id                 uuid        NOT NULL,
  action_kind            text        NOT NULL,
  mode                   text        NOT NULL DEFAULT 'gated'
                         CHECK (mode IN ('gated','auto')),
  human_opt_in           boolean     NOT NULL DEFAULT false,
  clean_streak           integer     NOT NULL DEFAULT 0,
  required_streak        integer     NOT NULL DEFAULT 10,
  max_daily_changes      integer     NOT NULL DEFAULT 5,
  max_budget_delta_pct   numeric(5,2) NOT NULL DEFAULT 20.00,
  max_absolute_delta_inr integer     NOT NULL DEFAULT 5000,
  max_blast_radius       integer     NOT NULL DEFAULT 1,
  undo_window_seconds    integer     NOT NULL DEFAULT 900,
  paused                 boolean     NOT NULL DEFAULT false,
  updated_at             timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, action_kind)
);
ALTER TABLE adsagent.autonomy_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE adsagent.autonomy_policies FORCE ROW LEVEL SECURITY;
```

Migration 121 adds `auto_executed` and `blocked` to the `proposals.status` check constraint and an `autonomy_decision jsonb` column recording the decision reasons.

### Interfaces produced

```ts
// lib/autonomy/types.ts
export type AutonomyDecision = 'auto' | 'gate' | 'block';

export type AutonomyAction = {
  orgId: string;
  actionKind: string;              // e.g. 'campaign.budget_update'
  budgetDeltaPct?: number;         // absolute value of proposed % change
  absoluteDeltaInr?: number;
  blastRadius: number;             // count of entities the write touches
};

export type AutonomyPolicy = { /* row shape above */ };

export type RecentActivity = {
  autoExecutionsToday: number;
  openIncidents: number;           // undo/rollback in the last 24h for this kind
};

export type AutonomyEvaluation = {
  decision: AutonomyDecision;
  reasons: string[];               // stable machine-readable codes
};

// lib/autonomy/evaluate.ts — PURE, no I/O
export function evaluateAutonomy(
  action: AutonomyAction,
  policy: AutonomyPolicy | null,
  recent: RecentActivity,
): AutonomyEvaluation;

// lib/autonomy/policies.ts — I/O
export function getPolicy(orgId: string, actionKind: string): Promise<AutonomyPolicy | null>;
export function recordOutcome(
  orgId: string, actionKind: string, outcome: 'clean' | 'reverted' | 'rejected',
): Promise<void>;
export function setPolicy(orgId: string, actionKind: string, patch: Partial<AutonomyPolicy>): Promise<void>;
```

### Decision rules

`evaluateAutonomy` returns `gate` when: policy is `null`, `paused` is true, `human_opt_in` is false, `mode` is `gated`, or `clean_streak < required_streak`. It returns `block` when a guardrail is exceeded — `budgetDeltaPct > max_budget_delta_pct`, `absoluteDeltaInr > max_absolute_delta_inr`, `blastRadius > max_blast_radius`, `autoExecutionsToday >= max_daily_changes`, or `openIncidents > 0`. It returns `auto` only when a policy exists, is opted in, unpaused, in `auto` mode, has met its streak, and every guardrail passes. Every non-`auto` result carries reason codes (`no_policy`, `not_opted_in`, `paused`, `streak_unmet`, `budget_delta_exceeded`, `absolute_delta_exceeded`, `blast_radius_exceeded`, `daily_limit_reached`, `open_incident`).

`blastRadius` is the count of live entities a single write touches — one campaign is 1, a bulk negative-keyword push across twelve ad groups is 12. It exists so that an action kind can be safe at small scale and gated at large scale without needing a separate kind.

`recordOutcome` increments `clean_streak` on `clean`; on `reverted` or `rejected` it sets `clean_streak = 0` and `mode = 'gated'`.

### Execute-time re-check

The executor calls `evaluateAutonomy` a second time immediately before the adapter call, with freshly read activity counters. A decision that degrades from `auto` to `block` aborts the execution and writes the reasons to `autonomy_decision`. This exists because spend and change counts drift between proposal creation and execution.

### Kill switches

`AUTONOMY_ENABLED=0` (env, whole service) → every evaluation returns `gate`. Per-org: a `tenant_config` flag. Per-kind: `paused`. All three are checked inside `evaluateAutonomy` so no caller can bypass them.

## Component 2: channel adapter + tool registry (`ads-agent/lib/channels/`)

### Interfaces produced

```ts
export type ChannelId = 'google' | 'meta' | 'linkedin';

export type ToolDescriptor = {
  name: string;                    // 'google.update_campaign_budget'
  description: string;
  inputSchema: Record<string, unknown>;   // JSON Schema
  mutating: boolean;
  actionKind?: string;             // required when mutating
};

export type ExecutionResult = {
  ok: boolean;
  externalIds: string[];
  compensated?: boolean;
  error?: { class: 'transient' | 'policy' | 'auth' | 'validation'; message: string };
};

export type ChannelAdapter = {
  id: ChannelId;
  capabilities: string[];                             // action kinds supported
  read(scope: OrgScope, query: ReadQuery): Promise<PerformanceRow[]>;
  propose(input: ProposeInput): Promise<ProposalPayload>;   // never writes
  execute(payload: ProposalPayload, ctx: ExecuteContext): Promise<ExecutionResult>;
  describeTools(): ToolDescriptor[];
};

export function registerAdapter(adapter: ChannelAdapter): void;
export function getAdapter(id: ChannelId): ChannelAdapter;
export function listToolDescriptors(): ToolDescriptor[];
```

`ExecuteContext` carries `{ orgId, idempotencyKey, proposalId, dryRun }`. Adapters must treat a repeated `idempotencyKey` as a no-op returning the original `externalIds`.

### Migration of existing connectors

`lib/connectors/google-ads.ts` and `lib/connectors/meta.ts` keep their exported functions and tests unchanged. W0 adds `lib/channels/google-adapter.ts` and `lib/channels/meta-adapter.ts` that call those functions and map errors into the `ExecutionResult.error.class` taxonomy. No existing test is rewritten; the adapters get their own tests.

## Component 3: tenant & vertical config (`ads-agent/lib/tenant-config/`)

### Data model (migration 122)

```sql
CREATE TABLE adsagent.tenant_config (
  org_id     uuid        NOT NULL PRIMARY KEY,
  vertical   text        NOT NULL DEFAULT 'cre',
  payload    jsonb       NOT NULL,
  version    integer     NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE adsagent.tenant_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE adsagent.tenant_config FORCE ROW LEVEL SECURITY;
```

### Interfaces produced

```ts
export type CreConfig = {
  corridors: string[];
  negativeKeywordSeeds: string[];
  leadTiers: string[];              // e.g. ['hot','warm','cold']
  objective: 'hot_warm_leads' | 'volume' | 'roas';
  currency: 'INR';
  monthlyBudget: number;
  brandKit: { name: string; primaryColor: string; logoArtifactKey?: string };
  autonomyEnabled: boolean;
};

export function getTenantConfig(orgId: string): Promise<CreConfig>;
export function setTenantConfig(orgId: string, patch: Partial<CreConfig>): Promise<CreConfig>;
```

The current `lib/decision-engine/strategy-config.ts` values become the seed row inserted by migration 122 for the platform org. `strategy-config.ts` is reduced to exporting that seed object, and all readers move to `getTenantConfig()`.

## Component 4: publishing contract (`ads-agent/lib/publish/`)

W7 implements the server; W0 defines the contract and the client. Authentication mirrors `lib/auth/internal-client.ts`: a shared `x-agent-internal-key` header plus `orgId` in the body, validated server-side.

```ts
export type PageUpsert = {
  orgId: string; slug: string; title: string; metaDescription: string;
  blocks: PageBlock[]; locale: string; publish: boolean;
};
export type BlockPatch = { orgId: string; pageId: string; blockId: string; content: unknown };
export type ExperimentCreate = {
  orgId: string; pageId: string; hypothesis: string;
  variants: { id: string; blocks: PageBlock[] }[]; trafficSplit: number[];
};

export type PublishContext = {
  idempotencyKey: string;
  proposalId: string;      // the ledger row this write descends from — required, never optional
  author: string;          // 'agent:seo' | 'agent:geo' | 'agent:cro' | 'user:<id>'
};

export function upsertPage(input: PageUpsert, ctx: PublishContext): Promise<{ pageId: string; version: number }>;
export function patchBlock(input: BlockPatch, ctx: PublishContext): Promise<{ version: number }>;
export function createExperiment(input: ExperimentCreate, ctx: PublishContext): Promise<{ experimentId: string }>;
export function getPageAudit(orgId: string, pageId: string): Promise<PageAuditEntry[]>;
```

Every one of these is a mutating action and therefore passes through `evaluateAutonomy` with action kinds `cms.page_upsert`, `cms.block_patch`, `cms.experiment_create` before the client is called. The client itself does not call the autonomy engine — callers do — and the W5/W6/W7 gate tests assert that.

`proposalId` is mandatory on every write, which is what lets `cms-service` reject any content change that did not descend from the ledger (GC1, GC4) and lets W5 correlate a ranking decline with the exact change that preceded it.

## Admin surface

One page, `ads-agent/app/(admin)/settings/autonomy/`: a table of action kinds showing mode, opt-in toggle, streak progress, guardrail values and a pause switch. Editing writes through `setPolicy`. This is the human opt-in required by the policy model.

## Error handling

Policy lookup failure, config parse failure and registry lookup failure all fail closed — gate the action, log, and surface on the proposal. Adapter errors are classified into the four `ExecutionResult.error.class` values; only `transient` is retried, via the existing outbox retry path.

## Testing

- `lib/autonomy/evaluate.test.ts` — table-driven over every reason code; asserts fail-closed on `null` policy and on each kill switch.
- `lib/autonomy/policies.db.test.ts` — promotion after N clean outcomes, demotion on revert, tenant isolation.
- `lib/channels/registry.test.ts` — descriptor generation, `mutating` descriptors always carry `actionKind`, unknown adapter throws.
- `lib/channels/*-adapter.test.ts` — error classification and idempotency no-op behaviour, with the platform SDK mocked.
- `lib/tenant-config/config.db.test.ts` — schema validation, seed migration produces a valid `CreConfig`, RLS isolation.
- `lib/publish/client.test.ts` — contract shape and header/idempotency propagation against a stub server.
- `lib/autonomy/w0-gate.test.ts` — the workstream gate: an auto-executed action produces a `proposals` row, an `ai_action_log` row and an outbox message indistinguishable in shape from the gated path (GC4).
