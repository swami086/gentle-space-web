# S11 Decision Engine Extensions (E1–E7) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Parallelism:** One git worktree + branch per implementation subagent (`superpowers:using-git-worktrees` / `best-of-n-runner`). Ceiling: **8 concurrent implementation subagents**. Never share a working tree across parallel writers.

**Goal:** Ship backend-spec E1–E7 so the approvals surface shows broker-facing copy, structured pre-flight results, semantic before/after diffs, budget deltas on list rows, a cancellable undo window with a cron consumer, bulk approve/reject with per-item results, and staff-only saved filters — gate: **pre-flight checks and diffs render**.

**Architecture:** Pure decision-engine modules (`broker-rationale`, `preflight`, `semantic-diff`, `budget-delta`) stay side-effect-free and unit-tested. Lifecycle columns + status values land in migration **107**; approve stops calling `executeProposal` synchronously and transitions to `scheduled` with `undo_until`. A new undo worker claims due rows, sets `executing`, then calls existing `executeProposal` (updated to accept `executing`). Bulk and filters are thin API/DB layers. UI wires read-only renderers onto existing proposal list/detail pages.

**Tech Stack:** TypeScript, Next.js App Router, Vitest, `pg`, existing `node-cron` worker pattern (`scripts/run-decision-cycle.ts`), Zod optional for route bodies.

**Specs (no separate S11 design doc — these are authoritative):**
- [`docs/superpowers/specs/2026-08-12-backend-features-design.md`](../specs/2026-08-12-backend-features-design.md) §E (E1–E7)
- [`docs/superpowers/specs/2026-08-11-admin-ux-architecture-design.md`](../specs/2026-08-11-admin-ux-architecture-design.md) §C undo window / bulk cancel
- [`docs/superpowers/specs/2026-08-12-data-model.md`](../specs/2026-08-12-data-model.md) §2 (`scheduled_for`, `undo_until`)
- [`docs/superpowers/specs/2026-08-12-build-sequence.md`](../specs/2026-08-12-build-sequence.md) S11 gate

**Torbit (indexed `/Users/swami/Documents/GentleSpace_Web`):** prefer `run_sql` on `gl_file` / `gl_definition` / `gl_edge` over grep when locating callers. Key hubs already mapped: `ads-agent/lib/db/proposals.ts`, `ads-agent/lib/executor/execute.ts`, `ads-agent/app/api/proposals/[id]/approve/route.ts`, `ads-agent/lib/decision-engine/*`, `ads-agent/lib/env-status.ts` (`getConnectorStatus`), `ads-agent/lib/metering/ledger.ts` (`getOrgBalance`), `ads-agent/lib/db/org-settings.ts` (`undoWindowSeconds`).

## Global Constraints

- No new npm dependencies.
- Every data-layer function takes `Scope` first; wrong tenant → **404**, never 403.
- Schema-qualified SQL; numbered up/down migrations only (`107`–`109` reserved for this plan).
- Column names are **`scheduled_for`** and **`undo_until`** (data model), not `execute_after`.
- Approve → **`scheduled`**, never synchronous Google/Meta calls. Execution only via undo worker after `undo_until`.
- Render **literal payload diffs**, not agent prose, as the approval truth (UX security note). Rationale/broker copy is labelled “reasoning” only.
- Strip invisible Unicode (tag-block U+E0000–E007F, ZW*, variation selectors) at ingest/render boundaries for displayed strings.
- Bulk approve: each item gets its own `undo_until`; also return a `batchId` so one **bulk cancel** can reverse the whole batch while any member is still `scheduled`.
- `executeProposal` today requires `status === "approved"` — change to `status === "executing"` (worker sets that immediately before call). Legacy `approved` rows (if any) are treated as immediately executable only by an explicit one-shot backfill in Task 1, not by the hot path.
- Do not modify `ads-agent/lib/decision-engine/cycle.ts` unless a task explicitly lists it (blast radius).
- Tests: Vitest colocated `*.test.ts`; run from `ads-agent/`. Prefer `composer-2.5-fast` for mechanical TDD; `inherit` when judgment/security is load-bearing.
- Prefer Torbit MCP for codebase navigation; minimise grep.

