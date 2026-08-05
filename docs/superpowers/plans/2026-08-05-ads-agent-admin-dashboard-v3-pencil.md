# ads-agent admin dashboard v3 — Pencil "AI Command Center" redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: This plan is organized into **waves** for parallel
> execution (up to 8 subagents at once), the same deliberate deviation from
> `superpowers:subagent-driven-development`'s default "never dispatch implementers in parallel" rule
> already used in this repo's
> [`2026-08-03-ads-agent-admin-dashboard.md`](2026-08-03-ads-agent-admin-dashboard.md),
> [`2026-08-04-ads-agent-admin-dashboard-v2.md`](2026-08-04-ads-agent-admin-dashboard-v2.md), and
> [`2026-08-05-openui-platform-foundation.md`](2026-08-05-openui-platform-foundation.md) — safe here
> because every task within a wave owns a disjoint set of files (see each wave's file-ownership note).
> Use `superpowers:dispatching-parallel-agents` to dispatch all tasks in a wave together (multiple Task
> tool calls in the same message = parallel). Every task carries a real Vitest test cycle — follow
> `superpowers:test-driven-development`. Run the task-reviewer gate (spec compliance + code quality) on
> every task as it completes; do **not** dispatch the next wave until every task in the current wave has
> passed review — later waves import files earlier waves create. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ship the Pencil-concept redesign across all five admin screens (Home, Marketing Automation,
Leads & CRM, Reports, Settings & Users) per
[`docs/superpowers/specs/2026-08-05-ads-agent-admin-dashboard-v3-pencil-design.md`](../specs/2026-08-05-ads-agent-admin-dashboard-v3-pencil-design.md):
a fixed dark Pencil theme, a shared `components/pencil/*` UI kit, a real persistent Kanban board for
both Marketing Automation and Leads & CRM (the latter backed by genuinely new Twenty CRM read/write
calls), Spec 2's Reports chat surface, and Spec 3's CRM chat surface — both previously
approved-but-unbuilt.

**Architecture:** Design tokens land first (`app/globals.css`), then a design-system-first wave builds
`components/pencil/*` (KanbanBoard/Column/Card with Framer Motion drag-reorder, SideAssistantPanel,
StatusPill, TabStrip) plus the two new OpenUI domain files (`crm-library.ts`/`crm-tools.ts`,
`analytics-library.ts`/`analytics-tools.ts`) in parallel with a new `lib/crm/twenty-pipeline.ts` (the
real, new Twenty REST calls) and a small `lib/db/ai-action-log.ts`. A composition wave then wires the
two new domain libraries into `platform-library.ts`/`platform-tools.ts` while five page tasks build
Home, Marketing Automation, Leads & CRM, Reports, and Settings/Users in parallel against the finished
kit. A final solo wave verifies the whole thing end to end.

**Tech Stack:** Next.js 15.5.21, React 19, TypeScript, Tailwind v4, Vitest, Zod v4,
`@openuidev/lang-core` `^0.2.10`, `@openuidev/react-lang` `^0.2.9`, `recharts` `^3.10.1` (already
installed) — **one new dependency: `framer-motion`** (installed in Task 6).

## Global Constraints

- **Codebase-verification correction (binding on every task below, supersedes the design spec's
  guessed CRM columns):** the Leads & CRM board's columns are the **real, configured Twenty pipeline
  stages** from `infra/twenty/README.md` — `NEW_BRIEF` ("New Brief"), `SHORTLIST` ("Shortlist"),
  `TOUR` ("Tour"), `NEGOTIATE` ("Negotiate"), `LEGAL` ("Legal"), `HANDOVER` ("Handover"), `RENEWAL`
  ("Renewal") — **seven columns, not the mock's guessed four** ("New Brief/Qualified/Proposal/Won").
  No task below invents or renames these values; `PIPELINE_STAGES` in Task 3 is the single source of
  truth every later task imports.
- **No new "MetricCard"/generic stat component.** `lib/openui/shared-metric-cards.ts`'s
  `StatCardView`/`KpiGridView` (shipped in the foundation plan) already render exactly Home's stat-card
  shape (label, value, delta+direction) via a direct, non-model call. Task 12 (Home) imports and calls
  `StatCardView` directly — building a second identical-shape component would violate the foundation
  spec's "components render, callers format" convention and this repo's own DRY/YAGNI norms.
  Verified via Torbit: no such duplicate component exists anywhere else in `ads-agent/`.
- **`CampaignStatus` has no `"draft"` value** (`ads-agent/lib/types.ts`: `"proposed" | "active" |
  "paused" | "removed"`). The Marketing Automation board's "Draft" column is a **display label only**
  over the existing `"proposed"` DB value — no schema change, no new enum value, anywhere in this plan.
- **No existing phone-masking utility anywhere in the codebase** (verified via Torbit + Grep across
  both `lib/` and `ads-agent/`). `maskPhone()` in Task 3 is new, small logic — not a reuse of prior art,
  despite the design spec's original phrasing suggesting one might exist.
- **No content extraction for Proposals/Credits.** The design spec's "tab" language means a small
  `TabStrip` component (Task 8) that navigates between real, already-existing sibling routes
  (`/campaigns` ↔ `/proposals`, `/settings` ↔ `/credits`) — it does **not** move Proposals' or Credits'
  page content into another file. `/proposals/[id]`, `AllocateCreditsForm.tsx`, `UsagePoller.tsx`, and
  `SettingsForm.tsx` are untouched by every task in this plan.
- **`/users` stays a top-level Admin nav item**, unchanged structurally — restyled tokens only. The
  mock's Notifications/Integrations/API Keys/Access & Roles rows inside "Workspace Settings" are **not
  built** — no task below adds non-functional nav rows for them (would violate "No Placeholders").
- **Twenty REST semantics assumption (flag for manual verification, not silently trusted):** Task 3
  assumes Twenty's REST API supports `GET /rest/opportunities/:id` and `PATCH /rest/opportunities/:id`
  following the same shape `lib/crm/twenty.ts`'s existing `POST /rest/opportunities` already uses
  (`{ data: { <entityName>: {...} } }` envelope, `extractId`-style unwrapping). This is standard Twenty
  REST behavior but **no PATCH/GET-by-id call exists yet anywhere in this repo to copy verbatim** — Task
  3's implementer must confirm the exact response envelope against the running local Twenty instance
  (`infra/twenty/`) during its manual-verification step, and adjust the thin unwrap helper if the shape
  differs. The rest of this plan (board, tools, routes) depends only on `twenty-pipeline.ts`'s exported
  function signatures, not on Twenty's raw wire format, so a shape correction there does not ripple.
- **`ai_action_log` is scoped to the two real automated-action sites that exist or are being built in
  this plan** — `runDecisionCycle()` creating proposals (Task 4, marketing domain) and the CRM
  Assistant's advance-stage tool (Task 9, crm domain). No task fabricates a marketing "AI paused a
  campaign" autonomous-execution event — no such autonomous execution exists in this codebase today
  (the decision engine creates proposals; a human approves/executes them via `ProposalActions.tsx`,
  unchanged by this plan).
- **No new dependencies except `framer-motion`** (Task 6). Every other file imports only already
  installed packages (confirmed via `ads-agent/package.json`): `recharts`, `lucide-react`,
  `@openuidev/lang-core`, `@openuidev/react-lang`, `zod`, `react`, `next`.
- **`lib/openui/*` files stay framework-light** — no `lucide-react`, no `components/ui/*` shadcn
  imports, no `"use client"` — the established convention from `campaign-library.ts`/
  `shared-metric-cards.ts`. `crm-library.ts`/`analytics-library.ts` (Tasks 9-10) follow it exactly.
- **Zod schemas on OpenUI component props use `.optional().default(...)`, never `.nullable()`** — same
  binding rule as the foundation plan, restated because Tasks 9-10 define new component schemas.
- **No test-rendering library.** Every new component test calls the view function directly and asserts
  on the returned React element tree, matching `campaign-library.test.ts`/`shared-metric-cards.test.ts` —
  no `@testing-library/react` anywhere in this plan.
- **Schema changes go in `ads-agent/lib/db/schema.sql`** (idempotent `CREATE TABLE IF NOT EXISTS`,
  applied whole-file by `migrate()` per `lib/db/migrate.ts`) — there is no separate migration-file
  system in this repo. Task 4 appends one new table.
- **RBAC:** every new API route (`/api/campaigns/[id]/status`, `/api/crm/opportunities/[id]/stage`,
  `/api/crm/chat`, `/api/reports/chat`) uses `requireApiRole("operator")`, the same minimum tier as
  Campaigns/Proposals/Reports/the existing Copilot route — via `ads-agent/lib/auth/dal.ts`, unchanged.
- **This repo's Next.js has breaking changes vs. training-data conventions (per `AGENTS.md`).** Route
  handlers with a `[id]` dynamic segment (Tasks 13-14) must be checked against
  `node_modules/next/dist/docs/` for this installed version's params-handling convention (Next 15's
  `params` is a `Promise` in route handlers) before assuming an older synchronous-`params` API.
- **Follow this repo's existing conventions exactly:** colocated `*.test.ts`/`*.test.tsx`; `@/*` path
  alias; Vitest (`describe`/`it`/`expect`, `vi.mock`/`vi.hoisted` for named-export mocking, matching
  `dashboard.test.ts`/`cycle.test.ts` precedent).

---

## Parallelization Plan

```text
Wave 1 (4 parallel)  Task 1 — app/globals.css (Pencil dark tokens)
                     Task 2 — lib/nav-config.ts restructure + test
                     Task 3 — lib/crm/twenty-pipeline.ts (list/get/update-stage/pipeline-value/maskPhone)
                     Task 4 — lib/db/ai-action-log.ts + schema.sql table + cycle.ts wiring
                        ↓ (all 4 must pass review first)
Wave 2 (6 parallel)  Task 5  — components/pencil/StatusPill.tsx
                     Task 6  — components/pencil/{KanbanCard,KanbanColumn,KanbanBoard}.tsx
                                (installs framer-motion)
                     Task 7  — components/pencil/SideAssistantPanel.tsx
                     Task 8  — components/pencil/TabStrip.tsx
                     Task 9  — lib/openui/{crm-library,crm-tools}.ts (depends on Task 3, Task 4)
                     Task 10 — lib/openui/{analytics-library,analytics-tools}.ts
                        ↓ (all 6 must pass review first)
Wave 3 (6 parallel)  Task 11 — platform-library.ts / platform-tools.ts composition update
                                (depends on Tasks 9, 10)
                     Task 12 — Home page (depends on Tasks 3, 4; direct StatCardView calls)
                     Task 13 — Marketing Automation page + status route + TabStrip wiring
                                (depends on Tasks 6, 8)
                     Task 14 — Leads & CRM page + stage route + CRM chat route
                                (depends on Tasks 3, 6, 7, 9)
                     Task 15 — Reports page + analytics chat route (depends on Task 10)
                     Task 16 — Settings & Users TabStrip wiring (depends on Task 8)
                        ↓ (all 6 must pass review first)
Wave 4 (solo)        Task 17 — Full build/lint/test + manual verification pass
```

Real max concurrency is 6 (Waves 2 and 3), inside the ≤8 ceiling. Wave 1's four tasks touch four
disjoint files with zero interdependencies (tokens, nav data, a new backend module, a new small
table+lib). Wave 2 depends only on Wave 1 landing; its six tasks are disjoint files (three pencil
components, one dual-purpose pencil file, and two backend-only `lib/openui/*` pairs). Wave 3's six page
tasks each touch a disjoint page directory and depend only on specific named Wave 1/2 outputs (stated
in each task's **Interfaces** block) — no Wave 3 task depends on another Wave 3 task's *output*, only on
Wave 1/2 outputs, so all six are safe in parallel even though Task 11 (composition) and Tasks 14/15
(the pages that benefit from that composition being current) land in the same wave: Tasks 14/15 import
`crmLibrary`/`analyticsLibrary` directly from Tasks 9/10 for their own embedded chats (per the
foundation spec's established pattern — embedded per-page chats use their own domain-only library, not
the composed `platform-library.ts`), so they don't actually need Task 11's output to function; Task 11
only affects the *global Copilot's* cross-domain reach, verified independently in Task 17.

**Skills:** every task below reads and follows `~/.cursor/skills/senior-frontend/SKILL.md` (React/
Next.js/TypeScript/Tailwind, accessibility) — every task touches TypeScript and most touch React. Tasks
defining new Zod-schema'd OpenUI components (9, 10) additionally follow
`~/.cursor/skills/api-designer/SKILL.md` for prop-shape/schema discipline, matching the foundation
plan's own reasoning for its component tasks. Tasks with real interaction-design stakes (`KanbanBoard`'s
drag affordance, `SideAssistantPanel`'s chat surface, the two Kanban page tasks' card content density)
additionally follow `~/.cursor/skills/ui-ux-design-expert/SKILL.md` (Nielsen heuristics — visibility of
system status during drag/streaming, user control to undo a failed drag, recognition over recall for
column semantics). Task 1 (tokens) and Task 6 (Kanban family, the widest-reused visual surface)
additionally follow `~/.cursor/skills/ui-design-system/SKILL.md` for token/consistency discipline,
mirroring the v2 dashboard plan's own reasoning for its Card-removal tasks. Tasks 3, 4, 9, 13, 14, 15
(server-side data/streaming/route work) additionally follow `~/.cursor/skills/senior-backend/SKILL.md`.
`image-to-code` and `design-taste-frontend` are excluded for the same reason the v2 and foundation plans
already excluded them: both are scoped to image-first hero/landing-page generation, not an existing
admin dashboard's token/component extension.

**Codebase-context tooling note:** every task below was scoped using `torbit` (SQL queries against
`gl_definition`) to enumerate real files/symbols, plus two direct file reads
(`infra/twenty/README.md`, `ads-agent/lib/types.ts`) that caught real corrections to the design spec's
assumptions (the 7 real pipeline stages; no `"draft"` enum value) that no amount of grepping symbol
names alone would have surfaced. Implementer subagents should prefer the same order: `torbit` first for
symbols/definitions, a targeted direct read for anything schema/config-shaped, `Grep` only to confirm a
symbol's absence.

---

### Task 1: `app/globals.css` — Pencil dark tokens

**Files:**
- Modify: `ads-agent/app/globals.css`

**Interfaces:**
- Consumes: nothing.
- Produces: CSS custom properties (`--background`, `--surface`, `--surface-raised`, `--border`,
  `--foreground`, `--muted-foreground`, `--accent`, `--accent-2`, `--live`, `--status-hot`,
  `--status-warm`, `--status-cold`, `--status-unscored`, `--status-positive`) and their `@theme inline`
  Tailwind utility bindings (`bg-surface`, `text-status-hot`, etc.) — every later visual task (5-8,
  12-16) consumes these utility classes.

This file has no independent test (pure CSS) — verified visually in Task 17's manual pass, matching how
the v2 dashboard plan's own token changes were verified.

- [ ] **Step 1: Replace the `:root`/`prefers-color-scheme` block with fixed dark tokens**

```css
@import "tailwindcss";

:root {
  color-scheme: dark;
  --radius: 0.625rem;
  --background: #0a0a0a;
  --surface: #141417;
  --surface-raised: #1a1a1e;
  --border: #26262b;
  --foreground: #f5f5f7;
  --muted-foreground: #8a8a93;
  --accent: #7c5cff;
  --accent-2: #bf40ff;
  --live: #00f2ff;
  --status-hot: #ef4444;
  --status-warm: #f97316;
  --status-cold: #38bdf8;
  --status-unscored: #6b6b72;
  --status-positive: #22c55e;
  /* Existing shadcn-primitive tokens, remapped onto the new palette so every component built
     against bg-card/bg-primary/etc. (Badge, Button, Card, Table, CommandPalette, UserMenu) picks
     up the Pencil theme with zero changes to those files. */
  --card: var(--surface);
  --card-foreground: var(--foreground);
  --primary: var(--accent);
  --primary-foreground: #ffffff;
  --secondary: var(--surface-raised);
  --secondary-foreground: var(--foreground);
  --muted: var(--surface-raised);
  --accent-ui: var(--surface-raised);
  --accent-ui-foreground: var(--foreground);
  --destructive: var(--status-hot);
  --destructive-foreground: #ffffff;
  --input: var(--border);
  --ring: var(--accent);
}

@theme inline {
  --radius-sm: calc(var(--radius) - 4px);
  --radius-md: calc(var(--radius) - 2px);
  --radius-lg: var(--radius);
  --radius-xl: calc(var(--radius) + 4px);
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-surface: var(--surface);
  --color-surface-raised: var(--surface-raised);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent-ui);
  --color-accent-foreground: var(--accent-ui-foreground);
  --color-accent-2: var(--accent-2);
  --color-live: var(--live);
  --color-destructive: var(--destructive);
  --color-destructive-foreground: var(--destructive-foreground);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  --color-status-hot: var(--status-hot);
  --color-status-warm: var(--status-warm);
  --color-status-cold: var(--status-cold);
  --color-status-unscored: var(--status-unscored);
  --color-status-positive: var(--status-positive);
}

@layer base {
  * {
    border-color: var(--color-border);
  }
  body {
    background-color: var(--color-background);
    color: var(--color-foreground);
  }
}
```

