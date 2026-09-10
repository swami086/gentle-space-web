# Task 1 Report: Archive weak board

**Status:** DONE  
**Commits:** none (Figma-only)  
**File:** `bZ7LkDipySdYsNGH0YBtGu`  
**Page:** BrokerDesk Waitlist

## Summary

Renamed and moved the weak PSW product screens board (`116:2`) off the primary slot at ~x=4780, y=100. The board is still addressable under its original ID but now lives at the archive position (rightEdge + 400). The slot near x=4780, y=100 is clear for a fresh quality-rebuild board.

## Step 1: Switch page, rename, move

**Script:** Exact brief script (with extra read-only fields for QA).

| Field | Value |
|-------|-------|
| `archivedBoardId` | `116:2` |
| `name` | `Archive / PSW Product Screens v1 (weak)` |
| `x` | **7980** |
| `y` | **100** |
| `originalX` | 4780 |
| `originalY` | 100 |
| `rightEdge` (before move) | 7580 |
| `mutatedNodeIds` | `["116:2"]` |

Move formula: `board.x = rightEdge + 400` → 7580 + 400 = 7980. Confirmed.

Board dimensions unchanged: 2800 × 2200 (from prior scaffold task).

## Step 2: QA

### Screenshot

- Tool: `get_screenshot` on `116:2` (maxDimension 1024)
- Result: PNG captured (2800×2200 node, scaled to 1024×805)
- Visual: Dark archive board with 8 placeholder shimmer blocks (4 top, 1 large mid-left, 3 bottom) — consistent with pre-archive weak scaffold content

### Slot clearance

Read-only verification on BrokerDesk Waitlist page:

| Check | Result |
|-------|--------|
| Frames within ±50px of (4780, 100) | **none** |
| `slotCleared` | **true** |
| Archived node still reachable | yes — id `116:2`, name and position as above |

### Rename confirmation

Plugin API returned `name: "Archive / PSW Product Screens v1 (weak)"` after mutation. Screenshot metadata targets node `116:2` post-rename.

## Self-review vs brief

| Criterion | Pass? |
|-----------|-------|
| Load `figma-use` before `use_figma` | Yes |
| `skillNames: "figma-use"` on `use_figma` | Yes |
| `await figma.setCurrentPageAsync(...)` at script start | Yes |
| No `figma.closePlugin()`, no async IIFE | Yes |
| Return mutated node IDs | Yes (`116:2`) |
| Rename `116:2` → `Archive / PSW Product Screens v1 (weak)` | Yes |
| Move to `rightEdge + 400`, y=100 | Yes (7980, 100) |
| `get_screenshot` on archived board | Yes |
| Original slot free for new board ~4780,100 | Yes |
| Git commit | None (as required) |

**Verdict:** DONE. Slot cleared; archived board preserved and addressable.

## IDs for downstream tasks

```json
{
  "archivedBoardId": "116:2",
  "archivedName": "Archive / PSW Product Screens v1 (weak)",
  "archivedX": 7980,
  "archivedY": 100,
  "clearedSlot": { "x": 4780, "y": 100 },
  "slotCleared": true,
  "screenshotTaken": true
}
```