## Skills catalog shortlist (use these — do not invent others)

| Skill | Role in S11 |
|---|---|
| `superpowers:using-git-worktrees` | **Required** for every parallel implementation agent |
| `superpowers:test-driven-development` | **Required** for every code task |
| `superpowers:subagent-driven-development` | Orchestrator / SDD runner |
| `superpowers:requesting-code-review` | Spec + quality review after each task |
| `superpowers:verification-before-completion` | Gate task + finish |
| `superpowers:systematic-debugging` | Only if a task fails unexpectedly |
| `postgres-pro` | Migrations, RLS, claim SQL |
| `database-designer` | Saved-filters schema |
| `typescript-pro` | Pure modules, type unions |
| `senior-backend` | Routes, worker, approve/cancel semantics |
| `api-designer` / `api-design-reviewer` | Bulk endpoint contracts |
| `ai-security` | Preflight + approval trust boundary |
| `security-auditor` | Approve/cancel/bulk money path review |
| `senior-qa` / `adversarial-reviewer` | Final gate |

Process skills apply to **every** task. Domain skills are listed per task below.

## File map

| Path | Responsibility |
|---|---|
| `ads-agent/lib/db/migrations/107_proposal_undo_lifecycle.up.sql` (+ `.down.sql`) | `scheduled_for`, `undo_until`, `batch_id`, status check incl. `scheduled`/`executing` |
| `ads-agent/lib/db/migrations/108_proposal_saved_filters.up.sql` (+ `.down.sql`) | Staff saved filters table |
| `ads-agent/lib/db/migrations/109_proposal_preflight.up.sql` (+ `.down.sql`) | Optional `preflight jsonb` column on proposals |
| `ads-agent/lib/types.ts` | Extend `ProposalStatus`, `Proposal` fields |
| `ads-agent/lib/decision-engine/broker-rationale.ts` | E1 deterministic broker copy |
| `ads-agent/lib/decision-engine/preflight.ts` | E2 structured checks |
| `ads-agent/lib/decision-engine/semantic-diff.ts` | E3 before/after pairs |
| `ads-agent/lib/decision-engine/budget-delta.ts` | E4 delta helper |
| `ads-agent/lib/decision-engine/strip-smuggle.ts` | Shared invisible-Unicode strip |
| `ads-agent/lib/db/proposals.ts` | Schedule / cancel / claim / bulk / list with delta |
| `ads-agent/lib/db/proposal-filters.ts` | E7 CRUD |
| `ads-agent/lib/executor/execute.ts` | Accept `executing` |
| `ads-agent/app/api/proposals/[id]/approve/route.ts` | Schedule + preflight gate |
| `ads-agent/app/api/proposals/[id]/cancel/route.ts` | Undo within window |
| `ads-agent/app/api/proposals/bulk/route.ts` | Bulk approve/reject |
| `ads-agent/app/api/proposals/bulk-cancel/route.ts` | Bulk cancel by `batchId` |
| `ads-agent/scripts/run-proposal-undo-worker.ts` | E5 cron consumer |
| `ads-agent/app/(admin)/proposals/page.tsx` | Budget delta column + scheduled tab |
| `ads-agent/app/(admin)/proposals/[id]/page.tsx` (+ components) | Diff + preflight + broker copy + undo banner |

---

## Parallel execution model

| Wave | Tasks (parallel) | Width | Depends on |
|---|---|---|---|
| **W1** | Task 1 (lifecycle migration + types + strip-smuggle) | **1** | — |
| **W2** | Tasks 2–8 (E1, E2, E3, E4, E5 claim helpers, E6 bulk pure, E7 filters) | **7** | Task 1 |
| **W3** | Tasks 9–12 (approve schedule, cancel, bulk routes, execute+worker) | **4** | W2 relevant libs + Task 1 |
| **W4** | Tasks 13–14 (list/detail UI wire-up, staff filters API+UI stub) | **2** | W3 |
| **W5** | Task 15 (S11 gate: preflight + diffs render + undo claim dry-run) | **1** | W4 |