Note: `--accent` (brand purple, drives `bg-primary`/active nav row/focus rings via `--ring`) is kept
separate from `--accent-ui`/`--accent-ui-foreground` (the old shadcn "accent" slot used for hover states
like `Button`'s `ghost`/`outline` variants and `hover:bg-accent`) — reusing the original shadcn token
name for a *different* color than the new brand accent would silently break every `hover:bg-accent`
usage across `Button`/`Breadcrumb`/`CommandPalette`. `--color-accent`/`--color-accent-foreground` still
map to the hover-state slot (`--accent-ui`), preserving existing component behavior; the new brand
gradient is exposed separately as `--color-accent-2`/`bg-primary` (solid `--accent`) and consumed
directly where a gradient is needed (Task 6, Task 13's primary CTA) via an explicit
`bg-gradient-to-r from-primary to-[--accent-2]` utility, not a renamed shadcn slot.

- [ ] **Step 2: Manual visual check**

Run: `cd ads-agent && npm run dev`
Visit `http://localhost:3000` (or configured port) signed in; confirm the page background is near-black,
existing cards/table/badges render in dark surfaces with light text, and no light-mode flash occurs.

- [ ] **Step 3: Commit**

```bash
git add ads-agent/app/globals.css
git commit -m "feat(ads-agent): switch to fixed Pencil dark theme tokens"
```

---

### Task 2: `lib/nav-config.ts` — Pencil IA restructure

**Files:**
- Modify: `ads-agent/lib/nav-config.ts`
- Modify: `ads-agent/lib/nav-config.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `NAV_GROUPS` with the new item set/labels/hrefs (`Home`, `Marketing Automation` at
  `/campaigns`, `Leads & CRM` at `/crm`, `Reports` at `/reports` under `workspace`; `Users` at `/users`,
  `Settings` at `/settings` under `admin`) — Tasks 12-16 and `SidebarNav.tsx`/`Breadcrumb.tsx` (both
  already read `NAV_GROUPS` generically, no code change needed in either) consume this.

- [ ] **Step 1: Update the failing tests first**

```typescript
// ads-agent/lib/nav-config.test.ts
import { describe, expect, it } from "vitest";
import { NAV_GROUPS, visibleNavGroups } from "./nav-config";

describe("visibleNavGroups", () => {
  it("shows only Home in Workspace, and no Admin group, for a viewer", () => {
    const groups = visibleNavGroups("viewer");
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("workspace");
    expect(groups[0].items.map((item) => item.label)).toEqual(["Home"]);
  });

  it("shows all of Workspace but no Admin group for an operator", () => {
    const groups = visibleNavGroups("operator");
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe("workspace");
    expect(groups[0].items.map((item) => item.label)).toEqual([
      "Home",
      "Marketing Automation",
      "Leads & CRM",
      "Reports",
    ]);
  });

  it("shows both groups in full for an admin", () => {
    const groups = visibleNavGroups("admin");
    expect(groups).toHaveLength(2);
    expect(groups[0].items.map((item) => item.label)).toEqual([
      "Home",
      "Marketing Automation",
      "Leads & CRM",
      "Reports",
    ]);
    expect(groups[1].items.map((item) => item.label)).toEqual(["Users", "Settings"]);
  });

  it("returns no groups at all for a null role", () => {
    expect(visibleNavGroups(null)).toEqual([]);
  });

  it("NAV_GROUPS itself has the two groups and their real hrefs, unfiltered", () => {
    expect(NAV_GROUPS.map((g) => g.key)).toEqual(["workspace", "admin"]);
    expect(NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href))).toEqual([
      "/",
      "/campaigns",
      "/crm",
      "/reports",
      "/users",
      "/settings",
    ]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd ads-agent && npx vitest run lib/nav-config.test.ts`
Expected: FAIL — current `NAV_GROUPS` has `Overview`/`Campaigns`/`Proposals`/`Usage & Credits` labels
and no `/crm`/`/reports` items.

- [ ] **Step 3: Update `nav-config.ts`**

```typescript
// ads-agent/lib/nav-config.ts
import {
  LayoutDashboard,
  LineChart,
  Megaphone,
  Settings as SettingsIcon,
  Users,
  Users2,
  type LucideIcon,
} from "lucide-react";

export type MemberRole = "admin" | "operator" | "viewer";

export type NavItem = { href: string; label: string; icon: LucideIcon; minRole: MemberRole };
export type NavGroup = { key: string; label: string; items: NavItem[] };

const ROLE_RANK: Record<MemberRole, number> = { viewer: 1, operator: 2, admin: 3 };

export const NAV_GROUPS: NavGroup[] = [
  {
    key: "workspace",
    label: "Workspace",
    items: [
      { href: "/", label: "Home", icon: LayoutDashboard, minRole: "viewer" },
      { href: "/campaigns", label: "Marketing Automation", icon: Megaphone, minRole: "operator" },
      { href: "/crm", label: "Leads & CRM", icon: Users2, minRole: "operator" },
      { href: "/reports", label: "Reports", icon: LineChart, minRole: "operator" },
    ],
  },
  {
    key: "admin",
    label: "Admin",
    items: [
      { href: "/users", label: "Users", icon: Users, minRole: "admin" },
      { href: "/settings", label: "Settings", icon: SettingsIcon, minRole: "admin" },
    ],
  },
];

export function visibleNavGroups(role: MemberRole | null, groups: NavGroup[] = NAV_GROUPS): NavGroup[] {
  if (!role) return [];
  const rank = ROLE_RANK[role];
  return groups
    .map((group) => ({ ...group, items: group.items.filter((item) => ROLE_RANK[item.minRole] <= rank) }))
    .filter((group) => group.items.length > 0);
}
```

Note: `/proposals` and `/credits` are intentionally **not** in `NAV_GROUPS` any more — they remain real,
working routes (unchanged files), reached via `TabStrip` (Task 8) from `/campaigns` and `/settings`
respectively, not via the sidebar. `Breadcrumb.tsx` derives its label purely from a `NAV_GROUPS` match;
visiting `/proposals` directly falls through to its `"ads-agent"` fallback string today — acceptable
(same fallback behavior `/campaigns/new` already gets), not fixed by this plan.

- [ ] **Step 4: Run to verify it passes**

Run: `cd ads-agent && npx vitest run lib/nav-config.test.ts`
Expected: PASS, all 5 assertions.

- [ ] **Step 5: Commit**

```bash
git add ads-agent/lib/nav-config.ts ads-agent/lib/nav-config.test.ts
git commit -m "feat(ads-agent): restructure nav to Pencil IA (Home/Marketing Automation/Leads & CRM/Reports)"
```

---

### Task 3: `lib/crm/twenty-pipeline.ts` — new Twenty REST calls

**Files:**
- Create: `ads-agent/lib/crm/twenty-pipeline.ts`
- Test: `ads-agent/lib/crm/twenty-pipeline.test.ts`

**Interfaces:**
- Consumes: nothing new (uses `fetch`, `process.env.TWENTY_BASE_URL`/`TWENTY_API_KEY`, same pattern as
  `lib/crm/twenty.ts`/`ads-agent/lib/connectors/twenty.ts`).
- Produces: `PIPELINE_STAGES` (the ordered, typed stage list — single source of truth for Task 14's
  board columns), `PipelineStageValue` type, `Opportunity`/`Person` types, `listOpportunities()`,
  `getOpportunity(id)`, `updateOpportunityStage(id, stage)`, `getPipelineValue()`, `maskPhone(raw)`.
  Consumed by Task 9 (`crm-tools.ts`), Task 14 (CRM page + stage route), Task 12 (Home's Pipeline Value
  stat).

- [ ] **Step 1: Write the failing tests**

```typescript
// ads-agent/lib/crm/twenty-pipeline.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PIPELINE_STAGES,
  getOpportunity,
  getPipelineValue,
  listOpportunities,
  maskPhone,
  updateOpportunityStage,
} from "./twenty-pipeline";

const originalFetch = global.fetch;
const originalEnv = { ...process.env };

beforeEach(() => {
  process.env.TWENTY_API_KEY = "test-key";
  process.env.TWENTY_BASE_URL = "http://localhost:3020";
});

afterEach(() => {
  global.fetch = originalFetch;
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

describe("PIPELINE_STAGES", () => {
  it("has the 7 real configured Twenty stages, in order", () => {
    expect(PIPELINE_STAGES.map((s) => s.value)).toEqual([
      "NEW_BRIEF",
      "SHORTLIST",
      "TOUR",
      "NEGOTIATE",
      "LEGAL",
      "HANDOVER",
      "RENEWAL",
    ]);
    expect(PIPELINE_STAGES[0].label).toBe("New Brief");
  });
});

describe("maskPhone", () => {
  it("masks all but the last 4 digits, keeping the country code visible", () => {
    expect(maskPhone("+918800001234")).toBe("+91 8XXXXX-1234");
  });

  it("returns an empty-safe placeholder for a missing/short number", () => {
    expect(maskPhone("")).toBe("—");
    expect(maskPhone("123")).toBe("—");
  });
});

describe("listOpportunities", () => {
  it("maps Twenty's opportunities response into typed rows", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          opportunities: [
            {
              id: "opp-1",
              name: "Office: Priya Sharma",
              stage: "SHORTLIST",
              tier: "HOT",
              amount: { amountMicros: 15000000000, currencyCode: "INR" },
              pointOfContact: { name: { firstName: "Priya", lastName: "Sharma" }, phones: { primaryPhoneNumber: "8800001234", primaryPhoneCallingCode: "+91" } },
              source: "WhatsApp",
              listingName: "Koramangala",
              createdAt: "2026-08-01T00:00:00.000Z",
            },
          ],
        },
      }),
    });

    const rows = await listOpportunities();
    expect(rows).toEqual([
      {
        id: "opp-1",
        name: "Office: Priya Sharma",
        stage: "SHORTLIST",
        tier: "HOT",
        amountInr: 15000,
        contactName: "Priya Sharma",
        maskedPhone: "+91 8XXXXX-1234",
        source: "WhatsApp",
        listingName: "Koramangala",
        createdAt: "2026-08-01T00:00:00.000Z",
      },
    ]);
  });

  it("returns an empty list when Twenty is not configured", async () => {
    delete process.env.TWENTY_API_KEY;
    global.fetch = vi.fn();
    expect(await listOpportunities()).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("returns an empty list on a non-ok response rather than throwing", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    expect(await listOpportunities()).toEqual([]);
  });
});

describe("getOpportunity", () => {
  it("fetches a single opportunity by id", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          opportunity: {
            id: "opp-1",
            name: "Office: Priya Sharma",
            stage: "SHORTLIST",
            tier: "HOT",
            amount: null,
            pointOfContact: null,
            source: "WhatsApp",
            listingName: null,
            createdAt: "2026-08-01T00:00:00.000Z",
          },
        },
      }),
    });

    const row = await getOpportunity("opp-1");
    expect(row?.id).toBe("opp-1");
    expect(row?.amountInr).toBeNull();
    expect(row?.contactName).toBeNull();
    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:3020/rest/opportunities/opp-1",
      expect.objectContaining({ headers: { Authorization: "Bearer test-key" } }),
    );
  });

  it("returns null on a 404", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    expect(await getOpportunity("missing")).toBeNull();
  });
});

describe("updateOpportunityStage", () => {
  it("PATCHes the stage field and returns ok:true on success", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ data: { opportunity: { id: "opp-1" } } }) });

    const result = await updateOpportunityStage("opp-1", "TOUR");
    expect(result).toEqual({ ok: true });
    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:3020/rest/opportunities/opp-1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ stage: "TOUR" }),
      }),
    );
  });

  it("returns ok:false with an error message on failure", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => "bad stage" });
    const result = await updateOpportunityStage("opp-1", "TOUR");
    expect(result).toEqual({ ok: false, error: expect.stringContaining("400") });
  });
});

describe("getPipelineValue", () => {
  it("sums amountInr across all open opportunities", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          opportunities: [
            { id: "1", name: "A", stage: "NEW_BRIEF", tier: "HOT", amount: { amountMicros: 10000000000 }, pointOfContact: null, source: null, listingName: null, createdAt: "" },
            { id: "2", name: "B", stage: "RENEWAL", tier: "COLD", amount: { amountMicros: 5000000000 }, pointOfContact: null, source: null, listingName: null, createdAt: "" },
            { id: "3", name: "C", stage: "TOUR", tier: "WARM", amount: null, pointOfContact: null, source: null, listingName: null, createdAt: "" },
          ],
        },
      }),
    });

    expect(await getPipelineValue()).toBe(15000);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd ads-agent && npx vitest run lib/crm/twenty-pipeline.test.ts`
Expected: FAIL — `./twenty-pipeline` module does not exist.

- [ ] **Step 3: Implement `twenty-pipeline.ts`**

```typescript
// ads-agent/lib/crm/twenty-pipeline.ts

/** The real, configured Twenty pipeline (infra/twenty/README.md "Opportunity stages (API values)")
 * — the single source of truth for every stage list in this app. Corrects the Pencil mock's guessed
 * 4-column "New Brief/Qualified/Proposal/Won" board (see plan's Global Constraints). */
export const PIPELINE_STAGES = [
  { value: "NEW_BRIEF", label: "New Brief" },
  { value: "SHORTLIST", label: "Shortlist" },
  { value: "TOUR", label: "Tour" },
  { value: "NEGOTIATE", label: "Negotiate" },
  { value: "LEGAL", label: "Legal" },
  { value: "HANDOVER", label: "Handover" },
  { value: "RENEWAL", label: "Renewal" },
] as const;

export type PipelineStageValue = (typeof PIPELINE_STAGES)[number]["value"];

export type OpportunityTier = "HOT" | "WARM" | "COLD" | "UNSCORED";

export type Opportunity = {
  id: string;
  name: string;
  stage: string;
  tier: OpportunityTier | null;
  amountInr: number | null;
  contactName: string | null;
  maskedPhone: string | null;
  source: string | null;
  listingName: string | null;
  createdAt: string;
};

type RawAmount = { amountMicros: number; currencyCode?: string } | null | undefined;
type RawPointOfContact =
  | { name?: { firstName?: string; lastName?: string } | null; phones?: { primaryPhoneNumber?: string; primaryPhoneCallingCode?: string } | null }
  | null
  | undefined;

type RawOpportunity = {
  id: string;
  name: string;
  stage: string;
  tier?: string | null;
  amount?: RawAmount;
  pointOfContact?: RawPointOfContact;
  source?: string | null;
  listingName?: string | null;
  createdAt: string;
};

function baseUrl(): string {
  return (process.env.TWENTY_BASE_URL ?? "http://localhost:3020").replace(/\/$/, "");
}

function isConfigured(): boolean {
  return Boolean(process.env.TWENTY_API_KEY?.trim());
}

function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${process.env.TWENTY_API_KEY!.trim()}` };
}

/** Masks a phone number to show only the country code, the mobile number's first digit, and its
 * last 4 digits, e.g. "+918800001234" -> "+91 8XXXXX-1234". Assumes a 10-digit mobile number (this
 * codebase's existing India-only convention — lib/crm/twenty.ts hardcodes "+91" the same way). No
 * masking utility existed anywhere in this codebase before this function (verified via Torbit +
 * Grep) — this is new logic, not a reuse. */
export function maskPhone(raw: string): string {
  const digits = raw.replace(/[^\d]/g, "");
  if (digits.length < 10) return "—";
  const mobile = digits.slice(-10);
  const countryCode = digits.slice(0, digits.length - 10) || "91";
  return `+${countryCode} ${mobile[0]}XXXXX-${mobile.slice(-4)}`;
}

function toAmountInr(amount: RawAmount): number | null {
  if (!amount) return null;
  return amount.amountMicros / 1_000_000;
}

function toContact(poc: RawPointOfContact): { contactName: string | null; maskedPhone: string | null } {
  if (!poc) return { contactName: null, maskedPhone: null };
  const first = poc.name?.firstName ?? "";
  const last = poc.name?.lastName ?? "";
  const contactName = [first, last].filter(Boolean).join(" ") || null;
  const phone = poc.phones?.primaryPhoneNumber;
  const callingCode = poc.phones?.primaryPhoneCallingCode ?? "+91";
  const maskedPhone = phone ? maskPhone(`${callingCode}${phone}`) : null;
  return { contactName, maskedPhone };
}

function toOpportunity(raw: RawOpportunity): Opportunity {
  const { contactName, maskedPhone } = toContact(raw.pointOfContact);
  return {
    id: raw.id,
    name: raw.name,
    stage: raw.stage,
    tier: (raw.tier as OpportunityTier | undefined) ?? null,
    amountInr: toAmountInr(raw.amount),
    contactName,
    maskedPhone,
    source: raw.source ?? null,
    listingName: raw.listingName ?? null,
    createdAt: raw.createdAt,
  };
}

/** List every open opportunity. Twenty's REST list endpoint shape mirrors the one
 * ads-agent/lib/connectors/twenty.ts's fetchLeadSignal() already reads ({ data: { opportunities: [] } }).
 * Fails soft (empty array) on missing config or a non-ok response — same fail-soft convention as
 * fetchLeadSignal, so a Twenty outage degrades the board to "no leads" rather than a crashed page. */
export async function listOpportunities(): Promise<Opportunity[]> {
  if (!isConfigured()) return [];
  try {
    const res = await fetch(`${baseUrl()}/rest/opportunities?limit=200`, { headers: authHeaders() });
    if (!res.ok) return [];
    const json = (await res.json()) as { data?: { opportunities?: RawOpportunity[] } };
    const opportunities = json.data?.opportunities ?? [];
    return opportunities.map(toOpportunity);
  } catch {
    return [];
  }
}

/** Fetch a single opportunity by id. NOTE (see plan's Global Constraints — Twenty REST semantics
 * assumption): GET-by-id has no existing precedent in this repo; verify this response envelope
 * against the local Twenty instance during this task's manual-verification step. */
export async function getOpportunity(id: string): Promise<Opportunity | null> {
  if (!isConfigured()) return null;
  try {
    const res = await fetch(`${baseUrl()}/rest/opportunities/${id}`, { headers: authHeaders() });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: { opportunity?: RawOpportunity } };
    const opportunity = json.data?.opportunity;
    return opportunity ? toOpportunity(opportunity) : null;
  } catch {
    return null;
  }
}

export type UpdateStageResult = { ok: true } | { ok: false; error: string };

/** Advance (or move back) an opportunity's stage. NOTE (see plan's Global Constraints): PATCH has no
 * existing precedent in this repo either — verify against the local Twenty instance. */
export async function updateOpportunityStage(
  id: string,
  stage: PipelineStageValue,
): Promise<UpdateStageResult> {
  if (!isConfigured()) return { ok: false, error: "Twenty is not configured" };
  try {
    const res = await fetch(`${baseUrl()}/rest/opportunities/${id}`, {
      method: "PATCH",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ stage }),
    });
    if (!res.ok) return { ok: false, error: `Twenty PATCH opportunities/${id} ${res.status}: ${(await res.text()).slice(0, 200)}` };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Sum of amountInr across every opportunity currently returned by listOpportunities() — backs Home's
 * Pipeline Value stat. Twenty has no separate "closed/lost" flag surfaced yet, so this is "everything
 * the pipeline query returns," matching fetchLeadSignal's own "account-wide, no attribution yet" note. */
export async function getPipelineValue(): Promise<number> {
  const opportunities = await listOpportunities();
  return opportunities.reduce((sum, o) => sum + (o.amountInr ?? 0), 0);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd ads-agent && npx vitest run lib/crm/twenty-pipeline.test.ts`
