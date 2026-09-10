# Broker OS Problem Slide Approach A Implementation Plan

> **For agentic workers:** Implement task-by-task. Steps use checkbox syntax.

**Goal:** Rebuild Figma Problem `215:39` so diagrams and captions prove the locked headline “Your practice runs on broken, siloed workflows.”

**Architecture:** Mutate existing chaos frames under `215:39` (copy + inner UI text). Keep 2×2 layout; restack after height changes. Sync Brief / product-marketing Problem lines.

**Tech Stack:** Figma Plugin API (`use_figma`), expert-pmm-writer checker, docs in repo.

## Global Constraints

- Headline must remain exactly: `Your practice runs on broken, siloed workflows.`
- Pillar order: Inventory → Campaigns → Spend → Calendar
- No invented stats, no competitor names, no em/en dashes in copy
- `check_ai_signs.py` exit 0 before ship
- Spec: `docs/superpowers/specs/2026-09-06-broker-os-problem-siloed-workflows-design.md`

## File map

| Target | Responsibility |
|--------|----------------|
| Figma `215:39` subtree | Diagrams + captions |
| `docs/Brief.md` §10 | Problem pain lines |
| `ads-agent/.agents/product-marketing.md` §3 / §11 | Problem messaging |
| Spec status line | Mark approved / shipped |

---

### Task 1: Ship section copy

- [ ] Set sub + four titles + four bodies per spec §6
- [ ] Leave headline unchanged; verify string
- [ ] Run `check_ai_signs.py` on shipped strings

### Task 2: Rebuild P1 Inventory diagram

- [ ] Retheme mail list → folder/Drive listing files + stale dates
- [ ] WA bubble → listing notes (“photos in Drive?”)
- [ ] Toast → `Not on desk` / listing orphan cue
- [ ] Rename frame to `P1 Chaos / Inventory silo`

### Task 3: Rebuild P2 Campaigns diagram

- [ ] Ads Manager empty / create campaign + `No listing brief linked`
- [ ] Rename to `P2 Chaos / Campaigns silo`

### Task 4: Rebuild P3 Spend diagram

- [ ] SPEND / ENQUIRIES populated; ATTRIBUTION `Unknown`
- [ ] Footer or table row shows no handoff to desk
- [ ] Rename to `P3 Chaos / Spend silo`

### Task 5: Rebuild P4 Calendar diagram

- [ ] Replace WA thread content with packed calendar / pushed relationship time
- [ ] Rename to `P4 Chaos / Calendar silo`

### Task 6: Restack + verify

- [ ] Restack label → headline → sub → cards; no overlaps
- [ ] Accept criteria checklist from spec §7

### Task 7: Docs sync

- [ ] Update Brief §10 Problem pains to match shipped copy
- [ ] Update product-marketing Problem section
- [ ] Mark design spec Status: Shipped