Peak parallel width: **7** in W2 (under the 8 ceiling). Do **not** start a Task-1 sibling in W2 — migration/types are the shared contract.

| Task | Domain skills | Model |
|---|---|---|
| 1 | `postgres-pro`, `typescript-pro` | `inherit` |
| 2 (E1) | `typescript-pro` | `composer-2.5-fast` |
| 3 (E2) | `senior-backend`, `ai-security` | `inherit` |
| 4 (E3) | `typescript-pro` | `composer-2.5-fast` |
| 5 (E4) | `typescript-pro` | `composer-2.5-fast` |
| 6 (E5 helpers) | `postgres-pro`, `senior-backend` | `composer-2.5-fast` |
| 7 (E6 pure) | `api-designer`, `senior-backend` | `composer-2.5-fast` |
| 8 (E7) | `postgres-pro`, `database-designer` | `composer-2.5-fast` |
| 9–12 | `senior-backend`, `security-auditor` (9,11) | `inherit` for 9/11; `composer-2.5-fast` for 10/12 |
| 13–14 | `typescript-pro` | `composer-2.5-fast` |
| 15 | `senior-qa`, `adversarial-reviewer`, `verification-before-completion` | `inherit` |

---

### Task 1: Proposal undo lifecycle (migration + types + strip)

**Skills:** `postgres-pro`, `typescript-pro`, `superpowers:test-driven-development`, `superpowers:using-git-worktrees`

**Files:**
- Create: `ads-agent/lib/db/migrations/107_proposal_undo_lifecycle.up.sql`
- Create: `ads-agent/lib/db/migrations/107_proposal_undo_lifecycle.down.sql`
- Create: `ads-agent/lib/decision-engine/strip-smuggle.ts`
- Create: `ads-agent/lib/decision-engine/strip-smuggle.test.ts`
- Modify: `ads-agent/lib/types.ts` (`ProposalStatus`, `Proposal`)
- Modify: `ads-agent/lib/db/proposals.ts` (`ProposalRow` + `rowToProposal` only — no behaviour change yet)

**Interfaces — Produces:**
- `ProposalStatus` includes `"scheduled" | "executing"` (keep `"approved"` for legacy reads)
- `Proposal` gains optional `scheduledFor`, `undoUntil`, `batchId` (`string | null`)
- `export function stripSmuggle(input: string): string`

**Migration 107 must:**
1. `ALTER TABLE adsagent.proposals ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ;`
2. `ADD COLUMN IF NOT EXISTS undo_until TIMESTAMPTZ;`
3. `ADD COLUMN IF NOT EXISTS batch_id UUID;`
4. Drop/recreate status CHECK to allow `pending|approved|rejected|executed|failed|scheduled|executing`
5. Index `(org_id, status, undo_until)` partial where `status = 'scheduled'`
6. RLS unchanged (existing tenant policy)

- [ ] **Step 1: Write failing strip-smuggle tests**

```ts
// ads-agent/lib/decision-engine/strip-smuggle.test.ts
import { describe, expect, it } from "vitest";
import { stripSmuggle } from "./strip-smuggle";

describe("stripSmuggle", () => {
  it("removes zero-width and tag-block chars", () => {
    expect(stripSmuggle("hello\u200Bworld")).toBe("helloworld");
    expect(stripSmuggle("a\u{E0061}b")).toBe("ab");
  });
  it("leaves normal text", () => {
    expect(stripSmuggle("Raise budget to ₹500")).toBe("Raise budget to ₹500");
  });
});
```

- [ ] **Step 2: Run — expect FAIL (module missing)**

```bash
cd ads-agent && npx vitest run lib/decision-engine/strip-smuggle.test.ts
```

- [ ] **Step 3: Implement `stripSmuggle`**

