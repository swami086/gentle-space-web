# Ads Agent Agentic Desk — Implementation Plan

> **For agentic workers:** Steps are ordered. Spec is source of truth:  
> `docs/superpowers/specs/2026-09-20-ads-agent-agentic-desk-design.md`  
> **Do not start until that spec is Approved.** Status below tracks readiness only.

**Goal:** Replace dashboard-first + Copilot-FAB UX with Hybrid Agentic Desk (Mission Control inbox + Ask + Surfaces).

**Architecture:** Reuse proposals / Hermes / OpenUI / RBAC. Change shell IA and home page. No new agent runtime.

**Tech stack:** Next.js App Router (`ads-agent`), existing `SidebarNav`, `CopilotProvider`→Desk Ask, Vitest, Reticle.

**Spec status:** Approved C (2026-09-20). §13 defaults locked in spec.

---

## Phase 0 — Gate (human)

- [x] Spec approved (Alternative C)
- [x] §13 locked: `/` = Desk · Ask = slide-over ⌘J · glance ≤3 on Desk · autonomy deferred · label “Desk”
- [x] Explicit **go** to start Phase 1 (or override §13 first)

---

## Phase 1 — Desk data composition

### Task 1.1: Desk item mapper

**Files:**
- Create: `ads-agent/lib/desk/types.ts`
- Create: `ads-agent/lib/desk/list-desk-items.ts`
- Create: `ads-agent/lib/desk/list-desk-items.test.ts`
- Modify: reuse `lib/db` proposal list helpers (grep existing proposals queries)

**Steps:**
1. Define `DeskItem` type per spec §9.
2. Map pending proposals → `campaign_proposal` / `spend_change` kinds (use existing proposal fields).
3. Unit test: empty, one pending, resolved excluded.
4. Run: `npx vitest run lib/desk/list-desk-items.test.ts` (Node 22 PATH).

---

## Phase 2 — Desk UI shell

### Task 2.1: Replace home page with Desk

**Files:**
- Modify: `ads-agent/app/(admin)/page.tsx`
- Create: `ads-agent/components/desk/DeskPage.tsx` (client list/detail)
- Create: `ads-agent/components/desk/DeskList.tsx`
- Create: `ads-agent/components/desk/DeskDetail.tsx`
- Create: `ads-agent/components/desk/DeskGlance.tsx`

**Steps:**
1. Server page loads `listDeskItems` + ≤3 glance metrics.
2. Client list/detail with keyboard handlers (`j/k/a/r`).
3. Wire Approve/Reject to existing proposal routes (copy patterns from `proposals/[id]`).
4. Empty state per EC-2.
5. Manual: `/` shows inbox, not five-card hero.

### Task 2.2: Nav IA

**Files:**
- Modify: `ads-agent/components/SidebarNav.tsx` (and any nav config)
- Modify: `ads-agent/app/(admin)/layout.tsx`

**Steps:**
1. Labels: Desk · Ask · Campaigns · CRM · Reports · Admin.
2. Badge pending count on Desk.
3. Remove Copilot FAB from layout (Task 3.1 depends).

---

## Phase 3 — Ask consolidation

### Task 3.1: Promote Ask; retire FAB

**Files:**
- Modify: `ads-agent/components/copilot/CopilotPanel.tsx` → rename/adapt to `AskPanel` or keep and rebrand
- Modify: `ads-agent/components/copilot/CopilotFab.tsx` — delete usage
- Create: `ads-agent/components/desk/AskComposer.tsx` (persistent bottom or `/ask`)
- Modify: layout to mount Ask per approved §13 answer

**Steps:**
1. Composer always reachable (⌘J).
2. Seed context from selected Desk item (`proposalId`).
3. Hermes `origin: "desk"`.
4. Proposal creation from Ask appears on Desk after refresh/router.refresh.

### Task 3.2: Demote siloed assistants

**Files:**
- Modify: `CrmAssistantPanel.tsx`, `ReportsChat.tsx` — deep-link into Ask with origin, or thin wrappers
- Keep campaign draft chat on draft route (surface-specific OK)

**Steps:**
1. CRM page: “Ask about this opportunity” opens Ask with `opportunityId`.
2. Reports: same with `origin: reports`.
3. No second floating chat affordance.

---

## Phase 4 — Surfaces linkage

### Task 4.1: Deep links from Desk

**Files:**
- Modify: `DeskDetail.tsx`
- Possibly: CRM page query `?opportunity=`
- Campaign draft already has `/campaigns/drafts/[id]`

**Steps:**
1. “Open surface” CTA uses `hrefSurface`.
2. Reticle: approve then open campaigns draft.

---

## Phase 5 — Polish + verify

### Task 5.1: Taste + motion (skills)

1. Run Impeccable / `frontend-design` critique on Desk first viewport.
2. `improve-animations`: list→detail, approve success, Ask open (2–3 motions).
3. Do **not** introduce purple-glow AI chrome.

### Task 5.2: Reticle flows

**Files:**
- Drive with Reticle; save flows with intent:
  - “Operator clears a pending campaign proposal from Desk”
  - “Operator asks the desk about hot leads”
4. `reticle_verify` / gate on changed files.
5. Console error absent on `/`, Desk approve path.

### Task 5.3: Tests

- Update any home page tests expecting old dashboard copy.
- Add component test for keyboard approve if pure functions extracted.
- `dal` / proposal tests unchanged unless API shifts.

---

## Phase 6 — Docs + memory

- Update `openmemory.md` Components: Agentic Desk IA.
- Bump note in `ads-agent/.agents/product-marketing.md` only if nav labels need marketing sync.
- Store project_info memory: Desk is default home.

---

## Dependency graph

```
Phase 0 (approve)
  → 1.1 desk mapper
  → 2.1 Desk UI + 2.2 Nav
  → 3.1 Ask + 3.2 demote silos
  → 4.1 deep links
  → 5.x polish + Reticle
  → 6 docs
```

## Risk register

| Risk | Mitigation |
|------|------------|
| Proposals model missing kinds | Map what exists; stub `agent_blocker` as failed cycle only |
| Keyboard conflicts with browser | Scope to Desk container; ignore when input focused |
| Ask regression for CRM | Keep origin param; Reticle CRM ask flow |
| Scope creep into flow builder | Spec FR-19 — refuse |

## Definition of done

- Spec AC-1…AC-7 checked
- Copilot FAB gone
- `/` is Desk
- Reticle verdicts green for Desk approve + Ask
- No unsupervised spend path introduced

---

## Review checklist (human)

Before Phase 1:

1. Approve Alternative C?
2. Answer spec §13 (5 questions)?
3. Any must-keep dashboard metrics on Desk glance?
