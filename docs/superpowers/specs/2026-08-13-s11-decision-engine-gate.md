# S11 Gate

**Branch:** feat/s11-decision-engine  
**Date:** 2026-08-13  
**Vitest gate:** 19 files, **125 passed**

## Checklist (build sequence: preflight + diffs render)

1. `runPreflight` returns structured checks — covered by `preflight.test.ts` + approve 422 path
2. `semanticDiff` before/after `dailyBudgetInr` — `semantic-diff.test.ts`
3. Approve schedules (no sync execute) — `approve/route.test.ts`
4. Claim due only when `undo_until <= now()` — `proposals-lifecycle.test.ts`
5. Focused suite green — see command below

## Command

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
  lib/db/migrations/108_proposal_saved_filters.test.ts \
  lib/db/migrations/110_proposal_cross_tenant_claim.test.ts \
  app/api/proposals \
  lib/executor/execute.test.ts \
  scripts/run-proposal-undo-worker.test.ts
```

Result: 125/125 passed.

## Deferred / Important notes for final review

- Platform-scope approve may use wrong org for settings/credits (Task 9)
- Bulk approve skips preflight (brief-aligned; parity note)
- UI: disable Approve when preflight blocks; surface fetch errors (Task 13)
- Migrations 107–110 must be applied before worker in prod
