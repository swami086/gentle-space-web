# RP-W1 — Autonomy rollout across ad action kinds

Date: 2026-08-13  
Status: approved  
Program: [`2026-08-13-rp-program-design.md`](2026-08-13-rp-program-design.md)  
Depends on: W0 (`lib/autonomy/`, `lib/channels/`)  
Migration range: **130–139**  
Owned paths: `ads-agent/lib/decision-engine/`, `ads-agent/app/(admin)/proposals/`, `ads-agent/app/api/proposals/`

## Problem

W0 ships the autonomy engine but nothing calls it. The decision engine still routes every proposal to `pending` and waits for a click. Ryze parity requires always-on management: budget shifts, pausing losers, scaling winners and cross-channel reallocation happening around the clock, with humans supervising rather than clicking.

## Goals

1. Route every ad-side proposal through `evaluateAutonomy()`, executing the `auto` path without human interaction.
2. Define the action-kind taxonomy for ad operations and seed sensible default guardrails per kind.
3. Add cross-channel budget reallocation, which today has no rule at all.
4. Give operators a supervision surface: an activity feed of auto-executed changes with one-click undo inside the window.
5. **Close the pre-existing GC1 violation in `mcp/google-ads-server`.** That server registers `create_campaign`, `pause_campaign`, `update_campaign_budget` and `add_negative_keyword`, each calling the connector in-process with no proposal, no autonomy evaluation and no `ai_action_log` entry. Its comment claims `propose_change` is the only reachable write path, but that holds only by network placement and Hermes configuration — the server has no token auth, and the per-profile allowlists in `lib/agent/profiles.ts` gate the context-server task token, not this one. Route all four through `proposeChange` (so they create proposals) or remove them. This is a task in this workstream, not a wave-2 cleanup.

## Non-goals

- CMS, SEO or creative action kinds (W3/W5/W6/W7 register their own).
- New channels (W2).
- Changing `preflight`, `semantic-diff` or `budget-delta` semantics — they run identically on both paths.

## Action-kind taxonomy

Registered by this workstream, each mapping to a `ChannelAdapter` capability:

| Action kind | Default `required_streak` | Default guardrails | Rationale |
|---|---|---|---|
| `campaign.budget_update` | 10 | ±20%, ≤₹5,000, ≤5/day | Reversible, bounded, highest-frequency |
| `campaign.pause` | 8 | ≤3/day | Reversible; stops spend, low downside |
| `campaign.resume` | 12 | ≤3/day | Starts spend — stricter than pause |
| `keyword.add_negative` | 6 | ≤20/day | Reversible, reduces waste, lowest risk |
| `adgroup.bid_update` | 10 | ±20%, ≤5/day | Bounded |
| `budget.reallocate_cross_channel` | 15 | ≤10% of monthly budget/day, ≤2/day | Touches two channels; highest blast radius |
| `campaign.create` | never (opt-in only, stays gated) | — | Irreversible spend commitment; matches the 2026-08-03 design's first-campaign gate |

`campaign.create` has `human_opt_in` default `false` and no streak that promotes it; an operator may promote it explicitly, but the seed keeps it gated.

## Architecture

```text
cycle.ts (existing)
   │ rules fire → proposal payload
   ▼
preflight (existing) ──► semantic-diff + budget-delta (existing)
   ▼
autonomy.evaluateAutonomy()
   ├─ gate  → proposals.status='pending'      (existing UI path, unchanged)
   ├─ auto  → proposals.status='auto_executed' → executor (immediate)
   └─ block → proposals.status='blocked'
   ▼
executor: re-evaluate → adapter.execute({ idempotencyKey: proposalId })
   ▼
undo window timer → on expiry: autonomy.recordOutcome('clean')
   on operator undo: rollback + recordOutcome('reverted')
```

The undo path reuses S11's existing scheduled/undo worker (`scripts/run-proposal-undo-worker.ts`); this workstream extends it to call `recordOutcome`.

## Cross-channel budget reallocation

New rule in `lib/decision-engine/rules.ts`: `proposeCrossChannelReallocation`. It reads per-channel cost-per-qualified-lead (Hot/Warm from CRM, per GC2's `objective`) over a trailing window, and when one channel's CPQL is materially better and both channels have ≥ the minimum sample, it proposes moving a bounded slice of daily budget from the worse to the better channel. It emits a **single** proposal containing both legs so approval and undo are atomic; the executor applies the decrement before the increment so a mid-sequence failure cannot overspend.

## Supervision surface

`app/(admin)/proposals/` gains an **Activity** tab: reverse-chronological auto-executed actions with kind, channel, before → after, autonomy reasons, remaining undo seconds, and an Undo button. The existing Pending/Scheduled tabs are untouched. A per-kind streak indicator links to the W0 autonomy settings page.

## Data model (migration 130)

`proposals` gains `undo_deadline_at timestamptz` (nullable) and `reverted_at timestamptz` (nullable), both indexed on `(org_id, undo_deadline_at)` for the worker's scan. No new tables.

## Interfaces

**Consumes (W0):** `evaluateAutonomy`, `getPolicy`, `recordOutcome`, `getAdapter`, `getTenantConfig`.

**Produces:**

```ts
export const AD_ACTION_KINDS: readonly string[];              // lib/decision-engine/action-kinds.ts
export function proposeCrossChannelReallocation(input: RuleInput): ProposalPayload[];
export function undoProposal(orgId: string, proposalId: string): Promise<{ reverted: boolean }>;
```

## Error handling

An `auto` execution that fails with a `transient` error retries through the outbox and does not touch the streak. A `quota` error suspends that `(org, channel)` until `retryAfterMs` elapses and likewise leaves the streak untouched — quota exhaustion says nothing about whether the decision was correct. A `policy` or `validation` failure marks the proposal failed and calls `recordOutcome('rejected')`, demoting the kind — a platform rejecting our write is evidence the policy was too loose. An `auth` failure halts that tenant's channel and pauses every action kind for it.

## Testing

- `rules.test.ts` — reallocation fires only above the sample and margin thresholds; emits one two-leg proposal; never exceeds the daily cap.
- `autonomy-routing.test.ts` — each action kind routes to the expected decision given a policy fixture; `campaign.create` never returns `auto` from seed defaults.
- `undo.db.test.ts` — undo inside the window reverts and demotes; after expiry it is refused and the streak increments.
- `w1-gate.test.ts` — an end-to-end auto path (rule → autonomy → adapter stub → outbox → action log) produces a ledger row identical in shape to the gated path (GC4), and the execute-time re-check aborts when a guardrail degrades between proposal and execution.