```ts
// ads-agent/lib/decision-engine/strip-smuggle.ts
const SMUGGLE =
  /[\u200B-\u200D\uFEFF\u2060\u180E]|[\u{E0000}-\u{E007F}]|\p{Cf}/gu;

export function stripSmuggle(input: string): string {
  return input.replace(SMUGGLE, "");
}
```

- [ ] **Step 4: Write migration 107 up/down + extend types + ProposalRow mapping**

```ts
// types.ts — replace ProposalStatus
export type ProposalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "executed"
  | "failed"
  | "scheduled"
  | "executing";
```

Add to `Proposal`: `scheduledFor: string | null; undoUntil: string | null; batchId: string | null`.

- [ ] **Step 5: Re-run strip tests — PASS; commit**

```bash
git add ads-agent/lib/db/migrations/107_proposal_undo_lifecycle.* \
  ads-agent/lib/decision-engine/strip-smuggle.ts \
  ads-agent/lib/decision-engine/strip-smuggle.test.ts \
  ads-agent/lib/types.ts ads-agent/lib/db/proposals.ts
git commit -m "$(cat <<'EOF'
feat(s11): proposal undo lifecycle columns and strip-smuggle

EOF
)"
```

---

### Task 2: E1 Broker-facing rationale renderer

**Skills:** `typescript-pro`, `superpowers:test-driven-development`, `superpowers:using-git-worktrees`

**Files:**
- Create: `ads-agent/lib/decision-engine/broker-rationale.ts`
- Create: `ads-agent/lib/decision-engine/broker-rationale.test.ts`

**Interfaces — Produces:**
- `export function brokerRationale(input: { kind: string; payload: Record<string, unknown>; triggeredRule: string }): string`
- Deterministic, **no LLM**. Numbers-forward. Apply `stripSmuggle` on output.
- Must cover: `budget_change`, `pause`, `create_campaign`, `add_negative_keyword`, `campaign_strategy`, `enquiry.requirement_update`, `message.draft`, unknown → generic fallback.

- [ ] **Step 1: Failing tests** (assert exact strings for budget_change / pause / unknown)

```ts
import { describe, expect, it } from "vitest";
import { brokerRationale } from "./broker-rationale";

describe("brokerRationale", () => {
  it("budget_change is numbers-forward", () => {
    expect(
      brokerRationale({
        kind: "budget_change",
        triggeredRule: "budget_reallocation",
        payload: { campaignId: "c1", newDailyBudgetInr: 1500 },
      }),
    ).toMatch(/₹\s*1,?500/);
  });

  it("pause names the action plainly", () => {
    expect(
      brokerRationale({
        kind: "pause",
        triggeredRule: "kill_rule",
        payload: { campaignId: "c1" },
      }),
    ).toMatch(/pause/i);
  });
});
```

- [ ] **Step 2: Run — FAIL**
- [ ] **Step 3: Implement minimal switch renderer**
- [ ] **Step 4: PASS + commit** `feat(s11): broker-facing proposal rationale (E1)`

---

### Task 3: E2 Pre-flight checks

**Skills:** `senior-backend`, `ai-security`, `superpowers:test-driven-development`, `superpowers:using-git-worktrees`

**Files:**
- Create: `ads-agent/lib/decision-engine/preflight.ts`
- Create: `ads-agent/lib/decision-engine/preflight.test.ts`
- Create: `ads-agent/lib/db/migrations/109_proposal_preflight.up.sql` (+ down) — `preflight JSONB`

**Interfaces — Produces:**
```ts
export type PreflightCheckId =
  | "budget_cap"
  | "connector_health"
  | "credit_balance"
  | "keyword_overlap";

export type PreflightCheck = {
  id: PreflightCheckId;
  ok: boolean;
  severity: "block" | "warn";
  message: string;
  detail?: Record<string, unknown>;
};

export type PreflightResult = {
  ok: boolean; // false if any severity:block failed
  checks: PreflightCheck[];
};

export type PreflightInput = {
  kind: string;
  payload: Record<string, unknown>;
  orgDailyBudgetCapInr: number | null; // from approval_threshold_inr or null = unlimited
  creditBalance: number;
  connectors: { googleAds: boolean; meta: boolean };
  existingKeywords?: string[]; // for overlap
};

export function runPreflight(input: PreflightInput): PreflightResult;
```

