# Task 13 Report — List + detail UI (delta, preflight, diff, undo)

**Status:** Complete  
**Branch:** `feat/s11-t13`

## Delivered

- **List page** (`proposals/page.tsx`): Added **Scheduled** status tab; **Budget Δ** column via `budgetDeltaInr` + campaign join in `listProposals`.
- **Detail page** (`proposals/[id]/page.tsx`): Server-side `runPreflight`, `semanticDiff`, `brokerRationale` for pending/scheduled; undo banner when `scheduled` + active window.
- **PreflightPanel.tsx**: Structured check list with pass/block/warn icons.
- **DiffTable.tsx**: Before/after field table from `semanticDiff`.
- **ProposalActions.tsx**: Approve/reject for pending; **Cancel** + live countdown when `scheduled` and `undoUntil > now`.
- **proposals.ts**: `listProposals` LEFT JOIN campaigns for `currentDailyBudgetInr`; exported `ProposalListItem`.

## Tests

- `npx vitest run lib/db/proposals.test.ts` — PASS (updated SQL expectations for join + alias).
- `npx vitest run lib/decision-engine/budget-delta.test.ts` — PASS.

## Manual checks

1. Open `/proposals?status=pending` — Budget Δ column shows `—` or signed INR.
2. Open a pending proposal detail — **Changes** (DiffTable) + **Pre-flight checks** (PreflightPanel) render; Approve/Reject visible.
3. Approve a proposal → lands on scheduled tab; detail shows undo banner + Cancel with countdown.
4. Cancel within window → returns to pending; countdown disappears.

## Concerns

- Preflight on detail re-fetches org settings/credits each render (matches approve route pattern; no caching).
- Undo countdown uses client `setInterval`; server-rendered banner seconds may drift 1s until refresh.

## Commit

`feat(s11): render preflight, diffs, budget delta, undo UI`