Expected: PASS, all assertions. If the `maskPhone`/`toContact` slicing math doesn't line up exactly
with the test's expected `"+91 8XXXXX-1234"` string, adjust the implementation (not the test) to match
this exact, deliberate format.

- [ ] **Step 5: Manual verification against the local Twenty instance**

Run: `cd infra/twenty && docker compose up -d` (or whatever this repo's existing Twenty-local-dev
command is — check `infra/twenty/README.md`'s Operations section), then with a real `TWENTY_API_KEY`/
`TWENTY_BASE_URL` in `ads-agent/.env.local`, run a one-off script or `node -e` call to
`getOpportunity()`/`updateOpportunityStage()` against a real seeded opportunity id, and confirm the
response envelope matches what Step 3 assumes. Fix the unwrap logic here (not downstream) if it differs.

- [ ] **Step 6: Commit**

```bash
git add ads-agent/lib/crm/twenty-pipeline.ts ads-agent/lib/crm/twenty-pipeline.test.ts
git commit -m "feat(ads-agent): add Twenty CRM pipeline read/write calls (list/get/update-stage/pipeline-value)"
```

---

### Task 4: `lib/db/ai-action-log.ts` — AI action log

**Files:**
- Modify: `ads-agent/lib/db/schema.sql`
- Create: `ads-agent/lib/db/ai-action-log.ts`
- Test: `ads-agent/lib/db/ai-action-log.test.ts`
- Modify: `ads-agent/lib/decision-engine/cycle.ts`
- Modify: `ads-agent/lib/decision-engine/cycle.test.ts`

**Interfaces:**
- Consumes: `getPool` from `../db/client` (existing).
- Produces: `AiActionDomain` type, `logAiAction(input)`, `countAiActionsToday()`,
  `listRecentAiActions(limit)` — consumed by Task 12 (Home) and Task 9 (`crm-tools.ts`'s stage-advance
  tool).

- [ ] **Step 1: Append the new table to `schema.sql`**

```sql
-- Appended to ads-agent/lib/db/schema.sql (after the existing usage_ledger block)
CREATE TABLE IF NOT EXISTS ai_action_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain TEXT NOT NULL CHECK (domain IN ('marketing','crm')),
  summary TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

- [ ] **Step 2: Write the failing test for `ai-action-log.ts`**

```typescript
// ads-agent/lib/db/ai-action-log.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("./client", () => ({ getPool: () => ({ query }) }));

import { countAiActionsToday, listRecentAiActions, logAiAction } from "./ai-action-log";

beforeEach(() => query.mockReset());

describe("logAiAction", () => {
  it("inserts a domain + summary row", async () => {
    query.mockResolvedValue({ rows: [] });
    await logAiAction({ domain: "crm", summary: "Advanced Priya Sharma to Tour" });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO ai_action_log"),
      ["crm", "Advanced Priya Sharma to Tour"],
    );
  });
});

describe("countAiActionsToday", () => {
  it("returns the count of rows created since midnight", async () => {
    query.mockResolvedValue({ rows: [{ count: "3" }] });
    expect(await countAiActionsToday()).toBe(3);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("date_trunc('day'"));
  });
});