Rules (keep pure — callers inject numbers):
1. **budget_cap:** for `budget_change` / `create_campaign`, if cap set and proposed daily budget > cap → `block`
2. **connector_health:** if kind needs google and `!connectors.googleAds` → `block` (meta analog)
3. **credit_balance:** if `creditBalance <= 0` → `warn` (does not block ads mutations; documents risk)
4. **keyword_overlap:** for `add_negative_keyword` / `create_campaign`, if keyword already in `existingKeywords` (casefold) → `warn`

- [ ] **Step 1–4:** TDD as above; commit `feat(s11): structured proposal preflight (E2)`

---

### Task 4: E3 Semantic diff

**Skills:** `typescript-pro`, `superpowers:test-driven-development`, `superpowers:using-git-worktrees`

**Files:**
- Create: `ads-agent/lib/decision-engine/semantic-diff.ts`
- Create: `ads-agent/lib/decision-engine/semantic-diff.test.ts`

**Interfaces — Produces:**
```ts
export type DiffField = {
  field: string;
  before: string | number | boolean | null;
  after: string | number | boolean | null;
};

export function semanticDiff(input: {
  kind: string;
  payload: Record<string, unknown>;
  live?: {
    dailyBudgetInr?: number | null;
    status?: string | null;
    name?: string | null;
  };
}): DiffField[];
```

Cover:
- `budget_change` → `dailyBudgetInr` before=live, after=payload.newDailyBudgetInr
- `pause` → `status` before=live.status ?? "active", after=`paused`
- `create_campaign` → fields from payload (before=null)
- `add_negative_keyword` → keyword before=null after=text
- `enquiry.requirement_update` → enumerate payload.diff keys if object
- unknown → empty array

Strip smuggle on string before/after.

- [ ] TDD + commit `feat(s11): semantic proposal diffs (E3)`

---

### Task 5: E4 Budget delta helper

**Skills:** `typescript-pro`, `superpowers:test-driven-development`, `superpowers:using-git-worktrees`

**Files:**
- Create: `ads-agent/lib/decision-engine/budget-delta.ts`
- Create: `ads-agent/lib/decision-engine/budget-delta.test.ts`

**Interfaces — Produces:**
```ts
/** Signed INR delta for list rows. null when kind has no budget impact. */
export function budgetDeltaInr(input: {
  kind: string;
  payload: Record<string, unknown>;
  currentDailyBudgetInr?: number | null;
}): number | null;
```

- `budget_change`: `(newDailyBudgetInr) - (currentDailyBudgetInr ?? 0)`
- `create_campaign`: `+(dailyBudgetInr|newDailyBudgetInr)` 
- `pause`: `-(currentDailyBudgetInr ?? 0)` (budget freed)
- else `null`

- [ ] TDD + commit `feat(s11): proposal budget delta helper (E4)`

---

### Task 6: E5 Claim / schedule / cancel DB helpers

**Skills:** `postgres-pro`, `senior-backend`, `superpowers:test-driven-development`, `superpowers:using-git-worktrees`

**Files:**
- Modify: `ads-agent/lib/db/proposals.ts`
- Create: `ads-agent/lib/db/proposals-lifecycle.test.ts` (unit with mocked `withTenantTransaction` **or** follow existing `proposals.test.ts` style)

