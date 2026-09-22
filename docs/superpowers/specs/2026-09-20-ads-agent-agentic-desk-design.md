# Ads Agent — Agentic Desk UX Redesign

**Status:** Approved (Alternative C) — §13 defaults locked below; revise if needed before Phase 1  
**Date:** 2026-09-20  
**Author:** Agent (Cursor)  
**Reviewers:** Swami (approved C 2026-09-20)  
**Product surface:** `ads-agent/` (Broker OS proof / Agentic OS for CRE consultants)  
**Related:** `ads-agent/.agents/product-marketing.md` v12.1 · Approve gate · Hermes / OpenUI · Kanban agents  

---

## 1. Context

### Why this exists

`ads-agent` today is a **classic admin SaaS shell**: left nav (Home / Marketing / CRM / Reports / Admin), metric cards, boards, plus a **floating Copilot FAB** and **separate chat panels** (CRM assistant, Reports chat, campaign draft chat). That pattern is the “old AI SaaS world”: dashboards first, AI as a bolt-on sidecar.

Broker OS positioning already says the opposite:

- *The Agentic OS for real estate consultants.*
- *Draft ready. Waiting on your approval.*
- *Always on. Never unsupervised.*

The product already has the **backend shape** of an agentic system (decision cycle → proposals → approve gate → Hermes agents → Twenty / Google Ads tools). The **UI does not lead with that**. Operators still hunt through boards, then open chat, then find proposals.

### Evidence (this session)