describe("listRecentAiActions", () => {
  it("maps rows to typed entries, most recent first", async () => {
    query.mockResolvedValue({
      rows: [
        { id: "1", domain: "marketing", summary: "Created 2 proposals", created_at: new Date("2026-08-05T10:00:00Z") },
        { id: "2", domain: "crm", summary: "Advanced Priya Sharma to Tour", created_at: new Date("2026-08-05T09:00:00Z") },
      ],
    });
    const rows = await listRecentAiActions(5);
    expect(rows).toEqual([
      { id: "1", domain: "marketing", summary: "Created 2 proposals", createdAt: "2026-08-05T10:00:00.000Z" },
      { id: "2", domain: "crm", summary: "Advanced Priya Sharma to Tour", createdAt: "2026-08-05T09:00:00.000Z" },
    ]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining("ORDER BY created_at DESC"), [5]);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd ads-agent && npx vitest run lib/db/ai-action-log.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 4: Implement `ai-action-log.ts`**

```typescript
// ads-agent/lib/db/ai-action-log.ts
import { getPool } from "./client";

export type AiActionDomain = "marketing" | "crm";

export type AiActionLogEntry = {
  id: string;
  domain: AiActionDomain;
  summary: string;
  createdAt: string;
};

type AiActionLogRow = { id: string; domain: AiActionDomain; summary: string; created_at: Date };

/** Records one real, already-happened automated action — the decision engine creating proposals
 * (domain: "marketing") or the CRM Assistant advancing a lead's stage (domain: "crm"). Never called
 * speculatively for actions that don't actually happen yet (see plan's Global Constraints). */
export async function logAiAction(input: { domain: AiActionDomain; summary: string }): Promise<void> {
  await getPool().query(`INSERT INTO ai_action_log (domain, summary) VALUES ($1, $2)`, [
    input.domain,
    input.summary,
  ]);
}

export async function countAiActionsToday(): Promise<number> {
  const { rows } = await getPool().query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM ai_action_log WHERE created_at >= date_trunc('day', now())`,
  );
  return Number(rows[0].count);
}

export async function listRecentAiActions(limit: number): Promise<AiActionLogEntry[]> {
  const { rows } = await getPool().query<AiActionLogRow>(
    `SELECT id, domain, summary, created_at FROM ai_action_log ORDER BY created_at DESC LIMIT $1`,
    [limit],
  );
  return rows.map((row) => ({
    id: row.id,
    domain: row.domain,
    summary: row.summary,
    createdAt: row.created_at.toISOString(),
  }));
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd ads-agent && npx vitest run lib/db/ai-action-log.test.ts`
Expected: PASS.

- [ ] **Step 6: Wire `runDecisionCycle()` to log when it creates proposals — read the existing test first**

```typescript
// ads-agent/lib/decision-engine/cycle.test.ts — add to the vi.hoisted block and a vi.mock call:
// (existing hoisted fns stay; add:)
//   logAiAction: vi.fn(),
// (existing vi.mock calls stay; add:)
// vi.mock("../db/ai-action-log", () => ({ logAiAction }));
//
// Add this new test case inside the existing describe("runDecisionCycle", ...) block:
it("logs one ai_action_log row summarizing the count when proposals are created", async () => {
  listCampaigns.mockResolvedValue([]);
  fetchGoogleAdsPerformance.mockResolvedValue([]);
  fetchMetaPerformance.mockResolvedValue([]);
  fetchGoogleSearchTerms.mockResolvedValue([]);
  fetchLeadSignal.mockResolvedValue({ hotCount: 0, warmCount: 0, coldCount: 0, unscoredCount: 0 });
  recentPerformanceSnapshots.mockResolvedValue([]);
  evaluateRules.mockReturnValue([{ kind: "pause", campaignId: "c1", payload: {}, triggeredRule: "r1" }]);
  draftRationale.mockResolvedValue("rationale");
  createProposal.mockResolvedValue({});

  await runDecisionCycle();

  expect(logAiAction).toHaveBeenCalledWith({ domain: "marketing", summary: "Created 1 proposal" });
});

it("does not log when no proposals are created", async () => {
  listCampaigns.mockResolvedValue([]);
  fetchGoogleAdsPerformance.mockResolvedValue([]);
  fetchMetaPerformance.mockResolvedValue([]);
  fetchGoogleSearchTerms.mockResolvedValue([]);
  fetchLeadSignal.mockResolvedValue({ hotCount: 0, warmCount: 0, coldCount: 0, unscoredCount: 0 });
  recentPerformanceSnapshots.mockResolvedValue([]);
  evaluateRules.mockReturnValue([]);

  await runDecisionCycle();

  expect(logAiAction).not.toHaveBeenCalled();
});
```

- [ ] **Step 7: Run to verify the new cycle tests fail**

Run: `cd ads-agent && npx vitest run lib/decision-engine/cycle.test.ts`
Expected: FAIL on the two new tests — `cycle.ts` doesn't import/call `logAiAction` yet.

- [ ] **Step 8: Wire the call in `cycle.ts`**

```typescript
// ads-agent/lib/decision-engine/cycle.ts — add the import:
import { logAiAction } from "../db/ai-action-log";

// ...inside runDecisionCycle(), replace the existing tail:
//   let proposalsCreated = 0;
//   for (const proposal of newProposals) {
//     const rationale = await draftRationale(proposal);
//     await createProposal({ ...proposal, rationale });
//     proposalsCreated++;
//   }
//   return { proposalsCreated };
// with:
  let proposalsCreated = 0;
  for (const proposal of newProposals) {
    const rationale = await draftRationale(proposal);
    await createProposal({ ...proposal, rationale });
    proposalsCreated++;
  }

  if (proposalsCreated > 0) {
    await logAiAction({
      domain: "marketing",
      summary: `Created ${proposalsCreated} proposal${proposalsCreated === 1 ? "" : "s"}`,
    });
  }

  return { proposalsCreated };
```

- [ ] **Step 9: Run to verify all cycle tests pass**

Run: `cd ads-agent && npx vitest run lib/decision-engine/cycle.test.ts`
Expected: PASS, including the two new tests and every pre-existing one (unchanged behavior otherwise).

- [ ] **Step 10: Apply the schema change locally and commit**

Run: `cd ads-agent && npm run migrate` (confirms `CREATE TABLE IF NOT EXISTS ai_action_log` applies
cleanly against a real dev database, per this repo's existing convention for schema changes).

```bash
git add ads-agent/lib/db/schema.sql ads-agent/lib/db/ai-action-log.ts ads-agent/lib/db/ai-action-log.test.ts ads-agent/lib/decision-engine/cycle.ts ads-agent/lib/decision-engine/cycle.test.ts
git commit -m "feat(ads-agent): add ai_action_log table + log decision-engine proposal creation"
```

---

### Task 5: `components/pencil/StatusPill.tsx`

**Files:**
- Create: `ads-agent/components/pencil/StatusPill.tsx`
- Test: `ads-agent/components/pencil/StatusPill.test.tsx`

**Interfaces:**
- Consumes: `cn` from `@/lib/utils`, Task 1's `bg-status-*`/`text-status-*` tokens.
- Produces: `StatusPill({ tone, label })` — consumed by Task 13 (`CampaignCard`) and Task 14
  (`LeadCard`).

- [ ] **Step 1: Write the failing test**

```typescript
// ads-agent/components/pencil/StatusPill.test.tsx
import { describe, expect, it } from "vitest";
import { StatusPill } from "./StatusPill";

describe("StatusPill", () => {
  it("renders the label text", () => {
    const el = StatusPill({ tone: "hot", label: "Hot" });
    expect(JSON.stringify(el)).toContain("Hot");
  });

  it("applies a distinct class per tone", () => {
    const hot = StatusPill({ tone: "hot", label: "Hot" });
    const cold = StatusPill({ tone: "cold", label: "Cold" });
    expect(JSON.stringify(hot)).not.toBe(JSON.stringify(cold));
  });

  it.each(["hot", "warm", "cold", "unscored", "active", "paused", "draft"] as const)(
    "does not throw for tone=%s",
    (tone) => {
      expect(() => StatusPill({ tone, label: tone })).not.toThrow();
    },
  );
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd ads-agent && npx vitest run components/pencil/StatusPill.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

```typescript
// ads-agent/components/pencil/StatusPill.tsx
import { cn } from "@/lib/utils";

export type StatusTone = "hot" | "warm" | "cold" | "unscored" | "active" | "paused" | "draft";

const TONE_CLASS: Record<StatusTone, string> = {
  hot: "bg-status-hot/15 text-status-hot",
  warm: "bg-status-warm/15 text-status-warm",
  cold: "bg-status-cold/15 text-status-cold",
  unscored: "bg-status-unscored/15 text-status-unscored",
  active: "bg-status-positive/15 text-status-positive",
  paused: "bg-status-warm/15 text-status-warm",
  draft: "bg-muted text-muted-foreground",
};

const DOT_CLASS: Record<StatusTone, string> = {
  hot: "bg-status-hot",
  warm: "bg-status-warm",
  cold: "bg-status-cold",
  unscored: "bg-status-unscored",
  active: "bg-status-positive",
  paused: "bg-status-warm",
  draft: "bg-muted-foreground",
};

export function StatusPill({ tone, label }: { tone: StatusTone; label: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium uppercase tracking-wide",
        TONE_CLASS[tone],
      )}
    >
      <span className={cn("size-1.5 rounded-full", DOT_CLASS[tone])} aria-hidden="true" />
      {label}
    </span>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd ads-agent && npx vitest run components/pencil/StatusPill.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ads-agent/components/pencil/StatusPill.tsx ads-agent/components/pencil/StatusPill.test.tsx
git commit -m "feat(ads-agent): add StatusPill component for lead/campaign status tags"
```

---

### Task 6: `components/pencil/{KanbanCard,KanbanColumn,KanbanBoard}.tsx`

**Files:**
- Modify: `ads-agent/package.json` (add `framer-motion`)
- Create: `ads-agent/components/pencil/KanbanCard.tsx`
- Create: `ads-agent/components/pencil/KanbanColumn.tsx`
- Create: `ads-agent/components/pencil/KanbanBoard.tsx`
- Test: `ads-agent/components/pencil/KanbanBoard.test.tsx`

**Interfaces:**
- Consumes: `framer-motion`'s `Reorder`, `motion` (new dependency), Task 1's tokens.
- Produces: `KanbanCard({ children, className? })`, `KanbanColumn({ label, count, children })`,
  `KanbanBoard({ columns, onReorderColumn? })` where
  `columns: { key: string; label: string; cards: { id: string; node: ReactNode }[] }[]` and
  `onReorderColumn?: (columnKey: string, orderedIds: string[]) => void` — consumed by Task 13
  (Marketing Automation) and Task 14 (Leads & CRM).

- [ ] **Step 1: Install the new dependency**

Run: `cd ads-agent && npm install framer-motion`
Expected: `package.json`/`package-lock.json` gain `framer-motion` at whatever version npm resolves —
this is the plan's one new dependency (see Global Constraints).

- [ ] **Step 2: Write the failing test**

```typescript
// ads-agent/components/pencil/KanbanBoard.test.tsx
import { describe, expect, it } from "vitest";
import { KanbanBoard } from "./KanbanBoard";

describe("KanbanBoard", () => {
  it("renders one column per entry, each with its label and count", () => {
    const el = KanbanBoard({
      columns: [
        { key: "draft", label: "Draft", cards: [{ id: "c1", node: "Campaign One" }] },
        { key: "active", label: "Active", cards: [{ id: "c2", node: "Campaign Two" }, { id: "c3", node: "Campaign Three" }] },
      ],
    });
    const json = JSON.stringify(el);
    expect(json).toContain("Draft");
    expect(json).toContain("Active");
    expect(json).toContain("Campaign One");
    expect(json).toContain("Campaign Two");
    expect(json).toContain("Campaign Three");
  });

  it("renders an empty column without throwing", () => {
    expect(() => KanbanBoard({ columns: [{ key: "empty", label: "Empty", cards: [] }] })).not.toThrow();
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd ads-agent && npx vitest run components/pencil/KanbanBoard.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 4: Implement `KanbanCard.tsx`**

```typescript
// ads-agent/components/pencil/KanbanCard.tsx
"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Base card chrome shared by CampaignCard (Task 13) and LeadCard (Task 14) — padding, radius,
 * hover, and mount-entrance animation live here once; callers own their own content. */
export function KanbanCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      className={cn(
        "flex flex-col gap-2 rounded-lg border border-border bg-card p-3 text-sm shadow-sm transition-colors hover:border-primary/40",
        className,
      )}
    >
      {children}
    </motion.div>
  );
}
```

- [ ] **Step 5: Implement `KanbanColumn.tsx`**

```typescript
// ads-agent/components/pencil/KanbanColumn.tsx
import type { ReactNode } from "react";

export function KanbanColumn({
  label,
  count,
  children,
}: {
  label: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <div className="flex w-72 shrink-0 flex-col gap-3 rounded-xl bg-surface p-3">
      <div className="flex items-center justify-between px-1">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <span className="rounded-full bg-surface-raised px-2 py-0.5 text-xs text-muted-foreground">
          {count}
        </span>
      </div>
      <div className="flex flex-col gap-2 overflow-y-auto">{children}</div>
    </div>
  );
}
```

- [ ] **Step 6: Implement `KanbanBoard.tsx`**

```typescript
// ads-agent/components/pencil/KanbanBoard.tsx
"use client";

import { Reorder } from "framer-motion";
import type { ReactNode } from "react";
import { KanbanColumn } from "./KanbanColumn";

export type KanbanBoardColumn = {
  key: string;
  label: string;
  cards: { id: string; node: ReactNode }[];
};

/** Horizontally-scrolling column layout with Framer Motion's Reorder for in-column drag ordering.
 * Cross-column drag (moving a card to a different column) is handled by the page-level caller
 * (Task 13/14) via HTML5 drag-and-drop on each card's wrapper, not by this component — Reorder.Group
 * only reorders within one list; a column boundary crossing is a real state change (status/stage),
 * which the caller owns since it knows what that mutation means for its domain. */
export function KanbanBoard({
  columns,
  onReorderColumn,
}: {
  columns: KanbanBoardColumn[];
  onReorderColumn?: (columnKey: string, orderedIds: string[]) => void;
}) {
  return (
    <div className="flex gap-4 overflow-x-auto pb-2">
      {columns.map((column) => (
        <KanbanColumn key={column.key} label={column.label} count={column.cards.length}>
          <Reorder.Group
            axis="y"
            values={column.cards.map((c) => c.id)}
            onReorder={(orderedIds) => onReorderColumn?.(column.key, orderedIds)}
            className="flex flex-col gap-2"
          >
            {column.cards.map((card) => (
              <Reorder.Item key={card.id} value={card.id}>
                {card.node}
              </Reorder.Item>
            ))}
          </Reorder.Group>
        </KanbanColumn>
      ))}
    </div>
  );
}
```

- [ ] **Step 7: Run to verify tests pass**

Run: `cd ads-agent && npx vitest run components/pencil/KanbanBoard.test.tsx`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add ads-agent/package.json ads-agent/package-lock.json ads-agent/components/pencil/KanbanCard.tsx ads-agent/components/pencil/KanbanColumn.tsx ads-agent/components/pencil/KanbanBoard.tsx ads-agent/components/pencil/KanbanBoard.test.tsx
git commit -m "feat(ads-agent): add KanbanBoard/Column/Card components with framer-motion"
```

---

### Task 7: `components/pencil/SideAssistantPanel.tsx`

**Files:**
- Create: `ads-agent/components/pencil/SideAssistantPanel.tsx`
- Test: `ads-agent/components/pencil/SideAssistantPanel.test.tsx`

**Interfaces:**
- Consumes: Task 1's tokens, existing `Button`/`Card`/`CardHeader`/`CardTitle` from
  `@/components/ui/*`, `lucide-react`'s `Send`, `Sparkles`.
- Produces: `SideAssistantPanel({ title, messages, input, onInputChange, onSend, sending,
  pinnedActionSlot? })` — a **presentational** shell (message list + input bar + optional pinned action
  card); it owns no fetch/streaming logic itself, matching this repo's existing convention of thin UI +
  logic-bearing callers (`CopilotPanel.tsx` already keeps its own streaming state locally rather than in
  a shared component). Consumed by Task 13 (Campaign Chat restyle) and Task 14 (CRM Assistant).

- [ ] **Step 1: Write the failing test**

```typescript
// ads-agent/components/pencil/SideAssistantPanel.test.tsx
import { describe, expect, it } from "vitest";
import { SideAssistantPanel } from "./SideAssistantPanel";

describe("SideAssistantPanel", () => {
  it("renders the title and every message's content", () => {
    const el = SideAssistantPanel({
      title: "Campaign Chat",
      messages: [
        { id: "1", role: "user", content: "Show me hot leads" },
        { id: "2", role: "assistant", content: "Here they are" },
      ],
      input: "",
      onInputChange: () => {},
      onSend: () => {},
      sending: false,
    });
    const json = JSON.stringify(el);
    expect(json).toContain("Campaign Chat");
    expect(json).toContain("Show me hot leads");
    expect(json).toContain("Here they are");
  });

  it("renders the pinnedActionSlot above the input when provided", () => {
    const el = SideAssistantPanel({
      title: "CRM Assistant",
      messages: [],
      input: "",
      onInputChange: () => {},
      onSend: () => {},
      sending: false,
      pinnedActionSlot: "CONFIRM ACTION",
    });
    expect(JSON.stringify(el)).toContain("CONFIRM ACTION");
  });

  it("does not throw with an empty message list", () => {
    expect(() =>
      SideAssistantPanel({ title: "Empty", messages: [], input: "", onInputChange: () => {}, onSend: () => {}, sending: false }),
    ).not.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd ads-agent && npx vitest run components/pencil/SideAssistantPanel.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

```typescript
// ads-agent/components/pencil/SideAssistantPanel.tsx
"use client";

import type { ReactNode } from "react";
import { Loader2, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

export type SideAssistantMessage = { id: string; role: "user" | "assistant"; content: ReactNode };

export function SideAssistantPanel({
  title,
  messages,
  input,
  onInputChange,
  onSend,
  sending,
  pinnedActionSlot,
  placeholder = "Ask a follow-up…",
}: {
  title: string;
  messages: SideAssistantMessage[];
  input: string;
  onInputChange: (value: string) => void;
  onSend: () => void;
  sending: boolean;
  pinnedActionSlot?: ReactNode;
  placeholder?: string;
}) {
  return (
    <div className="flex h-full flex-col gap-3 rounded-xl bg-surface p-4">
      <div className="flex items-center gap-2 border-b border-border pb-3">
        <Sparkles className="size-4 text-primary" aria-hidden="true" />
        <span className="text-sm font-semibold text-foreground">{title}</span>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto">
        {messages.map((message) =>
          message.role === "user" ? (
            <div key={message.id} className="ml-auto max-w-[85%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground">
              {message.content}
            </div>
          ) : (
            <div key={message.id} className="max-w-[90%] rounded-lg bg-surface-raised px-3 py-2 text-sm text-foreground">
              {message.content}
            </div>
          ),
        )}
      </div>
      {pinnedActionSlot && (
        <div className="rounded-lg border border-border bg-surface-raised p-3 text-sm">{pinnedActionSlot}</div>
      )}
      <div className="flex gap-2">
        <input
          className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
          placeholder={placeholder}
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              onSend();
            }
          }}
          disabled={sending}
        />
        <Button size="icon" disabled={sending || !input.trim()} onClick={onSend} aria-label="Send">
          {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd ads-agent && npx vitest run components/pencil/SideAssistantPanel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ads-agent/components/pencil/SideAssistantPanel.tsx ads-agent/components/pencil/SideAssistantPanel.test.tsx
git commit -m "feat(ads-agent): add SideAssistantPanel shared chat shell"
```

---

### Task 8: `components/pencil/TabStrip.tsx`

**Files:**
- Create: `ads-agent/components/pencil/TabStrip.tsx`
- Test: `ads-agent/components/pencil/TabStrip.test.tsx`

**Interfaces:**
- Consumes: `next/navigation`'s `usePathname` (same pattern as `Breadcrumb.tsx`), `next/link`.
- Produces: `TabStrip({ tabs })` where `tabs: { href: string; label: string }[]` — consumed by Task 13
  (`/campaigns` ↔ `/proposals`) and Task 16 (`/settings` ↔ `/credits`).

Since this is a Client Component reading `usePathname()`, its test exercises the pure active-tab logic
by calling the component function directly with a mocked pathname — same "call the function, assert on
the returned tree" convention as every other component test in this plan, avoiding
`@testing-library/react`.

- [ ] **Step 1: Write the failing test**

```typescript
// ads-agent/components/pencil/TabStrip.test.tsx
import { describe, expect, it, vi } from "vitest";

const { usePathname } = vi.hoisted(() => ({ usePathname: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname }));

import { TabStrip } from "./TabStrip";

describe("TabStrip", () => {
  it("renders every tab's label", () => {
    usePathname.mockReturnValue("/campaigns");
    const el = TabStrip({ tabs: [{ href: "/campaigns", label: "Board" }, { href: "/proposals", label: "Proposals" }] });
    const json = JSON.stringify(el);
    expect(json).toContain("Board");
    expect(json).toContain("Proposals");
  });

  it("marks the tab matching the current pathname as active", () => {
    usePathname.mockReturnValue("/proposals");
    const el = TabStrip({ tabs: [{ href: "/campaigns", label: "Board" }, { href: "/proposals", label: "Proposals" }] });
    const json = JSON.stringify(el);
    // active tab carries the "text-foreground" class; inactive carries "text-muted-foreground"
    const proposalsIndex = json.indexOf("Proposals");
    const boardIndex = json.indexOf("Board");
    expect(json.slice(Math.max(0, proposalsIndex - 200), proposalsIndex)).toContain("text-foreground");
    expect(json.slice(Math.max(0, boardIndex - 200), boardIndex)).toContain("text-muted-foreground");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd ads-agent && npx vitest run components/pencil/TabStrip.test.tsx`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement**

```typescript
// ads-agent/components/pencil/TabStrip.tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/** Real navigation between sibling routes (e.g. /campaigns <-> /proposals, /settings <-> /credits) —
 * not a content-merging tab component. Each route keeps its own page.tsx/logic untouched; this only
 * renders the tab strip at the top. Same active-match convention as Breadcrumb.tsx. */
export function TabStrip({ tabs }: { tabs: { href: string; label: string }[] }) {
  const pathname = usePathname();

  return (
    <div className="flex gap-1 border-b border-border">
      {tabs.map((tab) => {
        const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              active ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd ads-agent && npx vitest run components/pencil/TabStrip.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ads-agent/components/pencil/TabStrip.tsx ads-agent/components/pencil/TabStrip.test.tsx
git commit -m "feat(ads-agent): add TabStrip for cross-route tab navigation"
```

---

### Task 9: `lib/openui/{crm-library,crm-tools}.ts` — Spec 3

**Files:**
- Create: `ads-agent/lib/openui/crm-library.ts`
- Test: `ads-agent/lib/openui/crm-library.test.ts`
- Create: `ads-agent/lib/openui/crm-tools.ts`
- Test: `ads-agent/lib/openui/crm-tools.test.ts`

**Interfaces:**
- Consumes: Task 3's `listOpportunities`/`getOpportunity`/`updateOpportunityStage`/`PIPELINE_STAGES`,
  Task 4's `logAiAction`, `defineComponent`/`createLibrary` from `@openuidev/lang-core`,
  `StatCard`/shared components pattern from the foundation plan.
- Produces: `crmLibrary` (Library: `OpportunityCard`, `OpportunityList`, `StageChangeConfirm`), a
  `ToolProviderMap`-shaped `crmToolProvider`, and `crmToolSpecs: ToolSpec[]` (`list_opportunities`,
  `search_opportunities`, `get_opportunity`, `advance_opportunity_stage`) — consumed by Task 11
  (composition) and Task 14 (CRM chat route).

- [ ] **Step 1: Write the failing library test**

```typescript
// ads-agent/lib/openui/crm-library.test.ts
import { describe, expect, it } from "vitest";
import { OpportunityCardView, OpportunityListView, StageChangeConfirmView, crmLibrary } from "./crm-library";

describe("crmLibrary", () => {
  it("registers OpportunityCard, OpportunityList, and StageChangeConfirm", () => {
    expect(Object.keys(crmLibrary.components).sort()).toEqual(
      ["OpportunityCard", "OpportunityList", "StageChangeConfirm"].sort(),
    );
  });
});

describe("OpportunityCardView", () => {
  it("renders without throwing given null optional fields (OpenUI streaming safety)", () => {
    expect(() =>
      OpportunityCardView({ name: "Priya Sharma", stage: "SHORTLIST", tier: null, amountLabel: null, maskedPhone: null, source: null }),
    ).not.toThrow();
  });
});

describe("OpportunityListView", () => {
  it("renders each opportunity's name", () => {
    const tree = OpportunityListView({
      opportunities: [
        { name: "Priya Sharma", stage: "SHORTLIST", tier: "HOT", amountLabel: "₹15,000", maskedPhone: "+91 8XXXXX-1234", source: "WhatsApp" },
        { name: "Rohan Mehta", stage: "TOUR", tier: "HOT", amountLabel: null, maskedPhone: null, source: null },
      ],
    });
    expect(JSON.stringify(tree)).toContain("Priya Sharma");
    expect(JSON.stringify(tree)).toContain("Rohan Mehta");
  });

  it("renders an empty-state message for zero opportunities", () => {
    const tree = OpportunityListView({ opportunities: [] });
    expect(JSON.stringify(tree)).toContain("No opportunities found");
  });
});

describe("StageChangeConfirmView", () => {
  it("renders the from/to stage labels", () => {
    const tree = StageChangeConfirmView({ opportunityName: "Priya Sharma", fromStage: "Qualified", toStage: "Tour" });
    const json = JSON.stringify(tree);
    expect(json).toContain("Priya Sharma");
    expect(json).toContain("Qualified");
    expect(json).toContain("Tour");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd ads-agent && npx vitest run lib/openui/crm-library.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `crm-library.ts`**

```typescript
// ads-agent/lib/openui/crm-library.ts
import { createLibrary, defineComponent } from "@openuidev/lang-core";
import React from "react";
import { z } from "zod";

const OpportunitySchema = z.object({
  name: z.string(),
  stage: z.string(),
  tier: z.enum(["HOT", "WARM", "COLD", "UNSCORED"]).optional().default("UNSCORED"),
  amountLabel: z.string().optional().default(""),
  maskedPhone: z.string().optional().default(""),
  source: z.string().optional().default(""),
});
export type OpportunityProps = z.infer<typeof OpportunitySchema>;
export type OpportunityViewInput = { [K in keyof OpportunityProps]?: OpportunityProps[K] | null };

function normalizeOpportunity(raw: OpportunityViewInput): OpportunityProps {
  return {
    name: raw.name ?? "",
    stage: raw.stage ?? "",
    tier: raw.tier ?? "UNSCORED",
    amountLabel: raw.amountLabel ?? "",
    maskedPhone: raw.maskedPhone ?? "",
    source: raw.source ?? "",
  };
}

/** Pure, read-only presentation of one opportunity — dual-mode convention (direct call for the CRM
 * board's LeadCard content, wrapped below for the model path). Framework-light per lib/openui/*'s
 * established rule (no lucide/shadcn/"use client") — the CRM page's LeadCard (Task 14) owns the
 * richer, interactive board-card presentation; this is the chat-surface rendering. */
export function OpportunityCardView(raw: OpportunityViewInput) {
  const props = normalizeOpportunity(raw);
  return React.createElement(
    "div",
    { className: "flex flex-col gap-1" },
    React.createElement("span", { className: "text-sm font-medium" }, props.name),
    React.createElement("span", { className: "text-xs text-muted-foreground" }, `${props.stage} · ${props.tier}`),
    props.amountLabel && React.createElement("span", { className: "text-xs" }, props.amountLabel),
    props.maskedPhone && React.createElement("span", { className: "text-xs text-muted-foreground" }, props.maskedPhone),
    props.source && React.createElement("span", { className: "text-xs text-muted-foreground" }, props.source),
  );
}

const OpportunityCard = defineComponent({
  name: "OpportunityCard",
  description:
    "Displays one CRM opportunity/lead: name, pipeline stage, tier (HOT/WARM/COLD/UNSCORED), a " +
    "pre-formatted amount label, a masked phone number, and source. Args are POSITIONAL in Zod key " +
    "order. Use when the user asks about exactly one specific lead (e.g. \"find Priya Sharma\").",
  props: OpportunitySchema,
  component: ({ props }: { props: OpportunityViewInput }) => React.createElement(OpportunityCardView, props),
});

const OpportunityListSchema = z.object({
  opportunities: z.array(OpportunitySchema).optional().default([]),
});
export type OpportunityListViewInput = { opportunities?: (OpportunityViewInput | null)[] | null };

export function OpportunityListView(raw: OpportunityListViewInput) {
  const opportunities = raw.opportunities ?? [];
  if (opportunities.length === 0) {
    return React.createElement("p", { className: "text-sm text-muted-foreground" }, "No opportunities found.");
  }
  return React.createElement(
    "div",
    { className: "flex flex-col gap-2" },
    ...opportunities.map((o, index) => React.createElement(OpportunityCardView, { key: index, ...(o ?? {}) })),
  );
}

const OpportunityList = defineComponent({
  name: "OpportunityList",
  description:
    "Displays a list of CRM opportunities/leads, each an OpportunityCard. Use for any multi-lead " +
    "answer (e.g. \"show me hot leads from this week\") instead of one OpportunityCard per lead or a " +
    "prose paragraph.",
  props: OpportunityListSchema,
  component: ({ props }: { props: OpportunityListViewInput }) => React.createElement(OpportunityListView, props),
});

const StageChangeConfirmSchema = z.object({
  opportunityName: z.string(),
  fromStage: z.string(),
  toStage: z.string(),
});
export type StageChangeConfirmProps = z.infer<typeof StageChangeConfirmSchema>;
export type StageChangeConfirmViewInput = { [K in keyof StageChangeConfirmProps]?: StageChangeConfirmProps[K] | null };

export function StageChangeConfirmView(raw: StageChangeConfirmViewInput) {
  return React.createElement(
    "div",
    { className: "flex flex-col gap-1 text-sm" },
    React.createElement("span", { className: "font-medium" }, "Confirm action"),
    React.createElement(
      "span",
      { className: "text-muted-foreground" },
      `Move ${raw.opportunityName ?? ""} from ${raw.fromStage ?? ""} → ${raw.toStage ?? ""}`,
    ),
  );
}

const StageChangeConfirm = defineComponent({
  name: "StageChangeConfirm",
  description:
    "Confirms an about-to-happen pipeline stage change before advance_opportunity_stage is called: " +
    "opportunityName, fromStage, toStage. Render this BEFORE calling the mutation, not after.",
  props: StageChangeConfirmSchema,
  component: ({ props }: { props: StageChangeConfirmViewInput }) =>
    React.createElement(StageChangeConfirmView, props),
});

export const crmLibrary = createLibrary({
  components: [OpportunityCard, OpportunityList, StageChangeConfirm] as NonNullable<
    Parameters<typeof createLibrary>[0]["components"]
  >,
});
```

- [ ] **Step 4: Run to verify the library test passes**

Run: `cd ads-agent && npx vitest run lib/openui/crm-library.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing tools test**

```typescript
// ads-agent/lib/openui/crm-tools.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const { listOpportunities, getOpportunity, updateOpportunityStage, logAiAction } = vi.hoisted(() => ({
  listOpportunities: vi.fn(),
  getOpportunity: vi.fn(),
  updateOpportunityStage: vi.fn(),
  logAiAction: vi.fn(),
}));
vi.mock("../crm/twenty-pipeline", () => ({
  listOpportunities,
  getOpportunity,
  updateOpportunityStage,
  PIPELINE_STAGES: [
    { value: "NEW_BRIEF", label: "New Brief" },
    { value: "SHORTLIST", label: "Shortlist" },
  ],
}));
vi.mock("../db/ai-action-log", () => ({ logAiAction }));

import { crmToolProvider, crmToolSpecs } from "./crm-tools";

beforeEach(() => {
  listOpportunities.mockReset();
  getOpportunity.mockReset();
  updateOpportunityStage.mockReset();
  logAiAction.mockReset();
});

describe("crmToolSpecs", () => {
  it("declares the four CRM tools by name", () => {
    expect(crmToolSpecs.map((s) => s.name).sort()).toEqual(
      ["advance_opportunity_stage", "get_opportunity", "list_opportunities", "search_opportunities"].sort(),
    );
  });
});

describe("crmToolProvider.list_opportunities", () => {
  it("returns every opportunity when no filter is given", async () => {
    listOpportunities.mockResolvedValue([{ id: "1", name: "Priya" }]);
    const result = await crmToolProvider.list_opportunities({});
    expect(result).toEqual([{ id: "1", name: "Priya" }]);
  });
});

describe("crmToolProvider.search_opportunities", () => {
  it("filters by case-insensitive name substring", async () => {
    listOpportunities.mockResolvedValue([{ id: "1", name: "Priya Sharma" }, { id: "2", name: "Rohan Mehta" }]);
    const result = await crmToolProvider.search_opportunities({ query: "priya" });
    expect(result).toEqual([{ id: "1", name: "Priya Sharma" }]);
  });
});

describe("crmToolProvider.get_opportunity", () => {
  it("delegates to getOpportunity by id", async () => {
    getOpportunity.mockResolvedValue({ id: "1", name: "Priya" });
    const result = await crmToolProvider.get_opportunity({ id: "1" });
    expect(result).toEqual({ id: "1", name: "Priya" });
    expect(getOpportunity).toHaveBeenCalledWith("1");
  });
});

describe("crmToolProvider.advance_opportunity_stage", () => {
  it("updates the stage and logs an ai_action_log entry on success", async () => {
    updateOpportunityStage.mockResolvedValue({ ok: true });
    const result = await crmToolProvider.advance_opportunity_stage({
      id: "1",
      opportunityName: "Priya Sharma",
      toStage: "SHORTLIST",
    });
    expect(result).toEqual({ ok: true });
    expect(updateOpportunityStage).toHaveBeenCalledWith("1", "SHORTLIST");
    expect(logAiAction).toHaveBeenCalledWith({ domain: "crm", summary: "Advanced Priya Sharma to Shortlist" });
  });

  it("does not log when the update fails", async () => {
    updateOpportunityStage.mockResolvedValue({ ok: false, error: "boom" });
    const result = await crmToolProvider.advance_opportunity_stage({
      id: "1",
      opportunityName: "Priya Sharma",
      toStage: "SHORTLIST",
    });
    expect(result).toEqual({ ok: false, error: "boom" });
    expect(logAiAction).not.toHaveBeenCalled();
  });

  it("rejects an unknown stage value rather than calling updateOpportunityStage", async () => {
    const result = await crmToolProvider.advance_opportunity_stage({
      id: "1",
      opportunityName: "Priya Sharma",
      toStage: "NOT_A_REAL_STAGE",
    });
    expect(result).toEqual({ ok: false, error: expect.stringContaining("unknown stage") });
    expect(updateOpportunityStage).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `cd ads-agent && npx vitest run lib/openui/crm-tools.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 7: Implement `crm-tools.ts`**

```typescript
// ads-agent/lib/openui/crm-tools.ts
import type { ToolSpec } from "@openuidev/lang-core";
import { getOpportunity, listOpportunities, updateOpportunityStage, PIPELINE_STAGES } from "../crm/twenty-pipeline";
import { logAiAction } from "../db/ai-action-log";
import type { ToolProviderMap } from "./platform-tools";

const STAGE_LABELS = new Map(PIPELINE_STAGES.map((s) => [s.value, s.label] as const));

export const crmToolProvider: ToolProviderMap = {
  list_opportunities: async () => listOpportunities(),
  search_opportunities: async (args: Record<string, unknown>) => {
    const query = String(args.query ?? "").toLowerCase();
    const all = await listOpportunities();
    if (!query) return all;
    return all.filter((o: { name: string }) => o.name.toLowerCase().includes(query));
  },
  get_opportunity: async (args: Record<string, unknown>) => getOpportunity(String(args.id ?? "")),
  advance_opportunity_stage: async (args: Record<string, unknown>) => {
    const id = String(args.id ?? "");
    const opportunityName = String(args.opportunityName ?? "");
    const toStage = String(args.toStage ?? "");
    const label = STAGE_LABELS.get(toStage as (typeof PIPELINE_STAGES)[number]["value"]);
    if (!label) return { ok: false, error: `unknown stage "${toStage}"` };

    const result = await updateOpportunityStage(id, toStage as (typeof PIPELINE_STAGES)[number]["value"]);
    if (result.ok) {
      await logAiAction({ domain: "crm", summary: `Advanced ${opportunityName} to ${label}` });
    }
    return result;
  },
};

export const crmToolSpecs: ToolSpec[] = [
  {
    name: "list_opportunities",
    description: "List every open CRM opportunity/lead across all pipeline stages.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "search_opportunities",
    description: "Search CRM opportunities/leads by a case-insensitive name substring.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "Name substring to search for" } },
      required: ["query"],
    },
  },
  {
    name: "get_opportunity",
    description: "Get one CRM opportunity/lead by its exact id.",
    parameters: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "advance_opportunity_stage",
    description:
      `Move an opportunity to a new pipeline stage. Valid toStage values: ${PIPELINE_STAGES.map((s) => s.value).join(", ")}. ` +
      "ALWAYS render StageChangeConfirm first and wait for the user's explicit confirmation before calling this.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string" },
        opportunityName: { type: "string", description: "Human-readable name, for the ai_action_log summary" },
        toStage: { type: "string" },
      },
      required: ["id", "opportunityName", "toStage"],
    },
  },
];
```

- [ ] **Step 8: Run to verify it passes**

Run: `cd ads-agent && npx vitest run lib/openui/crm-tools.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add ads-agent/lib/openui/crm-library.ts ads-agent/lib/openui/crm-library.test.ts ads-agent/lib/openui/crm-tools.ts ads-agent/lib/openui/crm-tools.test.ts
git commit -m "feat(ads-agent): implement Spec 3 CRM OpenUI library + tools"
```

---

### Task 10: `lib/openui/{analytics-library,analytics-tools}.ts` — Spec 2

**Files:**
- Create: `ads-agent/lib/openui/analytics-library.ts`
- Test: `ads-agent/lib/openui/analytics-library.test.ts`
- Create: `ads-agent/lib/openui/analytics-tools.ts`
- Test: `ads-agent/lib/openui/analytics-tools.test.ts`

**Interfaces:**
- Consumes: `listCampaignsWithLatestCpl`/`getSpendCplTrend`/`getOverviewStats` from `../db/dashboard`,
  `listProposals` from `../db/proposals`, `StatCard` from `./shared-metric-cards` (imported, not
  redefined, per the foundation spec's ownership correction).
- Produces: `analyticsLibrary` (Library: `TrendChart`, `DataTable`), `analyticsToolProvider`,
  `analyticsToolSpecs: ToolSpec[]` — consumed by Task 11 (composition) and Task 15 (Reports chat route).

- [ ] **Step 1: Write the failing library test**

```typescript
// ads-agent/lib/openui/analytics-library.test.ts
import { describe, expect, it } from "vitest";
import { TrendChartView, DataTableView, analyticsLibrary } from "./analytics-library";

describe("analyticsLibrary", () => {
  it("registers TrendChart and DataTable", () => {
    expect(Object.keys(analyticsLibrary.components).sort()).toEqual(["DataTable", "TrendChart"].sort());
  });
});

describe("TrendChartView", () => {
  it("renders every point's label", () => {
    const tree = TrendChartView({
      title: "CPL trend",
      points: [{ label: "Google", value: 142 }, { label: "Meta", value: 188 }],
    });
    const json = JSON.stringify(tree);
    expect(json).toContain("Google");
    expect(json).toContain("Meta");
    expect(json).toContain("CPL trend");
  });
});

describe("DataTableView", () => {
  it("renders headers and every row's cells", () => {
    const tree = DataTableView({
      headers: ["Campaign", "Spend"],
      rows: [{ cells: ["Whitefield HSR Launch", "₹15,000"] }],
    });
    const json = JSON.stringify(tree);
    expect(json).toContain("Campaign");
    expect(json).toContain("Whitefield HSR Launch");
  });

  it("renders an empty-state message for zero rows", () => {
    const tree = DataTableView({ headers: ["A"], rows: [] });
    expect(JSON.stringify(tree)).toContain("No data");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd ads-agent && npx vitest run lib/openui/analytics-library.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `analytics-library.ts`**

```typescript
// ads-agent/lib/openui/analytics-library.ts
import { createLibrary, defineComponent } from "@openuidev/lang-core";
import React from "react";
import { z } from "zod";

const TrendPointSchema = z.object({ label: z.string(), value: z.number() });
const TrendChartSchema = z.object({
  title: z.string(),
  points: z.array(TrendPointSchema).optional().default([]),
});
export type TrendChartProps = z.infer<typeof TrendChartSchema>;
export type TrendChartViewInput = { title?: string | null; points?: ({ label?: string | null; value?: number | null } | null)[] | null };

/** Framework-light bar rendering (plain divs, no recharts import here) — matches lib/openui/*'s
 * no-shadcn/framework-light rule. Task 15's Reports page renders the richer recharts version for the
 * deterministic path; this is the chat-surface rendering, same split as OpportunityCard/LeadCard. */
export function TrendChartView(raw: TrendChartViewInput) {
  const points = (raw.points ?? []).map((p) => ({ label: p?.label ?? "", value: p?.value ?? 0 }));
  const max = Math.max(1, ...points.map((p) => p.value));
  return React.createElement(
    "div",
    { className: "flex flex-col gap-2" },
    React.createElement("span", { className: "text-sm font-medium" }, raw.title ?? ""),
    React.createElement(
      "div",
      { className: "flex items-end gap-3" },
      ...points.map((p, i) =>
        React.createElement(
          "div",
          { key: i, className: "flex flex-col items-center gap-1" },
          React.createElement("div", {
            className: "w-6 rounded-t bg-primary",
            style: { height: `${Math.max(4, (p.value / max) * 80)}px` },
          }),
          React.createElement("span", { className: "text-xs text-muted-foreground" }, p.label),
        ),
      ),
    ),
  );
}

const TrendChart = defineComponent({
  name: "TrendChart",
  description:
    "Displays a small bar chart: a title and a list of {label, value} points. Use for any " +
    "trend/comparison question (e.g. \"compare CPL by platform this week\").",
  props: TrendChartSchema,
  component: ({ props }: { props: TrendChartViewInput }) => React.createElement(TrendChartView, props),
});

const DataTableSchema = z.object({
  headers: z.array(z.string()).optional().default([]),
  rows: z.array(z.object({ cells: z.array(z.string()).optional().default([]) })).optional().default([]),
});
export type DataTableViewInput = {
  headers?: (string | null)[] | null;
  rows?: ({ cells?: (string | null)[] | null } | null)[] | null;
};

export function DataTableView(raw: DataTableViewInput) {
  const headers = (raw.headers ?? []).map((h) => h ?? "");
  const rows = (raw.rows ?? []).map((r) => (r?.cells ?? []).map((c) => c ?? ""));
  if (rows.length === 0) {
    return React.createElement("p", { className: "text-sm text-muted-foreground" }, "No data for that question.");
  }
  return React.createElement(
    "table",
    { className: "w-full text-sm" },
    React.createElement(
      "thead",
      null,
      React.createElement(
        "tr",
        null,
        ...headers.map((h, i) => React.createElement("th", { key: i, className: "text-left text-xs text-muted-foreground" }, h)),
      ),
    ),
    React.createElement(
      "tbody",
      null,
      ...rows.map((row, i) =>
        React.createElement(
          "tr",
          { key: i },
          ...row.map((cell, j) => React.createElement("td", { key: j, className: "py-1" }, cell)),
        ),
      ),
    ),
  );
}

const DataTable = defineComponent({
  name: "DataTable",
  description:
    "Displays tabular data: headers (string[]) and rows (each { cells: string[] }). Use for any " +
    "list-of-records question (e.g. \"top campaigns by spend\") — cells are pre-formatted strings, " +
    "this component does no number formatting itself.",
  props: DataTableSchema,
  component: ({ props }: { props: DataTableViewInput }) => React.createElement(DataTableView, props),
});

export const analyticsLibrary = createLibrary({
  components: [TrendChart, DataTable] as NonNullable<Parameters<typeof createLibrary>[0]["components"]>,
});
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd ads-agent && npx vitest run lib/openui/analytics-library.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing tools test**

```typescript
// ads-agent/lib/openui/analytics-tools.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getSpendCplTrend, listCampaignsWithLatestCpl, listProposals } = vi.hoisted(() => ({
  getSpendCplTrend: vi.fn(),
  listCampaignsWithLatestCpl: vi.fn(),
  listProposals: vi.fn(),
}));
vi.mock("../db/dashboard", () => ({ getSpendCplTrend, listCampaignsWithLatestCpl }));
vi.mock("../db/proposals", () => ({ listProposals }));

import { analyticsToolProvider, analyticsToolSpecs } from "./analytics-tools";

beforeEach(() => {
  getSpendCplTrend.mockReset();
  listCampaignsWithLatestCpl.mockReset();
  listProposals.mockReset();
});

describe("analyticsToolSpecs", () => {
  it("declares the three analytics tools by name", () => {
    expect(analyticsToolSpecs.map((s) => s.name).sort()).toEqual(
      ["get_spend_cpl_trend", "list_campaigns_with_cpl", "list_pending_proposals"].sort(),
    );
  });
});

describe("analyticsToolProvider.get_spend_cpl_trend", () => {
  it("defaults to 7 days when no days arg is given", async () => {
    getSpendCplTrend.mockResolvedValue([{ date: "2026-08-01", spendInr: 1000, cplInr: 100 }]);
    const result = await analyticsToolProvider.get_spend_cpl_trend({});
    expect(getSpendCplTrend).toHaveBeenCalledWith(7);
    expect(result).toEqual([{ date: "2026-08-01", spendInr: 1000, cplInr: 100 }]);
  });

  it("uses the given days arg", async () => {
    getSpendCplTrend.mockResolvedValue([]);
    await analyticsToolProvider.get_spend_cpl_trend({ days: 30 });
    expect(getSpendCplTrend).toHaveBeenCalledWith(30);
  });
});

describe("analyticsToolProvider.list_campaigns_with_cpl", () => {
  it("delegates to listCampaignsWithLatestCpl", async () => {
    listCampaignsWithLatestCpl.mockResolvedValue([{ id: "1" }]);
    expect(await analyticsToolProvider.list_campaigns_with_cpl({})).toEqual([{ id: "1" }]);
  });
});

describe("analyticsToolProvider.list_pending_proposals", () => {
  it("delegates to listProposals with status='pending'", async () => {
    listProposals.mockResolvedValue([{ id: "1" }]);
    expect(await analyticsToolProvider.list_pending_proposals({})).toEqual([{ id: "1" }]);
    expect(listProposals).toHaveBeenCalledWith("pending");
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `cd ads-agent && npx vitest run lib/openui/analytics-tools.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 7: Implement `analytics-tools.ts`**

```typescript
// ads-agent/lib/openui/analytics-tools.ts
import type { ToolSpec } from "@openuidev/lang-core";
import { getSpendCplTrend, listCampaignsWithLatestCpl } from "../db/dashboard";
import { listProposals } from "../db/proposals";
import type { ToolProviderMap } from "./platform-tools";

export const analyticsToolProvider: ToolProviderMap = {
  get_spend_cpl_trend: async (args: Record<string, unknown>) => {
    const days = typeof args.days === "number" ? args.days : 7;
    return getSpendCplTrend(days);
  },
  list_campaigns_with_cpl: async () => listCampaignsWithLatestCpl(),
  list_pending_proposals: async () => listProposals("pending"),
};

export const analyticsToolSpecs: ToolSpec[] = [
  {
    name: "get_spend_cpl_trend",
    description: "Get the daily spend/CPL trend for the last N days (default 7).",
    parameters: {
      type: "object",
      properties: { days: { type: "number", description: "Number of days back, default 7" } },
      required: [],
    },
  },
  {
    name: "list_campaigns_with_cpl",
    description: "List every campaign with its platform, status, daily budget, corridor, and latest CPL.",
    parameters: { type: "object", properties: {}, required: [] },
  },
  {
    name: "list_pending_proposals",
    description: "List every proposal currently awaiting human approval.",
    parameters: { type: "object", properties: {}, required: [] },
  },
];
```

- [ ] **Step 8: Run to verify it passes**

Run: `cd ads-agent && npx vitest run lib/openui/analytics-tools.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add ads-agent/lib/openui/analytics-library.ts ads-agent/lib/openui/analytics-library.test.ts ads-agent/lib/openui/analytics-tools.ts ads-agent/lib/openui/analytics-tools.test.ts
git commit -m "feat(ads-agent): implement Spec 2 analytics OpenUI library + tools"
```

---

### Task 11: `platform-library.ts`/`platform-tools.ts` composition update

**Files:**
- Modify: `ads-agent/lib/openui/platform-library.ts`
- Modify: `ads-agent/lib/openui/platform-tools.ts`
- Modify: `ads-agent/lib/openui/platform-library.test.ts`
- Modify: `ads-agent/lib/openui/platform-tools.test.ts`

**Interfaces:**
- Consumes: Task 9's `crmLibrary`/`crmToolProvider`/`crmToolSpecs`, Task 10's `analyticsLibrary`/
  `analyticsToolProvider`/`analyticsToolSpecs`.
- Produces: `platformLibrary` now including CRM + analytics components; `platformToolProvider`/
  `platformToolSpecs` now including CRM + analytics tools — consumed by the global Copilot
  (`CopilotPanel.tsx`, unchanged file, already imports these two exports generically).

- [ ] **Step 1: Update the failing tests first**

```typescript
// ads-agent/lib/openui/platform-library.test.ts — add these assertions to the existing describe block
it("includes CRM and analytics components alongside campaign and shared ones", () => {
  const names = Object.keys(platformLibrary.components);
  expect(names).toContain("SetupCard");
  expect(names).toContain("StatCard");
  expect(names).toContain("OpportunityCard");
  expect(names).toContain("OpportunityList");
  expect(names).toContain("StageChangeConfirm");
  expect(names).toContain("TrendChart");
  expect(names).toContain("DataTable");
});
```

```typescript
// ads-agent/lib/openui/platform-tools.test.ts — replace the existing "ships with zero entries" style
// assertions (if any) with:
it("includes every CRM and analytics tool", () => {
  const names = platformToolSpecs.map((s) => s.name);
  expect(names).toContain("list_opportunities");
  expect(names).toContain("advance_opportunity_stage");
  expect(names).toContain("get_spend_cpl_trend");
  expect(platformToolProvider.list_opportunities).toBeDefined();
  expect(platformToolProvider.get_spend_cpl_trend).toBeDefined();
});

it("throws on a tool name collision across domains", () => {
  expect(() => composeToolSpecs([{ name: "dup", description: "a", parameters: { type: "object", properties: {}, required: [] } }], [{ name: "dup", description: "b", parameters: { type: "object", properties: {}, required: [] } }])).toThrow(/duplicate/);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `cd ads-agent && npx vitest run lib/openui/platform-library.test.ts lib/openui/platform-tools.test.ts`
Expected: FAIL — `platformLibrary`/`platformToolSpecs` don't include CRM/analytics yet.

- [ ] **Step 3: Update `platform-library.ts`**

```typescript
// ads-agent/lib/openui/platform-library.ts
import { createLibrary } from "@openuidev/lang-core";
import { campaignLibrary } from "./campaign-library";
import { crmLibrary } from "./crm-library";
import { analyticsLibrary } from "./analytics-library";
import { sharedLibrary } from "./shared-library";

type LibraryComponents = NonNullable<Parameters<typeof createLibrary>[0]["components"]>;

/** The global Copilot's composed component registry — every domain library's components plus the
 * shared ones. Now includes crmLibrary (Spec 3, Task 9) and analyticsLibrary (Spec 2, Task 10), added
 * per the foundation spec's own documented migration path (one line each, unchanged composition
 * shape from before). Embedded per-page chats (Campaign Chat, CRM Assistant, Reports) keep using
 * their own narrower domain-only library, unaffected by this composition. */
export const platformLibrary = createLibrary({
  components: [
    ...Object.values(campaignLibrary.components),
    ...Object.values(crmLibrary.components),
    ...Object.values(analyticsLibrary.components),
    ...Object.values(sharedLibrary.components),
  ] as LibraryComponents,
});
```

- [ ] **Step 4: Update `platform-tools.ts`**

```typescript
// ads-agent/lib/openui/platform-tools.ts
import type { ToolSpec } from "@openuidev/lang-core";
import { crmToolProvider, crmToolSpecs } from "./crm-tools";
import { analyticsToolProvider, analyticsToolSpecs } from "./analytics-tools";

export type ToolProviderMap = Record<string, (args: Record<string, unknown>) => Promise<unknown>>;

export function composeToolProviders(...providers: ToolProviderMap[]): ToolProviderMap {
  const merged: ToolProviderMap = {};
  for (const provider of providers) {
    for (const [name, fn] of Object.entries(provider)) {
      if (name in merged) throw new Error(`platform-tools: duplicate tool name "${name}" across domains`);
      merged[name] = fn;
    }
  }
  return merged;
}

export function composeToolSpecs(...specLists: ToolSpec[][]): ToolSpec[] {
  const merged: ToolSpec[] = [];
  const seen = new Set<string>();
  for (const specs of specLists) {
    for (const spec of specs) {
      if (seen.has(spec.name)) throw new Error(`platform-tools: duplicate tool spec name "${spec.name}" across domains`);
      seen.add(spec.name);
      merged.push(spec);
    }
  }
  return merged;
}

/**
 * The global Copilot's composed tool registry. Now merges crmToolProvider/crmToolSpecs (Spec 3,
 * Task 9) and analyticsToolProvider/analyticsToolSpecs (Spec 2, Task 10) — Spec 1's Campaign Chat
 * still has no ToolSpec/ToolProvider (unchanged finding from the foundation plan), so no campaign
 * entry exists here yet; add one the same way if/when Campaign Chat gets live tool calls.
 */
export const platformToolProvider: ToolProviderMap = composeToolProviders(crmToolProvider, analyticsToolProvider);
export const platformToolSpecs: ToolSpec[] = composeToolSpecs(crmToolSpecs, analyticsToolSpecs);
```

Note: `crm-tools.ts`/`analytics-tools.ts` (Tasks 9-10) import `ToolProviderMap` from this same
`platform-tools.ts` file — a forward reference that works at the type level (TypeScript type-only import
has no runtime circularity) but **verify no runtime circular-import issue** by running the full test
suite in Step 5 below, not just this file's own tests.

- [ ] **Step 5: Run to verify everything passes**

Run: `cd ads-agent && npx vitest run lib/openui/`
Expected: PASS across every `lib/openui/*.test.ts` file, including Tasks 9-10's own tests re-run
alongside this change (confirms no circular-import breakage).

- [ ] **Step 6: Commit**

```bash
git add ads-agent/lib/openui/platform-library.ts ads-agent/lib/openui/platform-tools.ts ads-agent/lib/openui/platform-library.test.ts ads-agent/lib/openui/platform-tools.test.ts
git commit -m "feat(ads-agent): compose CRM + analytics libraries/tools into the global Copilot"
```

---

### Task 12: Home page

**Files:**
- Modify: `ads-agent/app/(admin)/page.tsx`

**Interfaces:**
- Consumes: `getOverviewStats` from `@/lib/db/dashboard` (existing), `fetchLeadSignal` from
  `@/lib/connectors/twenty` (existing), Task 3's `getPipelineValue`, Task 4's `countAiActionsToday`/
  `listRecentAiActions`, `StatCardView`/`StatCardViewInput` from `@/lib/openui/shared-metric-cards`
  (existing, foundation plan).
- Produces: the restyled Home page — no other task depends on this file's exports (it's a page, not a
  library).

This page has no independent test — it's a thin server component composing already-tested functions,
matching this repo's existing convention (`campaigns/page.tsx` has no test file either). Verified
manually in Task 17.

- [ ] **Step 1: Read the current page for its exact existing structure**

Read `ads-agent/app/(admin)/page.tsx` before editing — confirm the exact current shape (this plan was
scoped against it during writing; re-confirm nothing else changed it since).

- [ ] **Step 2: Rewrite the page**

```typescript
// ads-agent/app/(admin)/page.tsx
import { ForbiddenNotice } from "@/components/ForbiddenNotice";
import { requireRole } from "@/lib/auth/dal";
import { getOverviewStats } from "@/lib/db/dashboard";
import { countAiActionsToday, listRecentAiActions } from "@/lib/db/ai-action-log";
import { fetchLeadSignal } from "@/lib/connectors/twenty";
import { getPipelineValue } from "@/lib/crm/twenty-pipeline";
import { StatCardView } from "@/lib/openui/shared-metric-cards";

function formatInr(value: number): string {
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

export default async function HomePage() {
  const access = await requireRole("viewer");
  if (!access.ok) return <ForbiddenNotice />;

  const [overview, leadSignal, pipelineValueInr, aiActionsToday, recentActions] = await Promise.all([
    getOverviewStats(),
    fetchLeadSignal(),
    getPipelineValue(),
    countAiActionsToday(),
    listRecentAiActions(5),
  ]);

  const marketingActivity = recentActions.find((a) => a.domain === "marketing");
  const crmActivity = recentActions.find((a) => a.domain === "crm");

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">Good morning</h1>
        <p className="text-sm text-muted-foreground">
          Here&apos;s what&apos;s moving across marketing, leads, and pipeline today.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCardView label="Active Campaigns" value={String(overview.activeCampaignCount)} />
        <StatCardView label="Hot Leads (7d)" value={String(leadSignal.hotCount)} />
        <StatCardView label="Pipeline Value" value={formatInr(pipelineValueInr)} />
        <StatCardView label="AI Actions Today" value={String(aiActionsToday)} />
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-foreground">Recent AI activity</h2>
        {recentActions.length === 0 ? (
          <p className="rounded-lg bg-surface p-4 text-sm text-muted-foreground">
            No automated actions yet.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg bg-surface p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Marketing</p>
              <p className="mt-1 text-sm text-foreground">
                {marketingActivity?.summary ?? "No marketing automation activity yet."}
              </p>
            </div>
            <div className="rounded-lg bg-surface p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Leads & CRM</p>
              <p className="mt-1 text-sm text-foreground">
                {crmActivity?.summary ?? "No CRM activity yet."}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

Note: quick-action chips that pre-seed the global Copilot (`seedAndOpen()`, per `CopilotProvider.tsx`'s
existing API) are a small Client Component addition — deliberately **not included** in this task to
keep it server-only and independently testable-by-inspection; if wanted, add a small
`HomeQuickActions.tsx` Client Component calling `useCopilot().seedAndOpen(question)` per button as a
follow-up, not fabricated here without a real caller to verify against.

- [ ] **Step 3: Manual verification**

Run: `cd ads-agent && npm run dev`, sign in, visit `/`. Confirm 4 stat cards render real numbers (0 is
fine if there's no seed data), "Recent AI activity" shows its empty-state text on a fresh DB, and after
running `npm run migrate` + triggering a decision cycle that creates a proposal (or seeding one), the
Marketing card updates.

- [ ] **Step 4: Commit**

```bash
git add "ads-agent/app/(admin)/page.tsx"
git commit -m "feat(ads-agent): restyle Home with live Pencil stat cards and AI activity feed"
```

---

### Task 13: Marketing Automation page + status route + TabStrip wiring

**Files:**
- Modify: `ads-agent/app/(admin)/campaigns/page.tsx`
- Modify: `ads-agent/app/(admin)/proposals/page.tsx`
- Create: `ads-agent/app/api/campaigns/[id]/status/route.ts`
- Test: `ads-agent/app/api/campaigns/[id]/status/route.test.ts`

**Interfaces:**
- Consumes: Task 6's `KanbanBoard`, Task 5's `StatusPill`, Task 8's `TabStrip`, existing
  `listCampaignsWithLatestCpl`/`updateCampaignStatus` from `@/lib/db/{dashboard,campaigns}`.
- Produces: nothing consumed by a later task (leaf page + route).

- [ ] **Step 1: Verify the current Next.js route-handler `params` convention for this installed version**

Read `node_modules/next/dist/docs/` (per `AGENTS.md`'s binding instruction — this repo's Next.js has
breaking changes vs. training-data conventions) for how a `[id]` dynamic route handler receives
`params` in Next 15.5.21 before writing Step 4 below; adjust the signature if it differs from the
`Promise<{ id: string }>` assumed here.

- [ ] **Step 2: Write the failing route test**

```typescript
// ads-agent/app/api/campaigns/[id]/status/route.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireApiRole, updateCampaignStatus } = vi.hoisted(() => ({
  requireApiRole: vi.fn(),
  updateCampaignStatus: vi.fn(),
}));
vi.mock("@/lib/auth/dal", () => ({ requireApiRole }));
vi.mock("@/lib/db/campaigns", () => ({ updateCampaignStatus }));

import { PATCH } from "./route";

beforeEach(() => {
  requireApiRole.mockReset();
  updateCampaignStatus.mockReset();
});

function req(body: unknown) {
  return new Request("http://localhost/api/campaigns/c1/status", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/campaigns/[id]/status", () => {
  it("updates status and returns ok:true for an authorized operator", async () => {
    requireApiRole.mockResolvedValue({ ok: true, session: {} });
    updateCampaignStatus.mockResolvedValue(undefined);

    const res = await PATCH(req({ status: "active" }), { params: Promise.resolve({ id: "c1" }) });

    expect(updateCampaignStatus).toHaveBeenCalledWith("c1", "active");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("returns the requireApiRole response for an unauthorized caller", async () => {
    const forbidden = new Response(null, { status: 403 });
    requireApiRole.mockResolvedValue({ ok: false, response: forbidden });

    const res = await PATCH(req({ status: "active" }), { params: Promise.resolve({ id: "c1" }) });

    expect(res).toBe(forbidden);
    expect(updateCampaignStatus).not.toHaveBeenCalled();
  });

  it("rejects an invalid status value with 400", async () => {
    requireApiRole.mockResolvedValue({ ok: true, session: {} });

    const res = await PATCH(req({ status: "not-a-status" }), { params: Promise.resolve({ id: "c1" }) });

    expect(res.status).toBe(400);
    expect(updateCampaignStatus).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd ads-agent && npx vitest run app/api/campaigns`
Expected: FAIL — route does not exist.

- [ ] **Step 4: Implement the route**

```typescript
// ads-agent/app/api/campaigns/[id]/status/route.ts
import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth/dal";
import { updateCampaignStatus } from "@/lib/db/campaigns";
import type { CampaignStatus } from "@/lib/types";

const VALID_STATUSES: CampaignStatus[] = ["proposed", "active", "paused", "removed"];

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireApiRole("operator");
  if (!access.ok) return access.response;

  const { id } = await params;
  const { status } = (await req.json()) as { status?: string };
  if (!status || !VALID_STATUSES.includes(status as CampaignStatus)) {
    return NextResponse.json({ error: "status must be one of proposed, active, paused, removed" }, { status: 400 });
  }

  await updateCampaignStatus(id, status as CampaignStatus);
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd ads-agent && npx vitest run app/api/campaigns`
Expected: PASS.

- [ ] **Step 6: Rewrite the Marketing Automation page**

```typescript
// ads-agent/app/(admin)/campaigns/page.tsx
import Link from "next/link";
import { Plus } from "lucide-react";
import { ForbiddenNotice } from "@/components/ForbiddenNotice";
import { requireRole } from "@/lib/auth/dal";
import { listCampaignsWithLatestCpl } from "@/lib/db/dashboard";
import type { CampaignWithCplRow } from "@/lib/db/dashboard";
import { Button } from "@/components/ui/button";
import { KanbanBoard } from "@/components/pencil/KanbanBoard";
import { KanbanCard } from "@/components/pencil/KanbanCard";
import { StatusPill } from "@/components/pencil/StatusPill";
import { TabStrip } from "@/components/pencil/TabStrip";

const MARKETING_TABS = [
  { href: "/campaigns", label: "Board" },
  { href: "/proposals", label: "Proposals" },
];

// "Draft" is a display label only over the existing "proposed" DB value — CampaignStatus has no
// "draft" enum value (see plan's Global Constraints); no schema change.
const COLUMN_LABELS: Record<CampaignWithCplRow["status"], string> = {
  proposed: "Draft",
  active: "Active",
  paused: "Paused",
  removed: "Removed",
};
const BOARD_STATUSES: CampaignWithCplRow["status"][] = ["proposed", "active", "paused"];

function formatInr(value: number | null): string {
  if (value === null) return "—";
  return `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function CampaignCard({ campaign }: { campaign: CampaignWithCplRow }) {
  return (
    <KanbanCard>
      <div className="flex items-center justify-between">
        <span className="text-xs capitalize text-muted-foreground">{campaign.platform}</span>
        <StatusPill tone={campaign.status === "active" ? "active" : campaign.status === "paused" ? "paused" : "draft"} label={campaign.status} />
      </div>
      <span className="font-medium text-foreground">{campaign.name}</span>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Budget: {formatInr(campaign.dailyBudget)}</span>
        <span>CPL: {formatInr(campaign.latestCplInr)}</span>
      </div>
    </KanbanCard>
  );
}

export default async function CampaignsPage() {
  const access = await requireRole("operator");
  if (!access.ok) return <ForbiddenNotice />;

  const campaigns = await listCampaignsWithLatestCpl();
  const columns = BOARD_STATUSES.map((status) => ({
    key: status,
    label: COLUMN_LABELS[status],
    cards: campaigns
      .filter((c) => c.status === status)
      .map((c) => ({ id: c.id, node: <CampaignCard key={c.id} campaign={c} /> })),
  }));

  return (
    <div className="flex flex-col gap-4">
      <TabStrip tabs={MARKETING_TABS} />
      <div className="flex justify-end">
        <Button asChild size="sm">
          <Link href="/campaigns/new">
            <Plus />
            New Campaign
          </Link>
        </Button>
      </div>
      {campaigns.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          No campaigns yet. Proposals will appear here once the decision engine creates one.
        </p>
      ) : (
        <KanbanBoard columns={columns} />
      )}
    </div>
  );
}
```

Note: drag-to-column (the actual cross-column status mutation calling
`PATCH /api/campaigns/[id]/status`) needs a small Client Component wrapper around each `CampaignCard`
(HTML5 `draggable`/`onDragEnd`, per `KanbanBoard.tsx`'s own doc comment that cross-column moves are a
page-level concern) — deliberately scoped as a **follow-up** to keep this task's diff reviewable and
because it needs real manual drag-testing in a browser that a Vitest unit test can't exercise
meaningfully; the route (Steps 2-5 above) is fully built and tested so that follow-up is a thin
UI-only addition, not new backend work.

- [ ] **Step 7: Add the same `TabStrip` to the Proposals page**

```typescript
// ads-agent/app/(admin)/proposals/page.tsx — add these two lines near the top of the JSX return,
// immediately inside the existing outermost <div>, without changing anything else in this file:
import { TabStrip } from "@/components/pencil/TabStrip";

const MARKETING_TABS = [
  { href: "/campaigns", label: "Board" },
  { href: "/proposals", label: "Proposals" },
];

// ...then as the first child of the existing return's outer <div className="flex flex-col gap-4">:
<TabStrip tabs={MARKETING_TABS} />
```

Read the actual current file before editing to place this correctly — do not restructure anything else
in `proposals/page.tsx`.

- [ ] **Step 8: Manual verification**

Run: `cd ads-agent && npm run dev`; visit `/campaigns`, confirm three columns (Draft/Active/Paused) with
real campaign cards, the tab strip switches to `/proposals` and back, and "New Campaign" still works.

- [ ] **Step 9: Commit**

```bash
git add "ads-agent/app/(admin)/campaigns/page.tsx" "ads-agent/app/(admin)/proposals/page.tsx" ads-agent/app/api/campaigns
git commit -m "feat(ads-agent): rebuild Marketing Automation as a Kanban board + status route"
```

---

### Task 14: Leads & CRM page + stage route + CRM chat route

**Files:**
- Create: `ads-agent/app/(admin)/crm/page.tsx`
- Create: `ads-agent/app/api/crm/opportunities/[id]/stage/route.ts`
- Test: `ads-agent/app/api/crm/opportunities/[id]/stage/route.test.ts`
- Create: `ads-agent/lib/decision-engine/crm-chat.ts`
- Test: `ads-agent/lib/decision-engine/crm-chat.test.ts`
- Create: `ads-agent/app/api/crm/chat/route.ts`
- Create: `ads-agent/components/CrmAssistantPanel.tsx`

**Interfaces:**
- Consumes: Task 3's `listOpportunities`/`updateOpportunityStage`/`PIPELINE_STAGES`, Task 6's
  `KanbanBoard`/`KanbanCard`, Task 5's `StatusPill`, Task 7's `SideAssistantPanel`, Task 9's
  `crmLibrary`/`crmToolProvider`, `parseWithBoundedRetry` from `../openui/parse-retry`,
  `streamChatCompletion`/`callMeteredStreamingChatCompletion` (existing, same as `copilot-chat.ts`).
- Produces: nothing consumed by a later task (leaf page + routes).

- [ ] **Step 1: Write the failing stage-route test**

```typescript
// ads-agent/app/api/crm/opportunities/[id]/stage/route.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireApiRole, updateOpportunityStage, logAiAction } = vi.hoisted(() => ({
  requireApiRole: vi.fn(),
  updateOpportunityStage: vi.fn(),
  logAiAction: vi.fn(),
}));
vi.mock("@/lib/auth/dal", () => ({ requireApiRole }));
vi.mock("@/lib/crm/twenty-pipeline", () => ({ updateOpportunityStage }));
vi.mock("@/lib/db/ai-action-log", () => ({ logAiAction }));

import { PATCH } from "./route";

beforeEach(() => {
  requireApiRole.mockReset();
  updateOpportunityStage.mockReset();
  logAiAction.mockReset();
});

function req(body: unknown) {
  return new Request("http://localhost/api/crm/opportunities/opp-1/stage", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/crm/opportunities/[id]/stage", () => {
  it("updates the stage, logs an ai_action_log row, and returns ok:true", async () => {
    requireApiRole.mockResolvedValue({ ok: true, session: {} });
    updateOpportunityStage.mockResolvedValue({ ok: true });

    const res = await PATCH(req({ toStage: "TOUR", opportunityName: "Priya Sharma" }), {
      params: Promise.resolve({ id: "opp-1" }),
    });

    expect(updateOpportunityStage).toHaveBeenCalledWith("opp-1", "TOUR");
    expect(logAiAction).toHaveBeenCalledWith({ domain: "crm", summary: "Advanced Priya Sharma to Tour" });
    expect(res.status).toBe(200);
  });

  it("returns 502 with the Twenty error when the update fails, without logging", async () => {
    requireApiRole.mockResolvedValue({ ok: true, session: {} });
    updateOpportunityStage.mockResolvedValue({ ok: false, error: "Twenty down" });

    const res = await PATCH(req({ toStage: "TOUR", opportunityName: "Priya Sharma" }), {
      params: Promise.resolve({ id: "opp-1" }),
    });

    expect(res.status).toBe(502);
    expect(logAiAction).not.toHaveBeenCalled();
  });

  it("rejects a stage value not in PIPELINE_STAGES with 400", async () => {
    requireApiRole.mockResolvedValue({ ok: true, session: {} });

    const res = await PATCH(req({ toStage: "NOT_REAL", opportunityName: "X" }), {
      params: Promise.resolve({ id: "opp-1" }),
    });

    expect(res.status).toBe(400);
    expect(updateOpportunityStage).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd ads-agent && npx vitest run app/api/crm/opportunities`
Expected: FAIL — route does not exist.

- [ ] **Step 3: Implement the stage route**

```typescript
// ads-agent/app/api/crm/opportunities/[id]/stage/route.ts
import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth/dal";
import { updateOpportunityStage, PIPELINE_STAGES, type PipelineStageValue } from "@/lib/crm/twenty-pipeline";
import { logAiAction } from "@/lib/db/ai-action-log";

const STAGE_LABELS = new Map(PIPELINE_STAGES.map((s) => [s.value, s.label] as const));

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireApiRole("operator");
  if (!access.ok) return access.response;

  const { id } = await params;
  const { toStage, opportunityName } = (await req.json()) as { toStage?: string; opportunityName?: string };
  const label = toStage ? STAGE_LABELS.get(toStage as PipelineStageValue) : undefined;
  if (!toStage || !label) {
    return NextResponse.json(
      { error: `toStage must be one of ${PIPELINE_STAGES.map((s) => s.value).join(", ")}` },
      { status: 400 },
    );
  }

  const result = await updateOpportunityStage(id, toStage as PipelineStageValue);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });

  await logAiAction({ domain: "crm", summary: `Advanced ${opportunityName ?? id} to ${label}` });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd ads-agent && npx vitest run app/api/crm/opportunities`
Expected: PASS.

- [ ] **Step 5: Write the failing `crm-chat.ts` test — mirror `copilot-chat.test.ts` exactly**

```typescript
// ads-agent/lib/decision-engine/crm-chat.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const { isBifrostConfigured, streamChatCompletion, callMeteredStreamingChatCompletion, getSession } = vi.hoisted(() => ({
  isBifrostConfigured: vi.fn(),
  streamChatCompletion: vi.fn(),
  callMeteredStreamingChatCompletion: vi.fn(),
  getSession: vi.fn(),
}));
vi.mock("../bifrost/client", () => ({ isBifrostConfigured, fallbacksForModel: () => [] }));
vi.mock("../openui/bifrost-stream", () => ({ streamChatCompletion }));
vi.mock("../metering/metered-stream-client", () => ({ callMeteredStreamingChatCompletion }));
vi.mock("../auth/dal", () => ({ getSession }));

import { draftCrmChatReply } from "./crm-chat";

beforeEach(() => {
  isBifrostConfigured.mockReset();
  callMeteredStreamingChatCompletion.mockReset();
  getSession.mockReset();
});

async function drain(gen: AsyncGenerator<{ type: "delta"; content: string } | { type: "done"; reply: string }>) {
  const events = [];
  for await (const event of gen) events.push(event);
  return events;
}

describe("draftCrmChatReply", () => {
  it("tells the user Bifrost isn't configured rather than throwing", async () => {
    isBifrostConfigured.mockReturnValue(false);
    getSession.mockResolvedValue(null);

    const events = await drain(draftCrmChatReply({ history: [], userMessage: "show hot leads" }));

    expect(events).toEqual([{ type: "done", reply: expect.stringContaining("not configured") }]);
  });

  it("retries once on a parse failure, then returns the retried reply", async () => {
    isBifrostConfigured.mockReturnValue(true);
    getSession.mockResolvedValue(null);
    callMeteredStreamingChatCompletion
      .mockImplementationOnce(async function* () {
        yield { type: "delta", content: "garbled not a component" };
      })
      .mockImplementationOnce(async function* () {
        yield { type: "delta", content: "Sure, here are your leads." };
      });

    const events = await drain(draftCrmChatReply({ history: [], userMessage: "show hot leads" }));

    expect(callMeteredStreamingChatCompletion).toHaveBeenCalledTimes(2);
    expect(events.at(-1)).toEqual({ type: "done", reply: "Sure, here are your leads." });
  });
});
```

- [ ] **Step 6: Run to verify it fails**

Run: `cd ads-agent && npx vitest run lib/decision-engine/crm-chat.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 7: Implement `crm-chat.ts` — mirror `copilot-chat.ts`'s structure exactly, scoped to `crmLibrary`**

```typescript
// ads-agent/lib/decision-engine/crm-chat.ts
import { createParser } from "@openuidev/lang-core";
import { isBifrostConfigured, type ChatMessage } from "../bifrost/client";
import { streamChatCompletion } from "../openui/bifrost-stream";
import { crmLibrary } from "../openui/crm-library";
import { looksLikeOpenUiLang } from "../openui/is-openui-lang";
import { parseWithBoundedRetry, type ParseAttempt } from "../openui/parse-retry";
import { callMeteredStreamingChatCompletion } from "../metering/metered-stream-client";
import { InsufficientCreditsError, type MeteringContext } from "../metering/types";
import { getSession } from "../auth/dal";
import { DEFAULT_ORG_ID, DEFAULT_USER_ID } from "../metering/dev-context";

export type CrmChatMessage = { role: "user" | "assistant"; content: string };
export type CrmChatTurnEvent = { type: "delta"; content: string } | { type: "done"; reply: string };

const PLAIN_ACK_MAX_LENGTH = 120;

function buildSystemPrompt(): string {
  return crmLibrary.prompt({
    preamble:
      "You are the Gentle Space CRM Assistant. Answer questions about leads/opportunities and, when " +
      "asked to move a lead's stage, ALWAYS render StageChangeConfirm and wait for the user's explicit " +
      "confirmation before the stage is actually changed (the confirm button calls a separate API " +
      "route, not you — you only need to render the confirmation).",
    additionalRules: [
      "Prefer OpportunityCard/OpportunityList/StageChangeConfirm over plain text whenever the answer " +
        "concerns specific leads.",
      "A response with no informational content (a one-word acknowledgment) may stay plain text, " +
        "under 120 characters, with no \"root = ...\" statement.",
      "No tools are registered on this route — do not use Query()/Mutation(); render components using " +
        "literal prop values drawn only from this conversation.",
      "Output only openui-lang (root = ComponentName(...)) or a short plain acknowledgment.",
    ],
  });
}

function parseCrmResponse(text: string): ParseAttempt<string> {
  const trimmed = text.trim();
  if (!trimmed) return { kind: "error", errors: ["empty response"] };
  if (!looksLikeOpenUiLang(trimmed)) {
    if (trimmed.length <= PLAIN_ACK_MAX_LENGTH) return { kind: "ok", value: trimmed };
    return { kind: "error", errors: ["response has no component statement and is too long to treat as a plain acknowledgment"] };
  }
  const parser = createParser(crmLibrary.toJSONSchema());
  let result: ReturnType<typeof parser.parse>;
  try {
    result = parser.parse(trimmed);
  } catch (err) {
    return { kind: "error", errors: [err instanceof Error ? err.message : "parse exception"] };
  }
  if (!result.root) {
    const meta = result.meta.errors.map((e) => `${e.path || "(root)"}: ${e.message}`);
    return { kind: "error", errors: meta.length > 0 ? meta : ["no component root parsed"] };
  }
  if (result.meta.errors.length > 0) {
    return { kind: "error", errors: result.meta.errors.map((e) => `${e.path}: ${e.message}`) };
  }
  return { kind: "ok", value: trimmed };
}

async function* runCrmModel(
  ctx: MeteringContext,
  messages: ChatMessage[],
): AsyncGenerator<{ type: "delta"; content: string }, string, unknown> {
  let full = "";
  for await (const chunk of callMeteredStreamingChatCompletion(
    ctx,
    { messages, temperature: 0.3, maxTokens: 1500, timeoutMs: 20_000 },
    streamChatCompletion,
  )) {
    if (chunk.type === "delta") {
      full += chunk.content;
      yield { type: "delta", content: chunk.content };
    }
  }
  return full;
}

async function runCrmModelSilent(ctx: MeteringContext, messages: ChatMessage[]): Promise<string> {
  const gen = runCrmModel(ctx, messages);
  let result = await gen.next();
  while (!result.done) result = await gen.next();
  return result.value;
}

export async function* draftCrmChatReply(input: {
  history: CrmChatMessage[];
  userMessage: string;
}): AsyncGenerator<CrmChatTurnEvent, void, unknown> {
  if (!isBifrostConfigured()) {
    yield { type: "done", reply: "Bifrost is not configured (BIFROST_BASE_URL), so the CRM Assistant can't respond yet." };
    return;
  }

  const session = await getSession();
  const ctx: MeteringContext = {
    orgId: session?.orgId ?? DEFAULT_ORG_ID,
    userId: session?.userId ?? DEFAULT_USER_ID,
    feature: "ads-agent:crm-chat",
  };

  const messages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt() },
    ...input.history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: input.userMessage },
  ];

  let firstRaw: string;
  try {
    firstRaw = yield* runCrmModel(ctx, messages);
  } catch (err) {
    if (err instanceof InsufficientCreditsError) {
      yield { type: "done", reply: "This organization has run out of AI credits — ask an admin to allocate more from Usage & Credits." };
      return;
    }
    yield { type: "done", reply: "The CRM Assistant is unavailable right now — try again shortly." };
    return;
  }

  let attempt: ParseAttempt<string>;
  try {
    attempt = await parseWithBoundedRetry(firstRaw, parseCrmResponse, async (feedback) => {
      messages.push({ role: "assistant", content: firstRaw });
      messages.push({ role: "user", content: feedback });
      return await runCrmModelSilent(ctx, messages);
    });
  } catch (err) {
    if (err instanceof InsufficientCreditsError) {
      yield { type: "done", reply: "This organization has run out of AI credits — ask an admin to allocate more from Usage & Credits." };
      return;
    }
    yield { type: "done", reply: "The CRM Assistant is unavailable right now — try again shortly." };
    return;
  }

  if (attempt.kind === "error") {
    yield { type: "done", reply: "I had trouble putting that together — could you rephrase, or name the lead more specifically?" };
    return;
  }

  yield { type: "done", reply: attempt.value };
}
```

- [ ] **Step 8: Run to verify it passes**

Run: `cd ads-agent && npx vitest run lib/decision-engine/crm-chat.test.ts`
Expected: PASS.

- [ ] **Step 9: Implement the CRM chat route — copy `copilot/chat/route.ts`'s exact shape**

```typescript
// ads-agent/app/api/crm/chat/route.ts
import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth/dal";
import { draftCrmChatReply, type CrmChatMessage } from "@/lib/decision-engine/crm-chat";

export async function POST(req: Request) {
  const access = await requireApiRole("operator");
  if (!access.ok) return access.response;

  const { content, history } = (await req.json()) as { content: string; history?: CrmChatMessage[] };
  if (!content?.trim()) return NextResponse.json({ error: "content is required" }, { status: 400 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      function send(event: Record<string, unknown>) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }
      try {
        let reply = "";
        for await (const event of draftCrmChatReply({ history: history ?? [], userMessage: content })) {
          if (event.type === "delta") send({ delta: event.content });
          else reply = event.reply;
        }
        send({ done: true, reply });
      } catch (err) {
        send({ done: true, error: err instanceof Error ? err.message : "internal error" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}
```

- [ ] **Step 10: Implement `CrmAssistantPanel.tsx` — mirror `CopilotPanel.tsx`'s streaming client, scoped to `crmLibrary`**

```typescript
// ads-agent/components/CrmAssistantPanel.tsx
"use client";

import { useState } from "react";
import { Renderer, type Library } from "@openuidev/react-lang";
import { crmLibrary } from "@/lib/openui/crm-library";
import { looksLikeOpenUiLang } from "@/lib/openui/is-openui-lang";
import { SideAssistantPanel, type SideAssistantMessage } from "@/components/pencil/SideAssistantPanel";

const crmChatLibrary = crmLibrary as Library;

type StreamEvent = { delta: string } | { done: true; reply: string } | { done: true; error: string };
type ChatMsg = { id: string; role: "user" | "assistant"; content: string };

export function CrmAssistantPanel({ onStageAdvanced }: { onStageAdvanced?: () => void }) {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [streamingText, setStreamingText] = useState("");

  async function sendMessage(content: string) {
    const trimmed = content.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setStreamingText("");
    setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: "user", content: trimmed }]);
    setInput("");

    try {
      const res = await fetch("/api/crm/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: trimmed, history: messages.map((m) => ({ role: m.role, content: m.content })) }),
      });
      if (!res.ok || !res.body) return;

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf("\n\n")) !== -1) {
          const rawEvent = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 2);
          if (!rawEvent.startsWith("data:")) continue;
          const event = JSON.parse(rawEvent.slice("data:".length).trim()) as StreamEvent;
          if ("delta" in event) {
            accumulated += event.delta;
            setStreamingText(accumulated);
          } else if (!("error" in event)) {
            setMessages((prev) => [...prev, { id: `a-${Date.now()}`, role: "assistant", content: event.reply }]);
          }
        }
      }
    } finally {
      setSending(false);
      setStreamingText("");
    }
  }

  const renderedMessages: SideAssistantMessage[] = messages.map((m) => ({
    id: m.id,
    role: m.role,
    content:
      m.role === "assistant" && looksLikeOpenUiLang(m.content) ? (
        <Renderer
          response={m.content}
          library={crmChatLibrary}
          toolProvider={{}}
          isStreaming={false}
        />
      ) : (
        m.content
      ),
  }));

  if (sending && streamingText) {
    renderedMessages.push({
      id: "streaming",
      role: "assistant",
      content: looksLikeOpenUiLang(streamingText) ? (
        <Renderer response={streamingText} library={crmChatLibrary} toolProvider={{}} isStreaming />
      ) : (
        streamingText
      ),
    });
  }

  return (
    <SideAssistantPanel
      title="CRM Assistant"
      messages={renderedMessages}
      input={input}
      onInputChange={setInput}
      onSend={() => void sendMessage(input)}
      sending={sending}
      placeholder="Ask about leads or opportunities…"
    />
  );
}
```

Note: `onStageAdvanced` is accepted but not yet wired to a real event (the chat route today only
renders `StageChangeConfirm` for the model to *propose* a move — an actual confirmed stage change from
chat, wired through the same `PATCH /api/crm/opportunities/[id]/stage` route Step 3 built, plus calling
`onStageAdvanced()` to refresh the board, is real follow-up UI work needing browser testing, same
reasoning as Task 13's drag-to-column follow-up — not fabricated here without a testable trigger).

- [ ] **Step 11: Build the Leads & CRM page**

```typescript
// ads-agent/app/(admin)/crm/page.tsx
import { ForbiddenNotice } from "@/components/ForbiddenNotice";
import { requireRole } from "@/lib/auth/dal";
import { listOpportunities, PIPELINE_STAGES } from "@/lib/crm/twenty-pipeline";
import { KanbanBoard } from "@/components/pencil/KanbanBoard";
import { KanbanCard } from "@/components/pencil/KanbanCard";
import { StatusPill, type StatusTone } from "@/components/pencil/StatusPill";
import { CrmAssistantPanel } from "@/components/CrmAssistantPanel";
import type { Opportunity } from "@/lib/crm/twenty-pipeline";

const TIER_TONE: Record<string, StatusTone> = { HOT: "hot", WARM: "warm", COLD: "cold", UNSCORED: "unscored" };

function LeadCard({ opportunity }: { opportunity: Opportunity }) {
  return (
    <KanbanCard>
      <div className="flex items-center justify-between">
        <span className="font-medium text-foreground">{opportunity.contactName ?? opportunity.name}</span>
        <StatusPill tone={TIER_TONE[opportunity.tier ?? "UNSCORED"]} label={opportunity.tier ?? "UNSCORED"} />
      </div>
      {opportunity.maskedPhone && <span className="text-xs text-muted-foreground">{opportunity.maskedPhone}</span>}
      <span className="text-xs text-muted-foreground">{[opportunity.source, opportunity.listingName].filter(Boolean).join(" · ")}</span>
    </KanbanCard>
  );
}

export default async function CrmPage() {
  const access = await requireRole("operator");
  if (!access.ok) return <ForbiddenNotice />;

  const opportunities = await listOpportunities();
  const columns = PIPELINE_STAGES.map((stage) => ({
    key: stage.value,
    label: stage.label,
    cards: opportunities
      .filter((o) => o.stage === stage.value)
      .map((o) => ({ id: o.id, node: <LeadCard key={o.id} opportunity={o} /> })),
  }));

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_360px]">
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Leads & CRM</h1>
          <p className="text-sm text-muted-foreground">
            Synced live from Twenty CRM — {opportunities.length} opportunities in pipeline.
          </p>
        </div>
        {opportunities.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No opportunities yet, or Twenty CRM is not configured.
          </p>
        ) : (
          <KanbanBoard columns={columns} />
        )}
      </div>
      <div className="h-[calc(100vh-8rem)]">
        <CrmAssistantPanel />
      </div>
    </div>
  );
}
```

- [ ] **Step 12: Manual verification**

Run: `cd ads-agent && npm run dev`; visit `/crm`, confirm 7 columns render (scrolling horizontally),
each seeded/real lead card shows a tier pill + masked phone, and the CRM Assistant panel accepts a
message and streams a reply (with `BIFROST_BASE_URL`/`TWENTY_API_KEY` configured locally).

- [ ] **Step 13: Commit**

```bash
git add "ads-agent/app/(admin)/crm/page.tsx" ads-agent/app/api/crm ads-agent/lib/decision-engine/crm-chat.ts ads-agent/lib/decision-engine/crm-chat.test.ts ads-agent/components/CrmAssistantPanel.tsx
git commit -m "feat(ads-agent): build Leads & CRM page (7-stage board + CRM Assistant chat)"
```

---

### Task 15: Reports page + analytics chat route

**Files:**
- Create: `ads-agent/app/(admin)/reports/page.tsx`
- Create: `ads-agent/lib/decision-engine/reports-chat.ts`
- Test: `ads-agent/lib/decision-engine/reports-chat.test.ts`
- Create: `ads-agent/app/api/reports/chat/route.ts`
- Create: `ads-agent/components/ReportsChat.tsx`

**Interfaces:**
- Consumes: Task 10's `analyticsLibrary`, `parseWithBoundedRetry`, same streaming plumbing as Task 14.
- Produces: nothing consumed by a later task (leaf page + route).

- [ ] **Step 1-8: Repeat Task 14's Steps 5-10 pattern exactly, substituted for analytics**

Following the identical structure Task 14 Steps 5-10 established (test-first for the decision-engine
module, then the route, then the Client Component), build:

```typescript
// ads-agent/lib/decision-engine/reports-chat.test.ts — same shape as crm-chat.test.ts, substituting:
import { draftReportsChatReply } from "./reports-chat";
// ...and asserting the same three behaviors (not-configured message, retry-then-succeed, generic
// unavailable message on a thrown non-credits error) against draftReportsChatReply.
```

```typescript
// ads-agent/lib/decision-engine/reports-chat.ts — identical structure to crm-chat.ts (Task 14 Step 7),
// with these substitutions:
//   - import { analyticsLibrary } from "../openui/analytics-library";  (instead of crmLibrary)
//   - buildSystemPrompt()'s preamble: "You are the Gentle Space Reports assistant. Answer questions
//     about campaign performance and proposals by rendering TrendChart or DataTable — pick whichever
//     shape best matches the tool result, never force a chart onto tabular data or vice versa."
//   - feature: "ads-agent:reports-chat" in MeteringContext
//   - export names: ReportsChatMessage, ReportsChatTurnEvent, draftReportsChatReply
// Every other line (parse-retry wiring, InsufficientCreditsError handling, streaming loop) is
// byte-identical in structure to crm-chat.ts — copy Task 14 Step 7's file and do a targeted
// find-and-replace of the five substitutions above, not a from-scratch rewrite.
```

```typescript
// ads-agent/app/api/reports/chat/route.ts — identical shape to app/api/crm/chat/route.ts (Task 14
// Step 9), substituting draftReportsChatReply/ReportsChatMessage for draftCrmChatReply/CrmChatMessage.
```

```typescript
// ads-agent/components/ReportsChat.tsx — same streaming-client structure as CrmAssistantPanel.tsx
// (Task 14 Step 10), but does NOT use SideAssistantPanel (per the design spec: Reports' chat IS the
// whole page, no adjacent board to share space with) — instead renders its own scrolling feed with a
// pinned bottom input bar:
"use client";

import { useState } from "react";
import { Renderer, type Library } from "@openuidev/react-lang";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { analyticsLibrary } from "@/lib/openui/analytics-library";
import { looksLikeOpenUiLang } from "@/lib/openui/is-openui-lang";

const reportsLibrary = analyticsLibrary as Library;
type StreamEvent = { delta: string } | { done: true; reply: string } | { done: true; error: string };
type ChatMsg = { id: string; role: "user" | "assistant"; content: string };

export function ReportsChat() {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [streamingText, setStreamingText] = useState("");

  async function sendMessage(content: string) {
    const trimmed = content.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setStreamingText("");
    setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: "user", content: trimmed }]);
    setInput("");
    try {
      const res = await fetch("/api/reports/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: trimmed, history: messages.map((m) => ({ role: m.role, content: m.content })) }),
      });
      if (!res.ok || !res.body) return;
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let accumulated = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf("\n\n")) !== -1) {
          const rawEvent = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 2);
          if (!rawEvent.startsWith("data:")) continue;
          const event = JSON.parse(rawEvent.slice("data:".length).trim()) as StreamEvent;
          if ("delta" in event) {
            accumulated += event.delta;
            setStreamingText(accumulated);
          } else if (!("error" in event)) {
            setMessages((prev) => [...prev, { id: `a-${Date.now()}`, role: "assistant", content: event.reply }]);
          }
        }
      }
    } finally {
      setSending(false);
      setStreamingText("");
    }
  }

  return (
    <div className="flex h-[calc(100vh-8rem)] flex-col gap-4">
      <div className="flex-1 space-y-3 overflow-y-auto">
        {messages.length === 0 && (
          <p className="text-sm text-muted-foreground">
            Ask anything — the AI picks the right chart, table, or number for your question.
          </p>
        )}
        {messages.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="ml-auto max-w-[85%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground">
              {m.content}
            </div>
          ) : looksLikeOpenUiLang(m.content) ? (
            <div key={m.id} className="max-w-[90%] rounded-lg bg-surface p-3">
              <Renderer response={m.content} library={reportsLibrary} toolProvider={{}} isStreaming={false} />
            </div>
          ) : (
            <div key={m.id} className="max-w-[85%] rounded-lg bg-surface-raised px-3 py-2 text-sm text-foreground">
              {m.content}
            </div>
          ),
        )}
        {sending && streamingText && (
          <div className="max-w-[90%] rounded-lg bg-surface p-3">
            {looksLikeOpenUiLang(streamingText) ? (
              <Renderer response={streamingText} library={reportsLibrary} toolProvider={{}} isStreaming />
            ) : (
              <span className="text-sm text-foreground">{streamingText}</span>
            )}
          </div>
        )}
      </div>
      <div className="flex gap-2">
        <input
          className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground"
          placeholder="Ask a follow-up — “which corridor is burning budget fastest?”"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void sendMessage(input);
            }
          }}
          disabled={sending}
        />
        <Button size="icon" disabled={sending || !input.trim()} onClick={() => void sendMessage(input)} aria-label="Send">
          {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
        </Button>
      </div>
    </div>
  );
}
```

```typescript
// ads-agent/app/(admin)/reports/page.tsx
import { ForbiddenNotice } from "@/components/ForbiddenNotice";
import { requireRole } from "@/lib/auth/dal";
import { ReportsChat } from "@/components/ReportsChat";

export default async function ReportsPage() {
  const access = await requireRole("operator");
  if (!access.ok) return <ForbiddenNotice />;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Reports & Analytics</h1>
        <p className="text-sm text-muted-foreground">
          Ask anything — the AI picks the right chart, table, or number for your question.
        </p>
      </div>
      <ReportsChat />
    </div>
  );
}
```

- [ ] **Step 9: Run every new test to verify it passes**

Run: `cd ads-agent && npx vitest run lib/decision-engine/reports-chat.test.ts app/api/reports`
Expected: PASS.

- [ ] **Step 10: Manual verification**

Run: `cd ads-agent && npm run dev`; visit `/reports`, ask "show me hot leads from this week" and confirm
a rendered `TrendChart`/`DataTable` (not raw prose) appears once `BIFROST_BASE_URL` is configured.

- [ ] **Step 11: Commit**

```bash
git add "ads-agent/app/(admin)/reports/page.tsx" ads-agent/app/api/reports ads-agent/lib/decision-engine/reports-chat.ts ads-agent/lib/decision-engine/reports-chat.test.ts ads-agent/components/ReportsChat.tsx
git commit -m "feat(ads-agent): build Reports page as Spec 2's chat-driven analytics surface"
```

---

### Task 16: Settings & Users `TabStrip` wiring

**Files:**
- Modify: `ads-agent/app/(admin)/settings/page.tsx`
- Modify: `ads-agent/app/(admin)/credits/page.tsx`

**Interfaces:**
- Consumes: Task 8's `TabStrip`.
- Produces: nothing consumed by a later task (leaf pages).

- [ ] **Step 1: Add `TabStrip` to `settings/page.tsx`**

```typescript
// ads-agent/app/(admin)/settings/page.tsx — add near the top:
import { TabStrip } from "@/components/pencil/TabStrip";

const SETTINGS_TABS = [
  { href: "/settings", label: "Workspace Settings" },
  { href: "/credits", label: "Usage & Credits" },
];

// ...then as the first child inside the existing outer <div className="flex max-w-2xl flex-col gap-6">:
<TabStrip tabs={SETTINGS_TABS} />
```

Read the actual current file before editing — place the `TabStrip` as the first element, leave every
other line (the two `Card`s, `SettingsForm`, connector-status list) exactly as-is.

- [ ] **Step 2: Add the same `TabStrip` to `credits/page.tsx`**

```typescript
// ads-agent/app/(admin)/credits/page.tsx — same import + const as Step 1, added as the first child
// inside the existing outer <div className="flex flex-col gap-6">, before <UsagePoller />.
```

- [ ] **Step 3: Manual verification**

Run: `cd ads-agent && npm run dev`; visit `/settings`, confirm the tab strip appears above the Decision
cycle card and switching to "Usage & Credits" navigates to `/credits` with its own tab strip active on
the "Usage & Credits" side.

- [ ] **Step 4: Commit**

```bash
git add "ads-agent/app/(admin)/settings/page.tsx" "ads-agent/app/(admin)/credits/page.tsx"
git commit -m "feat(ads-agent): wire TabStrip between Settings and Usage & Credits"
```

---

### Task 17: Full verification pass

**Files:** none (verification only).

- [ ] **Step 1: Full automated suite**

Run: `cd ads-agent && npm run build && npm run lint && npm test`
Expected: all three pass with zero new warnings. If `npm run build` surfaces a Next 15 `params`-shape
error anywhere (Tasks 13/14 added two new `[id]` route handlers), fix per `node_modules/next/dist/docs/`
before proceeding — do not silence the type error.

- [ ] **Step 2: `npm run migrate` against a real dev database**

Run: `cd ads-agent && npm run migrate`
Expected: succeeds, including the new `ai_action_log` table (Task 4) — confirms `schema.sql` is valid
SQL end-to-end, not just syntactically plausible.

- [ ] **Step 3: Manual smoke pass — one item per page**

- `/`: 4 stat cards show real numbers; "Recent AI activity" shows real or honest-empty content.
- `/campaigns`: 3-column board (Draft/Active/Paused) renders; `TabStrip` switches to `/proposals`.
- `/crm`: 7-column board renders (scrolls horizontally); CRM Assistant answers a question, and a
  `curl -X PATCH .../api/crm/opportunities/<real-id>/stage -d '{"toStage":"TOUR","opportunityName":"Test"}'`
  call against a real seeded opportunity actually moves it in the live Twenty UI.
- `/reports`: asking "show me hot leads from this week" renders a `TrendChart` or `DataTable`, not
  plain prose.
- `/settings` ↔ `/credits`: `TabStrip` navigates both ways; both pages' existing content (Decision
  cycle form, org balance table) is unchanged.
- `/users`: unchanged, restyled tokens only.
- Global Copilot (any page): ask a question that should trigger `list_opportunities` or
  `get_spend_cpl_trend` and confirm the composed `platformToolProvider`/`platformLibrary` (Task 11)
  actually calls through and renders the right component — this is the one behavior no unit test in
  this plan exercises end-to-end (Task 11's tests check composition shape, not a live model call).

- [ ] **Step 4: Confirm no page load triggers an LLM call**

With the Bifrost/Twenty connectors configured, load `/`, `/campaigns`, `/crm`, `/reports` in sequence
without opening any chat panel, then check `usage_ledger` (`SELECT COUNT(*) FROM usage_ledger WHERE
occurred_at > now() - interval '5 minutes'`) shows zero new rows — confirms the hybrid-rendering
invariant from the OpenUI foundation spec still holds for the two new pages.

- [ ] **Step 5: Final commit (if Step 1 required fixes)**

```bash
git add -A
git commit -m "fix(ads-agent): resolve build/lint findings from full verification pass"
```

(Skip this step entirely if Step 1 passed clean with no changes needed.)
