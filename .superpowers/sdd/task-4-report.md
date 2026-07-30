# Task 4 Report: DB helpers for entity cache

## What was implemented

Added the three listing DB helpers requested by the brief in `lib/db/listings.ts`:

- `listListingEntityHashes()` reads `id` and `entities_hash` for visible listings.
- `updateListingExtractedEntities()` writes `extracted_entities` as JSONB and stores the caller-supplied `entitiesHash`.
- `listListingExtractedEntities()` reads visible rows with cached entities and normalizes them through `parseExtractedEntities()`.

Added `lib/db/listings-entities.test.ts` to pin the SQL, parameter order, and JSONB parsing behavior with the same `vi.mock("./client")` pattern used by the existing listings tests.

## TDD Evidence

### RED

Before implementation, the new suite failed immediately because the exports did not exist yet:

```text
TypeError: listListingEntityHashes is not a function
TypeError: updateListingExtractedEntities is not a function
TypeError: listListingExtractedEntities is not a function
```

### GREEN

After implementing the helpers, the focused suite passed:

```text
npx vitest run lib/db/listings-entities.test.ts
Test Files  1 passed (1)
Tests       5 passed (5)
```

I also ran the related listings db tests together:

```text
npx vitest run lib/db/listings-search.test.ts lib/db/listings-sync.test.ts lib/db/listings-entities.test.ts
Test Files  3 passed (3)
Tests       14 passed (14)
```

## Files changed

| File | Change |
|------|--------|
| `lib/db/listings.ts` | Added entity-cache read/write helpers |
| `lib/db/listings-entities.test.ts` | Added focused helper coverage |

## Notes

- I left the unrelated uncommitted files untouched, including `lib/graph/age.ts`, `lib/graph/age.test.ts`, `lib/graph/rebuild.ts`, `lib/vertex/client.ts`, and `openmemory.md`, per your instruction.
- I also stored a project memory for the new db helper pattern, but did not modify `openmemory.md` because it was explicitly out of scope.