| Source | Finding |
|--------|---------|
| Live Reticle audit | Home = stats wall; Copilot = FAB; CRM = board + side assistant; OpenUI Devtools auto-open on error |
| Product marketing | Approve gate is the brand promise; chat-sidecar contradicts “desk” metaphor |
| Mobbin flows | Top products either bury AI in a right tab (Intercom, Twenty) or go pure chat (Bard/ChatGPT) — both fail our brief |
| Industry pattern libs | [Hatchworks Agent UX](https://hatchworks.com/blog/ai-agents/agent-ux-patterns/) argues **chat-first fails in production**; need approvals, receipts, activity, rollback. [AI UX Playground — Human in the loop](https://aiuxplayground.com/patterns/human-in-the-loop) and [Smashing Magazine agentic UX](https://www.smashingmagazine.com/2026/02/designing-agentic-ai-practical-ux-patterns/) converge on **control / consent / repair** |

### Goal

Redesign ads-agent so the **default daily workflow is agentic**: agents propose work; the human **triages and approves**; deep boards are **surfaces** opened from work, not the home.

### Non-goals (this redesign)

- Replacing Hermes / Bifrost / Twenty / Google Ads backends
- Building a visual node flow editor (Lindy Flow editor) for v1
- Multi-tenant white-label theming
- Mobile-native app (web responsive only)

---

## 2. Problem statement

**Operators manage a practice by navigating product areas.** Agents are secondary.

What we need:

**Operators manage an approval desk and a command stream.** Agents continuously deposit work; humans approve spend/sends/stage changes; artifacts open into surfaces when needed.

---

## 3. Design alternatives considered

### A — Chat-primary workspace (ChatGPT / Sana / Otter)

- **Shape:** Full-width conversation; history sidebar; domain pages demoted.
- **Pros:** Familiar; one entry point.
- **Cons:** Industry consensus: chat-first fails for production agents (no durable queue, weak receipts, easy to lose actions in scroll). Conflicts with Approve gate as first-class object.
- **Verdict:** Reject as primary.

### B — Inbox-primary Mission Control (Linear Inbox + Zapier Central action cards)

- **Shape:** Home = triage list of agent proposals / tasks needing human action; detail pane = artifact + Approve / Reject / Ask; command bar secondary.
- **Pros:** Matches Approve gate; dense like Linear; action cards like [Zapier Central](https://mobbin.com/screens/cb65c41e-e7b6-4bd9-af40-cd92d768e90d); keyboard-speed triage.
- **Cons:** Weak for exploratory “ask about pipeline” without a command surface.
- **Verdict:** Strong core — incomplete alone.

### C — Hybrid Agentic Desk (**recommended**)

- **Shape:**
  1. **Desk (default `/`)** — Mission Control inbox of work awaiting the human.
  2. **Ask strip** — Persistent composer (not FAB) that opens a session stream with inline artifact cards.
  3. **Surfaces** — Campaigns / CRM / Reports / Settings remain routes, entered from inbox cards or rail, not as the emotional home.
- **Pros:** Aligns Broker OS “desk”; keeps approve-first; still supports conversational work; reuses existing proposals + Hermes + OpenUI.
- **Cons:** Requires IA change and consolidating chat silos.
- **Verdict:** **Choose C.**

### Explicit anti-patterns (do not ship)

| Anti-pattern | Mobbin / research example | Why reject |
|--------------|---------------------------|------------|
| AI as right-tab on dense board | [Intercom Copilot tab](https://mobbin.com/flows/343bba0d-7023-4c7c-94a8-667c685bd98e) | AI remains sidecar |
| Dashboard-first + AI sidebar | [Twenty AI dashboard builder](https://mobbin.com/flows/f63dd2ea-3900-4df5-966b-75cf66a3ca10) | Still spreadsheet-home |
| Template marketplace home | [Lindy agent directory](https://mobbin.com/flows/75ac7c4d-e2a9-4fd4-9487-342e7f5d83a8) | Discovery ≠ operations |
| Floating FAB chat | Current `CopilotFab` | Hides the product’s main job |
| Manual tool-chip selection | [Cohere USE TOOLS](https://mobbin.com/screens/3f39ea4e-2e5d-4de4-85c2-49f7146c020d) | Agents choose tools; humans approve outcomes |

---

## 4. Recommended experience — Agentic Desk

### 4.1 Information architecture

```
Desk (/)                    ← default. Approval inbox + glance metrics
Ask (/ask or overlay)       ← Hermes session stream + artifacts
Surfaces
  Campaigns (/campaigns)    ← board / drafts (opened from Desk cards)
  CRM (/crm)                ← pipeline (same)
  Reports (/reports)
Admin
  Users / Settings / Credits
```

**Nav rail (slim):** Desk · Ask · Campaigns · CRM · Reports · (Admin folder).  
**Remove as primary entry:** Floating Copilot FAB; separate CRM/Reports “assistant panels” as distinct products.

### 4.2 Desk (Mission Control) — primary flow

**Inspired by:** [Linear Inbox list→detail](https://mobbin.com/screens/8337813e-f0dd-4415-8a29-87c114b0442b) · Zapier “Action Complete” cards · Cofounder “what should I do next?” cards · brand chip *Draft ready. Waiting on your approval.*

**Layout (desktop):**

| Region | Role |
|--------|------|
| Left list (~360px) | Filterable queue: Needs approval · Running · Done today · Failed |
| Center detail | Selected work item: summary, why, evidence, risk, primary CTAs |
| Top glance strip | Compact: Active campaigns · Hot leads · Pending approvals count — **not** a five-card dashboard wall |
| Bottom Ask | Single composer: “Ask the desk…” (⌘J) — seeds Ask session with optional work-item context |

**Work item types (v1):**

| Kind | Source | Primary actions |
|------|--------|-----------------|
| `campaign_proposal` | Decision cycle / draft chat | Approve · Reject · Edit · Why |
| `spend_change` | Performance agent | Approve · Reject · Cap |
| `crm_stage` | Leads agent / assistant | Confirm stage · Undo |
| `outreach_send` | Calendar / WA / email (when gated) | Approve send · Edit · Hold |
| `agent_blocker` | Hermes task needs human input | Answer · Defer |

**Keyboard (Linear-grade):** `j/k` move · `Enter` open · `a` approve · `r` reject · `e` edit · `?` why · `⌘J` ask about this.

### 4.3 Ask — command + artifact stream

**Inspired by:** Zapier Central chat+activity · Lindy change-log + task cards · Sana “What would you like to do?” · **not** ChatGPT empty chat as home.

- One Hermes session API (`/api/hermes/chat`) with `origin: desk | campaigns | crm | reports`.
- Messages render OpenUI / structured cards **inline** (reuse `list_pending_proposals`, campaign SetupCard, OpportunityList).
- Tool/agent steps show as **receipts** (what ran, what changed, link to audit) — Hatchworks “receipts” pattern.
- High-impact tool results that create proposals **land in Desk inbox**, not only in chat scroll.

### 4.4 Surfaces (boards stay, role changes)

Campaigns board, CRM kanban, Reports stay for deep work. Changes:

- Entry from Desk card “Open in Campaigns” / “Open in CRM”.
- No independent floating assistants; Ask is global with origin context.
- Empty states point back to Desk (“Nothing to approve — run cycle or ask the desk”).

### 4.5 Visual direction (constraints)

Preserve Broker OS / ads-agent tokens; avoid generic “AI purple glow” and cream+terracotta clichés (user frontend rules). Motion: 2–3 purposeful transitions (list→detail, approve success, Ask open) — plan via Emil `improve-animations` in build phase. Typography/layout polish via Anthropic `frontend-design` + Impeccable critique **after** IA ships.

### 4.6 Trust & safety (non-negotiable)

Aligned with marketing *Always on. Never unsupervised.*:

1. **Spend / sends / irreversible CRM writes** MUST go through Desk approval (existing proposal model).
2. Every approved action MUST leave an **audit receipt** (existing `ai_action_log` / audit tables).
3. Ask MAY draft; MUST NOT silently publish ads or message clients.
4. Failed agent runs appear in Desk as `agent_blocker` / Failed filter — not only console errors.

---

## 5. Functional requirements

### MUST

| ID | Requirement |
|----|-------------|
| FR-1 | Default authenticated route `/` MUST be Desk (Mission Control), not the current stats dashboard. |
| FR-2 | Desk MUST list pending proposals and gated agent actions with count badge on nav. |
| FR-3 | Selecting a work item MUST show detail with Approve / Reject (role-gated) without navigating away. |
| FR-4 | Approve / Reject MUST use existing proposal APIs and RBAC (`requireRole` / `requireApiRole`). |
| FR-5 | Persistent Ask composer MUST replace Copilot FAB as the primary conversational entry. |
| FR-6 | Ask MUST reuse Hermes streaming + OpenUI Renderer; CRM/Reports/Copilot silos MUST consolidate behind one panel/route. |
| FR-7 | Creating a proposal from Ask or cycle MUST enqueue it on Desk. |
| FR-8 | Surfaces (Campaigns, CRM, Reports) MUST remain reachable; deep links from work items MUST open the right surface. |
| FR-9 | Keyboard shortcuts in §4.2 MUST work on Desk list/detail when focus is not in an input. |
| FR-10 | Glance strip MAY show ≤3 live metrics; MUST NOT restore the five-card dashboard as the hero. |

### SHOULD

| ID | Requirement |
|----|-------------|
| FR-11 | Desk SHOULD filter by kind / agent / urgency. |
| FR-12 | “Why” SHOULD open generative WhyPanel / evidence already built for proposals. |
| FR-13 | Ask SHOULD accept work-item context (`proposalId`, `opportunityId`, `campaignId`). |
| FR-14 | Running agent tasks SHOULD appear under Running with progress/heartbeat when available from Kanban/Hermes. |

### MAY

| ID | Requirement |
|----|-------------|
| FR-15 | Autonomy slider (auto-approve below ₹X) MAY appear in Settings — default off. |
| FR-16 | Multi-select bulk approve MAY ship after single-item path is proven. |

### MUST NOT

| ID | Requirement |
|----|-------------|
| FR-17 | MUST NOT auto-approve spend or outbound messaging without explicit setting + role. |
| FR-18 | MUST NOT keep Copilot FAB as the only discoverable chat entry. |
| FR-19 | MUST NOT make a visual agent flow-builder the v1 home. |

---

## 6. Non-functional requirements

| ID | Requirement |
|----|-------------|
| NFR-1 | Desk list initial paint with ≤50 pending items MUST complete in &lt; 500ms server time on local/staging (reuse existing list APIs). |
| NFR-2 | Approve action MUST be optimistic-UI safe: failure rolls back and shows toast; audit row only on success. |
| NFR-3 | WCAG 2.1 AA for Desk list/detail and Ask composer (focus order, names, contrast). |
| NFR-4 | Reticle: saved flows for Desk triage + Approve + Ask seed MUST exist before calling the redesign done. |
| NFR-5 | No new analytics vendor; PostHog events MAY be added for `desk_approve`, `desk_reject`, `ask_open` if already wired. |

---

## 7. Acceptance criteria

| AC | Given / When / Then | Traces |
|----|---------------------|--------|
| AC-1 | Given operator session, When open `/`, Then Desk inbox is visible and pending count matches proposals API. | FR-1, FR-2 |
| AC-2 | Given pending `campaign_proposal`, When press `a`, Then proposal approved and item leaves Needs approval. | FR-3, FR-4, FR-9 |
| AC-3 | Given Desk, When ⌘J and ask “what’s hot this week?”, Then Ask stream responds without opening a FAB. | FR-5, FR-6 |
| AC-4 | Given Ask creates a proposal, When return to Desk, Then new item appears in Needs approval. | FR-7 |
| AC-5 | Given CRM work item, When “Open in CRM”, Then `/crm` focuses that opportunity. | FR-8 |
| AC-6 | Given viewer role, When view Desk, Then Approve controls absent / forbidden. | FR-4 |
| AC-7 | Given Reticle crawl after ship, When drive Desk approve, Then `verified: yes` and console error absent. | NFR-4 |

---

## 8. Edge cases

| ID | Case | Behavior |
|----|------|----------|
| EC-1 | Twenty / Ads MCP down | Desk shows Failed/Blocked items with human-readable cause; no raw `fetch failed` as only signal |
| EC-2 | Empty inbox | Empty state: “Desk clear” + CTA Run cycle / Ask |
| EC-3 | Stale proposal (already decided in another tab) | Detail shows resolved state; actions disabled |
| EC-4 | Long-running cycle | Running section shows spinner + last heartbeat; don’t block inbox |
| EC-5 | AUTH_BYPASS local | Desk works; same RBAC ranks as admin |

---

## 9. API / data (v1 — prefer reuse)

No new domain tables required for MVP if proposals + audit cover work items.

| Need | Reuse |
|------|-------|
| Pending queue | Existing proposals list + status |
| Approve / reject | Existing `/proposals/[id]` actions |
| Ask | `/api/hermes/chat` + OpenUI tools |
| Why | Generative why routes already on proposals |
| Metrics glance | Subset of `getOverviewStats` / `fetchLeadSignal` |

**Later (out of v1 code, noted for plan):** unify `agent_blocker` from Hermes Kanban into a `desk_items` view if proposals alone are insufficient.

### API contracts (logical)

```ts
// Desk list — may be composed server-side from existing queries
type DeskItem = {
  id: string;
  kind: "campaign_proposal" | "spend_change" | "crm_stage" | "outreach_send" | "agent_blocker";
  title: string;
  summary: string;
  urgency: "now" | "today" | "later";
  agent?: string;
  createdAt: string;
  hrefSurface?: string; // e.g. /campaigns/drafts/...
  status: "needs_approval" | "running" | "done" | "failed";
};
```

---

## 10. Out of scope

- Coolify / multi-tenant Twenty provisioning UI
- Broker Field iOS parity
- Rewriting OpenUI component libraries
- Replacing Kanban orchestrator
- Marketing site Broker OS landing redesign (separate)

---

## 11. Mobbin reference board (cite in review)

| Intent | Link |
|--------|------|
| Inbox triage density | [Linear Inbox](https://mobbin.com/screens/8337813e-f0dd-4415-8a29-87c114b0442b) |
| Action receipt in stream | [Zapier Central](https://mobbin.com/screens/cb65c41e-e7b6-4bd9-af40-cd92d768e90d) |
| Next-action cards | [Cofounder flow](https://mobbin.com/flows/77b6175d-6779-44b4-a960-d2dce58fb64d) |
| Prompt-first (Ask only, not home) | [Lindy home](https://mobbin.com/flows/88f2f53a-11e1-4051-84f0-1b2ffa445815) |
| Avoid: AI as tab | [Intercom Copilot](https://mobbin.com/flows/343bba0d-7023-4c7c-94a8-667c685bd98e) |
| Avoid: dashboard + AI sidebar | [Twenty AI dashboard](https://mobbin.com/flows/f63dd2ea-3900-4df5-966b-75cf66a3ca10) |

---

## 12. Skills for implementation (post-approval)

| Phase | Skill (skill-picker) | Role |
|-------|----------------------|------|
| Contract | `spec-driven-workflow` | This doc; AC → tests |
| Build IA | `frontend-design` (anthropic-skills) | Layout / hierarchy |
| Taste | `impeccable` / `tastemaker` | Visual pass after IA |
| Motion | `improve-animations` (emil-skills) | Approve / Ask transitions |
| Verify | `reticle-skills` → `verify-ui-change` | Desk + Ask flows |
| Existing agents | Hermes / OpenUI patterns in-repo | No new chat stack |

---

## 13. Locked decisions (defaults after C approval)

| # | Question | Decision |
|---|----------|----------|
| 1 | Default route | **`/` = Desk** (no `/desk` alias in v1) |
| 2 | Ask placement | **Slide-over panel** always available (⌘J); no separate `/ask` route in v1 |
| 3 | Metrics | **Kill five-card dashboard hero**; ≤3 glance chips on Desk; deeper charts live under **Reports** |
| 4 | Autonomy | **Defer** auto-approve-under-₹N to post-v1 |
| 5 | Nav label | **Desk** (Broker OS wording) |

Change any row before Phase 1 if wrong.

---

## 14. Approval

- [x] Product / founder accepts Alternative **C** (Hybrid Agentic Desk) — 2026-09-20
- [x] §13 locked with defaults above (override before coding if needed)
- [x] Implement per companion plan `docs/superpowers/plans/2026-09-20-ads-agent-agentic-desk.md`

**Implementation may start once human says go (or overrides §13).**
