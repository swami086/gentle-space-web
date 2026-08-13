# Task 1 Report — Proposal undo lifecycle

**Branch:** `feat/s11-decision-engine`  
**Worktree:** `.worktrees/s11-decision-engine`  
**Status:** ✅ Complete

## Summary

Implemented the Task 1 foundation for proposal undo lifecycle. `adsagent.proposals` now has the new lifecycle columns and widened status CHECK in migration 107, `ProposalStatus` / `Proposal` / `ProposalRow` now expose the scheduled undo fields, and `stripSmuggle()` strips zero-width, tag-block, and other Unicode format characters at display boundaries.

No schedule/cancel/claim behavior was added, and approve/execute flows were left untouched per brief.

## Files

| Action | Path |
|--------|------|
| Create | `ads-agent/lib/db/migrations/107_proposal_undo_lifecycle.up.sql` |
| Create | `ads-agent/lib/db/migrations/107_proposal_undo_lifecycle.down.sql` |
| Create | `ads-agent/lib/decision-engine/strip-smuggle.ts` |
| Create | `ads-agent/lib/decision-engine/strip-smuggle.test.ts` |
| Modify | `ads-agent/lib/types.ts` |
| Modify | `ads-agent/lib/db/proposals.ts` |

## Test results

```bash
npx vitest run lib/decision-engine/strip-smuggle.test.ts
```

Result: 1 file passed, 2 tests passed.

`npx tsc -p tsconfig.json --noEmit` was attempted for a broader safety check, but it failed on pre-existing unrelated type errors outside this task's files.

## Concerns

None for this task scope. The only open issue is the unrelated repo-wide typecheck noise, which predates this change.

## Notes

`openmemory.md` was updated with the new proposal lifecycle contract and `stripSmuggle` helper entry.