**Interfaces — Produces:**
```ts
export async function scheduleProposal(
  scope: Scope,
  id: string,
  opts: { decidedBy: string; decidedVia: "ui" | "bulk" | "api" | "system"; undoWindowSeconds: number; batchId?: string | null },
): Promise<Proposal | null>;

export async function cancelScheduledProposal(
  scope: Scope,
  id: string,
): Promise<Proposal | null>; // only if status=scheduled AND undo_until > now(); → pending

export async function cancelScheduledBatch(
  scope: Scope,
  batchId: string,
): Promise<number>; // rows cancelled

/** Cross-tenant worker claim: FOR UPDATE SKIP LOCKED, set executing, return ids+org_id */
export async function claimDueScheduledProposals(limit: number): Promise<Array<{ id: string; orgId: string }>>;
```

`scheduleProposal` SQL sets `status='scheduled'`, `decided_at=now()`, `decided_by`, `decided_via`, `scheduled_for=now()`, `undo_until=now() + (undoWindowSeconds || 0) * interval '1 second'`, optional `batch_id`.

`claimDueScheduledProposals` uses owner/pool path consistent with other cron scripts (see `run-erasure-sweep.ts` / `withCrossTenantRead` pattern) — **must not** use a tenant-scoped pool without setting tenant per row.

- [ ] TDD + commit `feat(s11): schedule/cancel/claim proposal helpers (E5)`

---

### Task 7: E6 Bulk decide pure helper

**Skills:** `api-designer`, `senior-backend`, `superpowers:test-driven-development`, `superpowers:using-git-worktrees`

**Files:**
- Create: `ads-agent/lib/decision-engine/bulk-decide.ts`
- Create: `ads-agent/lib/decision-engine/bulk-decide.test.ts`

**Interfaces — Produces:**
```ts
export type BulkItemResult =
  | { id: string; ok: true; status: "scheduled" | "rejected" }
  | { id: string; ok: false; error: string };

export function partitionBulkIds(ids: string[], max = 50): { ok: string[] } | { error: string };
```

Validate: non-empty, unique, `ids.length <= max`, each id looks like UUID. Route task uses this then loops `scheduleProposal` / `decideProposal(..., "rejected")` with **partial failure** (never abort whole batch on one 409).

- [ ] TDD + commit `feat(s11): bulk decide validation helper (E6)`

---

### Task 8: E7 Saved filters (migration + DB)

**Skills:** `postgres-pro`, `database-designer`, `superpowers:test-driven-development`, `superpowers:using-git-worktrees`

**Files:**
- Create: `ads-agent/lib/db/migrations/108_proposal_saved_filters.up.sql` (+ down)
- Create: `ads-agent/lib/db/proposal-filters.ts`
- Create: `ads-agent/lib/db/proposal-filters.test.ts`

**Schema:**
```sql
CREATE TABLE adsagent.proposal_saved_filters (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  org_id public.org_ref NOT NULL REFERENCES public.orgs(id), -- creator's home org; staff queries may be cross-org via platform
  owner_user_id UUID NOT NULL REFERENCES public.users(id),
  name TEXT NOT NULL,
  query JSONB NOT NULL, -- { statuses?:[], kinds?:[], orgIds?:[] } staff-only orgIds
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, name)
);
-- ENABLE+FORCE RLS; policy owner_user_id = current_user OR is_platform_read()
```

**Produces:** `listSavedFilters`, `createSavedFilter`, `deleteSavedFilter` with `Scope` + `userId`.

Staff-only enforcement is in the **API** task (14), not here — DB still tenant-safe.

- [ ] TDD + commit `feat(s11): proposal saved filters table (E7)`

---

### Task 9: Approve schedules (no sync execute) + attach preflight/diff

**Skills:** `senior-backend`, `security-auditor`, `superpowers:test-driven-development`, `superpowers:using-git-worktrees`

**Files:**
- Modify: `ads-agent/app/api/proposals/[id]/approve/route.ts`
- Modify: `ads-agent/app/api/proposals/[id]/approve/route.test.ts`
- Modify: `ads-agent/app/api/proposals/[id]/route.ts` (GET detail enrichment if present; else leave)

**Behaviour:**
1. `guard("operator")`
2. Load proposal; 404/409 as today if not `pending`
3. Load org settings + credits + connectors + optional campaign for live budget
4. `runPreflight(...)`; if `!ok` return **422** `{ error: "preflight_failed", preflight }`
5. `scheduleProposal(...)` with `undoWindowSeconds` from org settings
6. Return `{ ok: true, proposal, preflight, diff: semanticDiff(...), brokerCopy: brokerRationale(...), budgetDeltaInr: budgetDeltaInr(...) }`
7. **Do not** call `executeProposal`

- [ ] Update tests: mock schedule, assert execute **not** called
- [ ] Commit `feat(s11): approve schedules into undo window`

---

### Task 10: Cancel (single) route

**Skills:** `senior-backend`, `superpowers:test-driven-development`, `superpowers:using-git-worktrees`

**Files:**
- Create: `ads-agent/app/api/proposals/[id]/cancel/route.ts`
- Create: `ads-agent/app/api/proposals/[id]/cancel/route.test.ts`

`POST` → `cancelScheduledProposal`; 409 if window elapsed or wrong status.

- [ ] TDD + commit `feat(s11): cancel scheduled proposal within undo window`

---

### Task 11: Bulk approve/reject + bulk cancel routes

**Skills:** `api-designer`, `api-design-reviewer`, `security-auditor`, `superpowers:test-driven-development`, `superpowers:using-git-worktrees`

**Files:**
- Create: `ads-agent/app/api/proposals/bulk/route.ts` (+ test)
- Create: `ads-agent/app/api/proposals/bulk-cancel/route.ts` (+ test)

**POST `/api/proposals/bulk` body:** `{ action: "approve"|"reject", ids: string[] }`  
- Generate one `batchId = randomUUID()` for approve  
- Per id: try schedule/reject; push `BulkItemResult`  
- Response: `{ batchId, results: BulkItemResult[] }` (HTTP 200 even with partial failures)

**POST `/api/proposals/bulk-cancel` body:** `{ batchId: string }` → `cancelScheduledBatch`

- [ ] TDD + commit `feat(s11): bulk approve/reject and bulk cancel (E6)`

---

### Task 12: executeProposal accepts `executing` + undo worker

**Skills:** `senior-backend`, `postgres-pro`, `superpowers:test-driven-development`, `superpowers:using-git-worktrees`

**Files:**
- Modify: `ads-agent/lib/executor/execute.ts` (+ test)
- Create: `ads-agent/scripts/run-proposal-undo-worker.ts`
- Create: `ads-agent/scripts/run-proposal-undo-worker.test.ts` (arg/env behaviour; mock claim/execute)
- Modify: `ads-agent/package.json` — script `worker:proposals` → `tsx scripts/run-proposal-undo-worker.ts`

**executeProposal:** require `status === "executing"` (update error message).

**Worker pattern** (mirror `run-decision-cycle.ts`):
```ts
import cron from "node-cron";
// each tick: claimDueScheduledProposals(10) → for each row set tenant → executeProposal
const SCHEDULE = process.env.PROPOSAL_UNDO_CRON ?? "*/15 * * * * *"; // every 15s default
```

Do **not** gate on `cronEnabled` (that flag is for decision-cycle). Optional `PROPOSAL_UNDO_WORKER=0` to no-op.

- [ ] TDD + commit `feat(s11): undo worker executes due scheduled proposals (E5)`

---

### Task 13: List + detail UI — delta, preflight, diff, undo banner

**Skills:** `typescript-pro`, `superpowers:test-driven-development`, `superpowers:using-git-worktrees`

**Files:**
- Modify: `ads-agent/app/(admin)/proposals/page.tsx` — add Scheduled tab; Budget Δ column using `budgetDeltaInr` + campaign lookup (batch `getCampaignById` / extend `listProposals` join if cheaper — prefer extending list query once in `proposals.ts` with optional `current_daily_budget`)
- Modify: `ads-agent/app/(admin)/proposals/[id]/page.tsx`
- Create: `ads-agent/app/(admin)/proposals/[id]/PreflightPanel.tsx`
- Create: `ads-agent/app/(admin)/proposals/[id]/DiffTable.tsx`
- Modify: `ads-agent/app/(admin)/proposals/[id]/ProposalActions.tsx` — Cancel button when `scheduled` and `undoUntil > now`; show countdown text

**Gate-critical:** detail page must render `PreflightPanel` + `DiffTable` for pending/scheduled proposals (compute server-side on render).

Keep styling within existing pencil/ui components — no new design system.

- [ ] Manual check steps in commit message; commit `feat(s11): render preflight, diffs, budget delta, undo UI`

---

### Task 14: Staff saved-filters API

**Skills:** `senior-backend`, `api-designer`, `superpowers:test-driven-development`, `superpowers:using-git-worktrees`

**Files:**
- Create: `ads-agent/app/api/proposals/filters/route.ts` (+ test)
- Optional thin UI: dropdown on proposals page loading GET filters (skip elaborate UI if time — API is the E7 deliverable)

`guard("admin")` **and** platform/staff check used elsewhere (`is_platform_read` / existing admin pattern). Reject broker `operator` with 403/ForbiddenNotice pattern.

Body for POST: `{ name: string, query: { statuses?: string[]; kinds?: string[]; orgIds?: string[] } }`  
If `orgIds` present, require platform staff.

- [ ] TDD + commit `feat(s11): staff proposal saved filters API (E7)`

---

### Task 15: S11 gate verification

**Skills:** `senior-qa`, `adversarial-reviewer`, `superpowers:verification-before-completion`

**Files:** none required (may add `ads-agent/lib/decision-engine/s11-gate.test.ts` pure integration of E1–E4)

**Gate checklist (build sequence):**
1. For a fixture `budget_change` proposal, `runPreflight` returns structured checks array
2. `semanticDiff` returns before/after `dailyBudgetInr`
3. Approve route test proves schedule not execute
4. Claim helper returns due rows only when `undo_until <= now()`
5. Focused vitest suite for Tasks 1–12 green

```bash
cd ads-agent && npx vitest run \
  lib/decision-engine/strip-smuggle.test.ts \
  lib/decision-engine/broker-rationale.test.ts \
  lib/decision-engine/preflight.test.ts \
  lib/decision-engine/semantic-diff.test.ts \
  lib/decision-engine/budget-delta.test.ts \
  lib/decision-engine/bulk-decide.test.ts \
  lib/db/proposals-lifecycle.test.ts \
  lib/db/proposal-filters.test.ts \
  app/api/proposals \
  lib/executor/execute.test.ts \
  scripts/run-proposal-undo-worker.test.ts
```

- [ ] Record results in `.superpowers/sdd/s11-gate.md` on the feature branch
- [ ] Commit `test(s11): decision-engine extensions gate`

---

## Spec coverage self-check

| Spec item | Task |
|---|---|
| E1 broker copy | 2, 13 |
| E2 preflight structured | 3, 9, 13, 15 |
| E3 semantic diff | 4, 9, 13, 15 |
| E4 budget delta list | 5, 13 |
| E5 undo worker | 1, 6, 10, 12 |
| E6 bulk + per-item + bulk cancel | 7, 11 |
| E7 saved filters staff | 8, 14 |
| Gate: preflight + diffs render | 13, 15 |

## Placeholder scan

No TBD/TODO steps. Interfaces named for cross-task consumption. Migration numbers **107–109** only.

## Naming consistency

- DB: `scheduled_for`, `undo_until`, `batch_id`, `preflight`
- Status: `scheduled`, `executing`
- Helpers: `brokerRationale`, `runPreflight`, `semanticDiff`, `budgetDeltaInr`, `scheduleProposal`, `claimDueScheduledProposals`

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-13-s11-decision-engine-extensions.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — `superpowers:subagent-driven-development` + one worktree per parallel task in W2 (max 7, under 8 ceiling); review between merges
2. **Inline Execution** — `superpowers:executing-plans` in this session with wave checkpoints

**Which approach?**
