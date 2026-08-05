# OpenUI Platform Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: This plan is organized into **waves** for parallel
> execution (up to 8 subagents at once), a deliberate deviation from
> `superpowers:subagent-driven-development`'s default "never dispatch implementers in parallel" rule —
> safe here because every task within a wave owns a disjoint set of files (see each wave's
> file-ownership note). This mirrors the same deviation already used successfully in this repo's
> [`2026-08-03-ads-agent-admin-dashboard.md`](2026-08-03-ads-agent-admin-dashboard.md) and
> [`2026-08-04-ads-agent-admin-dashboard-v2.md`](2026-08-04-ads-agent-admin-dashboard-v2.md) plans. Use
> `superpowers:dispatching-parallel-agents` to dispatch all tasks in a wave together (multiple Task tool
> calls in the same message = parallel). Every task below carries a real Vitest test cycle — follow
> `superpowers:test-driven-development` for each. Run the task-reviewer gate (spec compliance + code
> quality) on every task as it completes; do **not** dispatch the next wave until every task in the
> current wave has passed review — later waves import files earlier waves create. Steps use checkbox
> (`- [ ]`) syntax for tracking.

**Goal:** Build the shared OpenUI platform foundation — nine general-purpose components
(`shared-library.ts`), the `AskAiTrigger` per-component AI handoff, a composed cross-domain
`platform-library.ts`/`platform-tools.ts` registry, and a persistent global Copilot (provider, floating
button, panel, streamed chat route) — per
[`docs/superpowers/specs/2026-08-05-openui-platform-foundation-design.md`](../specs/2026-08-05-openui-platform-foundation-design.md).

**Architecture:** Nine new presentational components split across three small, cohesive files
(`shared-metric-cards.ts`, `shared-narrative-cards.ts`, `shared-structured-views.ts`) are composed by a
barrel (`shared-library.ts`) into one `Library`. `platform-library.ts` merges that with the existing,
unmodified `campaignLibrary`. `platform-tools.ts` is a typed, tested **composition function** with zero
domain tool sets registered today (a corrected finding from this plan's codebase verification — see
Global Constraints) — the seam Specs 2/3 plug into later, not a partially-built merge. A new
`lib/openui/parse-retry.ts` extracts the bounded-retry-on-parse-failure mechanic (mandated by the
foundation spec's Resilience section) as a reusable helper, used by the new Copilot route — the second
caller of this pattern, meeting the threshold the spec itself sets for extraction. `CopilotProvider`
(pure-reducer state + thin Context wiring), `CopilotFab`, and `CopilotPanel` mount once at
`(admin)/layout.tsx`, giving every admin page a persistent AI Copilot without per-page wiring.

**Tech Stack:** Next.js 15.5.21, React 19, TypeScript, Tailwind v4, Vitest, Zod v4,
`@openuidev/lang-core` `^0.2.10`, `@openuidev/react-lang` `^0.2.9` — no new dependencies.

## Global Constraints

- **Codebase-verification correction (binding on every task below):** `campaign-tools.ts` does **not**
  exist. Spec 1's Campaign Chat (`ads-agent/lib/decision-engine/campaign-chat.ts`) never used OpenUI's
  `ToolSpec`/`ToolProvider`/`Query()`/`Mutation()` mechanism — `SetupCard` is pure structured-output
  parsing from conversation history, no live tool calls. Verified via `torbit` (no `campaign-tools.ts`
  definitions in the graph) and by reading the installed `@openuidev/lang-core`/`@openuidev/react-lang`
  `.d.cts` files directly (confirms the real, usable API: `ToolSpec`, `ToolProvider`,
  `createQueryManager`, `Renderer`'s `toolProvider` prop — a client-side
  `Record<string, (args) => Promise<unknown>>` executed when the model emits `Query()`/`Mutation()` at
  render time). Consequence: **`platform-tools.ts` composes zero domain tool sets in this plan** — it
  ships as a tested, typed, empty extension point (Task 10), not a partial merge. No task below invents
  a fake domain tool to fill it — that would misrepresent what exists.
- **No new dependencies.** Every file below imports only already-installed packages
  (`@openuidev/lang-core`, `@openuidev/react-lang`, `zod`, `react`, `lucide-react` — client components
  only, see next point) — confirmed via `ads-agent/package.json` and `node_modules/@openuidev/*`.
- **`lib/openui/*` files stay framework-light — no `lucide-react`, no `components/ui/*` shadcn imports,
  no `"use client"`.** This is the established, shipped convention from `SetupCardView`
  (`campaign-library.ts`'s own comment: "keeps this module free of client-only UI imports so
  campaign-chat (server) can import ... without pulling shadcn into the API route bundle"). All nine
  new shared components follow it exactly: `React.createElement`, plain `<div>`/`<span>`, inline
  Tailwind classes only. `AskAiTrigger` (interactive, needs `onClick`) is the one piece the spec places
  conceptually alongside `shared-library.ts` but is NOT itself an OpenUI component — per this repo's own
  convention of interactive components living flat under `components/` (`Breadcrumb.tsx`,
  `CommandPalette.tsx`, `SidebarNav.tsx`, `UserMenu.tsx`, `RunNowButton.tsx`), it lives at
  `ads-agent/components/AskAiTrigger.tsx`, not inside `lib/openui/`.
- **Tailwind tokens used below are all already defined** in `app/globals.css` (same set the v2 dashboard
  plan already enumerated): `bg-card`, `text-card-foreground`, `border-border`, `bg-muted`,
  `text-muted-foreground`, `bg-primary`, `text-primary-foreground`, `bg-secondary`,
  `text-secondary-foreground`, `bg-destructive`, `text-destructive-foreground`, `bg-accent`,
  `text-accent-foreground`. No new CSS variables are introduced anywhere in this plan.
- **No test-rendering library is added.** This codebase's existing OpenUI component tests
  (`campaign-library.test.ts`) call view functions directly and assert on the returned React element
  tree (`.toBeTruthy()`, structural checks) — no `@testing-library/react`. Every new component test
  below follows that exact convention.
- **`campaign-chat.ts` is not modified by this plan** (per the foundation spec's Non-goals: "Rewriting
  Spec 1's shipped Campaign Chat"). Its inline parse-retry logic is the reference implementation the new
  `lib/openui/parse-retry.ts` helper generalizes for the Copilot route — migrating `campaign-chat.ts`
  itself onto the shared helper is reasonable future follow-up, explicitly not done here.
- **Dashboard nav/breadcrumb/command-palette/sign-out (v2 redesign) are already shipped** — confirmed by
  reading `ads-agent/app/(admin)/layout.tsx` directly. Task 13 (layout wiring) adds to this file; it
  does not rebuild any of it.
- **RBAC:** the Copilot route (Task 12) uses `requireApiRole("operator")` — the same minimum tier as
  Campaigns/Proposals — via the existing `ads-agent/lib/auth/dal.ts`. `CopilotFab`/`CopilotPanel` are
  only mounted for `session.role === "operator" || session.role === "admin"` in the layout (Task 13) —
  defense in depth matching the route gate, same pattern the v2 dashboard plan already established for
  nav visibility.
- **No `usage_ledger`/DB persistence for Copilot messages** (per spec's Persistence model: ephemeral,
  client-side history sent in full per request, same as Spec 2's Reports chat design) — no new
  migration, no new table, anywhere in this plan.
- **Proactive-signaling badge computation (the red dot / "CPL up 17%" chip) is explicitly out of scope**
  for this plan — the foundation spec defines the *convention*, not a shipped query. `CopilotFab`
  accepts a `hasAlert?: boolean` prop so a future Spec 2/3 task can wire a real threshold query into it;
  no task below computes one.
- **Follow this repo's existing conventions exactly:** colocated `*.test.ts`/`*.test.tsx` files;
  `@/*` path alias; Vitest (`describe`/`it`/`expect`, `vi.mock` for named-export mocking, matching
  `campaign-chat.test.ts`/`route.test.ts` precedent); Zod schemas use `.optional().default(...)`, never
  `.nullable()`, on OpenUI component props (OpenUI's parser rejects `null` on required fields even when
  Zod allows it — the exact rule `SetupCardSchema`'s own comment documents).
- **This repo's Next.js has breaking changes vs. training-data conventions (per `AGENTS.md`).** No task
  below adds a dynamic route; `route.ts` (Task 12) has no `[params]` segment, so this doesn't apply
  directly, but if anything looks off against `node_modules/next/dist/docs/`, verify there first.

---

## Parallelization Plan

```text
Wave 1 (7 parallel)  Task 1 — shared-metric-cards.ts (StatCard, KpiGrid)
                     Task 2 — shared-narrative-cards.ts (InsightCallout, ChecklistCard, AlertBanner)
                     Task 3 — shared-structured-views.ts (ComparisonCard, Timeline, RankedList,
                              BatchActionConfirm)
                     Task 4 — AskAiTrigger.tsx
                     Task 5 — copilot-state.ts (reducer) + CopilotProvider.tsx
                     Task 6 — Verify Spec 1 dual-mode convention compliance (audit, no new component)
                     Task 7 — lib/openui/parse-retry.ts (generic bounded-retry helper)
                        ↓ (all 7 must pass review first)
Wave 2 (2 parallel)  Task 8 — shared-library.ts barrel (composes Tasks 1-3)
                     Task 9 — CopilotFab.tsx (depends on Task 5's useCopilot() hook)
                        ↓ (both must pass review first)
Wave 3 (solo)        Task 10 — platform-library.ts + platform-tools.ts (depends on Task 8's
                               sharedLibrary + existing campaignLibrary)
                        ↓ (must pass review first)
Wave 4 (2 parallel)  Task 11 — CopilotPanel.tsx (depends on Task 10, Task 5's useCopilot())
                     Task 12 — /api/copilot/chat/route.ts + copilot-chat.ts (depends on Task 10,
                               Task 7's parse-retry helper)
                        ↓ (both must pass review first)
Wave 5 (solo)        Task 13 — (admin)/layout.tsx wiring (mounts CopilotProvider + CopilotFab +
                               CopilotPanel; depends on Tasks 5, 9, 11)
                        ↓ (must pass review first)
Wave 6 (solo)        Task 14 — Full manual verification pass
```

Real max concurrency here is 7 (Wave 1), inside the requested ≤8 ceiling — every Wave 1 task starts
from zero new-file dependencies (three disjoint component files, one standalone UI wrapper, one
self-contained state module, one read-only audit, one generic utility with no repo-specific imports).
The dependency chain from there (shared-library barrel → platform composition → Copilot UI/route →
layout mount → verification) is real: `platform-library.ts` cannot exist before `shared-library.ts`
does, and the layout can't mount pieces that don't exist yet. Each task's **Interfaces** block states
exactly what it consumes from an earlier wave and produces for a later one; siblings within a wave
touch disjoint files and never need each other's output.

**Skills:** every implementation task below reads and follows `~/.cursor/skills/senior-frontend/SKILL.md`
(React/Next.js/TypeScript/Tailwind conventions, accessibility) — every task in this plan touches
TypeScript and most touch React. Tasks defining new Zod-schema'd OpenUI components (1, 2, 3, 10)
additionally follow `~/.cursor/skills/api-designer/SKILL.md` for schema/interface design discipline
(prop shapes are a public contract other domains' future components will consume, same reasoning as an
API surface). Tasks with real interaction-design stakes (`AskAiTrigger`'s hover-reveal affordance,
`CopilotFab`'s floating trigger + badge, `CopilotPanel`'s chat surface) additionally follow
`~/.cursor/skills/ui-ux-design-expert/SKILL.md` (Nielsen heuristics — visibility of system status while
streaming, user control to close/cancel, recognition over recall for the sparkle-icon affordance).
Tasks touching shared visual density/tokens across the whole new component family (Tasks 1-3, 8)
additionally follow `~/.cursor/skills/ui-design-system/SKILL.md` (token/consistency discipline — same
reasoning the v2 dashboard plan already applied to its own Card-removal tasks). Task 12 (the streamed
chat route + decision-engine module) additionally follows `~/.cursor/skills/senior-backend/SKILL.md`
for the server-side streaming/error-handling/metering discipline. `image-to-code` and
`design-taste-frontend` were considered and excluded — both are scoped to image-first
hero/landing-page generation (per their own frontmatter) and this plan has no hero, no generated
mockups, and no landing page; it's a token-driven extension of an already-styled admin dashboard (same
conclusion the v2 dashboard plan's own Skills note already reached for this codebase).

**Codebase-context tooling note:** every task below was scoped using `torbit` (SQL queries against the
local code graph — `gl_definition` table) to enumerate real symbols/files rather than grep, per this
plan's dispatch instructions; only a handful of targeted `Grep` calls were used to confirm the absence
of a symbol (`ToolSpec`, `campaign-tools.ts`) where a SQL query alone couldn't prove a negative as
quickly. Implementer subagents should prefer the same: query `torbit` for a file/symbol's existing
definitions and callers before grepping the whole tree.

---

### Task 1: `shared-metric-cards.ts` — `StatCard`, `KpiGrid`

**Files:**
- Create: `ads-agent/lib/openui/shared-metric-cards.ts`
- Test: `ads-agent/lib/openui/shared-metric-cards.test.ts`

**Interfaces:**
- Consumes: nothing new — only `zod`, `react`, `@openuidev/lang-core`'s `defineComponent`.
- Produces: `StatCardSchema`, `StatCardProps`, `StatCardView(props)`, `StatCard` (`DefinedComponent`),
  `KpiGridSchema`, `KpiGridProps`, `KpiGridView(props)`, `KpiGrid` (`DefinedComponent`) — all exported.
  Task 8 imports `StatCard` and `KpiGrid` (the `DefinedComponent` values) to build the barrel library.

- [ ] **Step 1: Write the failing test**

```typescript
// ads-agent/lib/openui/shared-metric-cards.test.ts
import { describe, expect, it } from "vitest";
import { StatCard, StatCardView, KpiGrid, KpiGridView } from "./shared-metric-cards";

describe("StatCardView", () => {
  it("renders label, value, and a delta when provided", () => {
    const tree = StatCardView({ label: "Active leads", value: "42", deltaLabel: "+12% vs last week", deltaDirection: "up" });
    expect(tree).toBeTruthy();
  });

  it("does not throw when optional props are omitted (Zod defaults not yet applied)", () => {
    expect(() => StatCardView({ label: "CPL", value: "₹214" })).not.toThrow();
  });
});

describe("StatCard (OpenUI component)", () => {
  it("is named StatCard and has the expected prop keys", () => {
    expect(StatCard.name).toBe("StatCard");
    expect(Object.keys(StatCard.props.shape)).toEqual(["label", "value", "deltaLabel", "deltaDirection"]);
  });
});

describe("KpiGridView", () => {
  it("renders one StatCardView per stat", () => {
    const tree = KpiGridView({
      stats: [
        { label: "Spend", value: "₹12,400" },
        { label: "Leads", value: "18", deltaLabel: "+3", deltaDirection: "up" },
      ],
    });
    expect(tree).toBeTruthy();
  });

  it("does not throw on an empty stats array", () => {
    expect(() => KpiGridView({ stats: [] })).not.toThrow();
  });
});

describe("KpiGrid (OpenUI component)", () => {
  it("is named KpiGrid", () => {
    expect(KpiGrid.name).toBe("KpiGrid");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ads-agent && npx vitest run lib/openui/shared-metric-cards.test.ts`
Expected: FAIL with "Cannot find module './shared-metric-cards'"

- [ ] **Step 3: Write minimal implementation**

```typescript
// ads-agent/lib/openui/shared-metric-cards.ts
import { defineComponent } from "@openuidev/lang-core";
import React from "react";
import { z } from "zod";

/**
 * OpenUI maps positional args by Zod key order — see SetupCardSchema's comment in
 * campaign-library.ts for why `.optional().default(...)` is used instead of `.nullable()`
 * everywhere in this file and its siblings (shared-narrative-cards.ts, shared-structured-views.ts).
 */
const StatCardSchema = z.object({
  label: z.string(),
  /** Pre-formatted display string (e.g. "₹42,500", "128", "3.2%") — this component does no
   * number formatting itself, matching the "components render, callers format" convention already
   * established by SetupCardView's own formatInr() living in campaign-library.ts, not here. */
  value: z.string(),
  deltaLabel: z.string().optional().default(""),
  deltaDirection: z.enum(["up", "down", "flat"]).optional().default("flat"),
});

export type StatCardProps = z.infer<typeof StatCardSchema>;
export type StatCardViewInput = { [K in keyof StatCardProps]?: StatCardProps[K] | null };

function normalizeStatCardProps(raw: StatCardViewInput): StatCardProps {
  return {
    label: raw.label ?? "",
    value: raw.value ?? "",
    deltaLabel: raw.deltaLabel ?? "",
    deltaDirection: raw.deltaDirection ?? "flat",
  };
}

const DELTA_ARROW: Record<StatCardProps["deltaDirection"], string> = { up: "▲", down: "▼", flat: "" };
const DELTA_CLASS: Record<StatCardProps["deltaDirection"], string> = {
  up: "text-emerald-600 dark:text-emerald-400",
  down: "text-destructive",
  flat: "text-muted-foreground",
};

/** Pure, read-only presentation of a single metric — same dual-mode convention as
 * campaign-library.ts's SetupCardView: called directly for the deterministic path, wrapped via
 * defineComponent() below for the model path. */
export function StatCardView(raw: StatCardViewInput) {
  const props = normalizeStatCardProps(raw);
  return React.createElement(
    "div",
    { className: "flex flex-col gap-1 rounded-lg border border-border bg-card p-4" },
    React.createElement("span", { className: "text-xs font-medium text-muted-foreground" }, props.label),
    React.createElement("span", { className: "text-2xl font-semibold text-card-foreground" }, props.value),
    props.deltaLabel &&
      React.createElement(
        "span",
        { className: `text-xs font-medium ${DELTA_CLASS[props.deltaDirection]}` },
        `${DELTA_ARROW[props.deltaDirection]} ${props.deltaLabel}`.trim(),
      ),
  );
}

export const StatCard = defineComponent({
  name: "StatCard",
  description:
    "Displays one metric: a label, a pre-formatted value string, and an optional delta label with " +
    "direction (up/down/flat). Args are POSITIONAL in that key order. Unset deltaLabel is \"\"; " +
    "unset deltaDirection is \"flat\". Use for a single number the user asked about " +
    "(e.g. \"what's my CPL this week\") — for multiple related metrics, use KpiGrid instead.",
  props: StatCardSchema,
  component: ({ props }: { props: StatCardViewInput }) => React.createElement(StatCardView, props),
});

const KpiGridSchema = z.object({
  stats: z.array(StatCardSchema).optional().default([]),
});

export type KpiGridProps = z.infer<typeof KpiGridSchema>;
export type KpiGridViewInput = { stats?: (StatCardViewInput | null)[] | null };

/** Pure, read-only presentation of a scorecard — a grid of StatCardViews. */
export function KpiGridView(raw: KpiGridViewInput) {
  const stats = raw.stats ?? [];
  return React.createElement(
    "div",
    { className: "grid grid-cols-2 gap-3 sm:grid-cols-4" },
    ...stats.map((stat, index) => React.createElement(StatCardView, { key: index, ...(stat ?? {}) })),
  );
}

export const KpiGrid = defineComponent({
  name: "KpiGrid",
  description:
    "Displays a scorecard: a grid of StatCards, each { label, value, deltaLabel, deltaDirection }. " +
    "Use when the user asks for multiple related metrics at once (e.g. \"give me a scorecard for " +
    "this campaign\") instead of one StatCard per metric or a prose paragraph.",
  props: KpiGridSchema,
  component: ({ props }: { props: KpiGridViewInput }) => React.createElement(KpiGridView, props),
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ads-agent && npx vitest run lib/openui/shared-metric-cards.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
cd ads-agent && npx eslint lib/openui/shared-metric-cards.ts lib/openui/shared-metric-cards.test.ts
git add lib/openui/shared-metric-cards.ts lib/openui/shared-metric-cards.test.ts
git commit -m "feat: add StatCard and KpiGrid shared OpenUI components"
```

---

### Task 2: `shared-narrative-cards.ts` — `InsightCallout`, `ChecklistCard`, `AlertBanner`

**Files:**
- Create: `ads-agent/lib/openui/shared-narrative-cards.ts`
- Test: `ads-agent/lib/openui/shared-narrative-cards.test.ts`

**Interfaces:**
- Consumes: nothing new — only `zod`, `react`, `@openuidev/lang-core`'s `defineComponent`.
- Produces: `InsightCallout`, `ChecklistCard`, `AlertBanner` (`DefinedComponent`s) + their `*View`
  functions and prop types, all exported. Task 8 imports the three `DefinedComponent` values.

- [ ] **Step 1: Write the failing test**

```typescript
// ads-agent/lib/openui/shared-narrative-cards.test.ts
import { describe, expect, it } from "vitest";
import { InsightCallout, InsightCalloutView, ChecklistCard, ChecklistCardView, AlertBanner, AlertBannerView } from "./shared-narrative-cards";

describe("InsightCalloutView", () => {
  it("renders a headline and optional supporting stat", () => {
    const tree = InsightCalloutView({ headline: "CPL rose because of a bid increase on Whitefield", supportingStat: "+₹40", tone: "negative" });
    expect(tree).toBeTruthy();
  });
  it("does not throw without optional props", () => {
    expect(() => InsightCalloutView({ headline: "All campaigns are healthy" })).not.toThrow();
  });
});
describe("InsightCallout (OpenUI component)", () => {
  it("is named InsightCallout", () => expect(InsightCallout.name).toBe("InsightCallout"));
});

describe("ChecklistCardView", () => {
  it("renders items with status icons", () => {
    const tree = ChecklistCardView({
      title: "3 things to review today",
      items: [
        { text: "Whitefield campaign is under budget", status: "warning" },
        { text: "2 hot leads unqualified >48h", status: "warning" },
        { text: "Weekly report sent", status: "done" },
      ],
    });
    expect(tree).toBeTruthy();
  });
  it("does not throw on an empty items array", () => {
    expect(() => ChecklistCardView({ items: [] })).not.toThrow();
  });
});
describe("ChecklistCard (OpenUI component)", () => {
  it("is named ChecklistCard", () => expect(ChecklistCard.name).toBe("ChecklistCard"));
});

describe("AlertBannerView", () => {
  it("renders severity, title, and detail", () => {
    const tree = AlertBannerView({ severity: "critical", title: "Campaign paused: over budget", detail: "Whitefield HSR Launch hit its daily cap at 11am." });
    expect(tree).toBeTruthy();
  });
  it("does not throw without detail", () => {
    expect(() => AlertBannerView({ severity: "info", title: "New lead assigned" })).not.toThrow();
  });
});
describe("AlertBanner (OpenUI component)", () => {
  it("is named AlertBanner", () => expect(AlertBanner.name).toBe("AlertBanner"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ads-agent && npx vitest run lib/openui/shared-narrative-cards.test.ts`
Expected: FAIL with "Cannot find module './shared-narrative-cards'"

- [ ] **Step 3: Write minimal implementation**

```typescript
// ads-agent/lib/openui/shared-narrative-cards.ts
import { defineComponent } from "@openuidev/lang-core";
import React from "react";
import { z } from "zod";

const InsightCalloutSchema = z.object({
  headline: z.string(),
  supportingStat: z.string().optional().default(""),
  tone: z.enum(["neutral", "positive", "negative"]).optional().default("neutral"),
});
export type InsightCalloutProps = z.infer<typeof InsightCalloutSchema>;
export type InsightCalloutViewInput = { [K in keyof InsightCalloutProps]?: InsightCalloutProps[K] | null };

const TONE_ACCENT: Record<InsightCalloutProps["tone"], string> = {
  neutral: "border-l-4 border-l-muted-foreground/40",
  positive: "border-l-4 border-l-emerald-500",
  negative: "border-l-4 border-l-destructive",
};

/** Pure, read-only presentation — the default fallback for any qualitative ("why") answer that
 * isn't a chart/table. Dual-mode: called directly, or wrapped via defineComponent() below. */
export function InsightCalloutView(raw: InsightCalloutViewInput) {
  const headline = raw.headline ?? "";
  const supportingStat = raw.supportingStat ?? "";
  const tone = raw.tone ?? "neutral";
  return React.createElement(
    "div",
    { className: `flex flex-col gap-1 rounded-lg border border-border bg-card p-4 ${TONE_ACCENT[tone]}` },
    React.createElement("span", { className: "text-sm font-medium text-card-foreground" }, headline),
    supportingStat && React.createElement("span", { className: "text-xs text-muted-foreground" }, supportingStat),
  );
}

export const InsightCallout = defineComponent({
  name: "InsightCallout",
  description:
    "Displays a short headline and an optional one-line supporting stat, with a tone accent " +
    "(neutral/positive/negative). Args are POSITIONAL in that key order. Unset supportingStat is " +
    "\"\"; unset tone is \"neutral\". Use as the default answer shape for qualitative or \"why\" " +
    "questions that have no more specific component match.",
  props: InsightCalloutSchema,
  component: ({ props }: { props: InsightCalloutViewInput }) => React.createElement(InsightCalloutView, props),
});

const ChecklistItemSchema = z.object({
  text: z.string(),
  status: z.enum(["done", "pending", "warning"]),
});
const ChecklistCardSchema = z.object({
  title: z.string().optional().default(""),
  items: z.array(ChecklistItemSchema).optional().default([]),
});
export type ChecklistCardProps = z.infer<typeof ChecklistCardSchema>;
export type ChecklistCardViewInput = {
  title?: string | null;
  items?: (z.infer<typeof ChecklistItemSchema> | null)[] | null;
};

const STATUS_MARK: Record<z.infer<typeof ChecklistItemSchema>["status"], string> = {
  done: "✓",
  pending: "○",
  warning: "!",
};
const STATUS_CLASS: Record<z.infer<typeof ChecklistItemSchema>["status"], string> = {
  done: "text-emerald-600 dark:text-emerald-400",
  pending: "text-muted-foreground",
  warning: "text-destructive",
};

/** Pure, read-only presentation of a multi-item checklist. Dual-mode, same convention as above. */
export function ChecklistCardView(raw: ChecklistCardViewInput) {
  const title = raw.title ?? "";
  const items = raw.items ?? [];
  return React.createElement(
    "div",
    { className: "flex flex-col gap-2 rounded-lg border border-border bg-card p-4" },
    title && React.createElement("span", { className: "text-sm font-medium text-card-foreground" }, title),
    items.length === 0
      ? React.createElement("p", { className: "text-sm text-muted-foreground" }, "Nothing to review.")
      : React.createElement(
          "ul",
          { className: "flex flex-col gap-1.5" },
          ...items.map(
            (item, index) =>
              item &&
              React.createElement(
                "li",
                { key: index, className: "flex items-start gap-2 text-sm" },
                React.createElement("span", { className: `w-4 shrink-0 font-medium ${STATUS_CLASS[item.status]}` }, STATUS_MARK[item.status]),
                React.createElement("span", { className: "text-card-foreground" }, item.text),
              ),
          ),
        ),
  );
}

export const ChecklistCard = defineComponent({
  name: "ChecklistCard",
  description:
    "Displays a titled list of items, each with a status (done/pending/warning) shown as an icon. " +
    "Args are POSITIONAL in that key order. Unset title is \"\"; unset items is []. Use for " +
    "multi-item answers (\"3 things to review today\") instead of a numbered-list paragraph.",
  props: ChecklistCardSchema,
  component: ({ props }: { props: ChecklistCardViewInput }) => React.createElement(ChecklistCardView, props),
});

const AlertBannerSchema = z.object({
  severity: z.enum(["info", "warning", "critical"]),
  title: z.string(),
  detail: z.string().optional().default(""),
});
export type AlertBannerProps = z.infer<typeof AlertBannerSchema>;
export type AlertBannerViewInput = { [K in keyof AlertBannerProps]?: AlertBannerProps[K] | null };

const SEVERITY_CLASS: Record<AlertBannerProps["severity"], string> = {
  info: "border-border bg-card text-card-foreground",
  warning: "border-amber-500/50 bg-amber-500/10 text-card-foreground",
  critical: "border-destructive/50 bg-destructive/10 text-destructive",
};

/** Pure, read-only presentation — distinct heavier visual weight than InsightCallout, for the
 * "why is this flagged?" answer after a user clicks a proactive-signaling badge (see foundation
 * spec's Proactive signaling section). Dual-mode, same convention as above. */
export function AlertBannerView(raw: AlertBannerViewInput) {
  const severity = raw.severity ?? "info";
  const title = raw.title ?? "";
  const detail = raw.detail ?? "";
  return React.createElement(
    "div",
    { className: `flex flex-col gap-1 rounded-lg border p-4 ${SEVERITY_CLASS[severity]}` },
    React.createElement("span", { className: "text-sm font-semibold" }, title),
    detail && React.createElement("span", { className: "text-xs opacity-90" }, detail),
  );
}

export const AlertBanner = defineComponent({
  name: "AlertBanner",
  description:
    "Displays a severity-flagged alert (info/warning/critical) with a title and optional detail " +
    "sentence. Args are POSITIONAL in that key order. Unset detail is \"\". Use when explaining why " +
    "something was flagged as urgent — visually heavier than InsightCallout on purpose.",
  props: AlertBannerSchema,
  component: ({ props }: { props: AlertBannerViewInput }) => React.createElement(AlertBannerView, props),
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ads-agent && npx vitest run lib/openui/shared-narrative-cards.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
cd ads-agent && npx eslint lib/openui/shared-narrative-cards.ts lib/openui/shared-narrative-cards.test.ts
git add lib/openui/shared-narrative-cards.ts lib/openui/shared-narrative-cards.test.ts
git commit -m "feat: add InsightCallout, ChecklistCard, and AlertBanner shared OpenUI components"
```

---

### Task 3: `shared-structured-views.ts` — `ComparisonCard`, `Timeline`, `RankedList`, `BatchActionConfirm`

**Files:**
- Create: `ads-agent/lib/openui/shared-structured-views.ts`
- Test: `ads-agent/lib/openui/shared-structured-views.test.ts`

**Interfaces:**
- Consumes: nothing new — only `zod`, `react`, `@openuidev/lang-core`'s `defineComponent`.
- Produces: `ComparisonCard`, `Timeline`, `RankedList`, `BatchActionConfirm` (`DefinedComponent`s) +
  their `*View` functions and prop types, all exported. Task 8 imports the four `DefinedComponent`
  values.

- [ ] **Step 1: Write the failing test**

```typescript
// ads-agent/lib/openui/shared-structured-views.test.ts
import { describe, expect, it } from "vitest";
import {
  ComparisonCard, ComparisonCardView,
  Timeline, TimelineView,
  RankedList, RankedListView,
  BatchActionConfirm, BatchActionConfirmView,
} from "./shared-structured-views";

describe("ComparisonCardView", () => {
  it("renders both sides of a comparison", () => {
    const tree = ComparisonCardView({ title: "This week vs last week", leftLabel: "Last week", leftValue: "₹8,200", rightLabel: "This week", rightValue: "₹9,600" });
    expect(tree).toBeTruthy();
  });
  it("does not throw without a title", () => {
    expect(() => ComparisonCardView({ leftLabel: "Before", leftValue: "3", rightLabel: "After", rightValue: "7" })).not.toThrow();
  });
});
describe("ComparisonCard (OpenUI component)", () => {
  it("is named ComparisonCard", () => expect(ComparisonCard.name).toBe("ComparisonCard"));
});

describe("TimelineView", () => {
  it("renders chronological events", () => {
    const tree = TimelineView({ title: "Lead activity", events: [{ timestamp: "2026-08-01", description: "Lead created" }, { timestamp: "2026-08-03", description: "Moved to qualified" }] });
    expect(tree).toBeTruthy();
  });
  it("does not throw on an empty events array", () => {
    expect(() => TimelineView({ events: [] })).not.toThrow();
  });
});
describe("Timeline (OpenUI component)", () => {
  it("is named Timeline", () => expect(Timeline.name).toBe("Timeline"));
});

describe("RankedListView", () => {
  it("renders ranked items with badges", () => {
    const tree = RankedListView({ title: "Top campaigns by spend", items: [{ label: "Whitefield HSR", value: "₹12,400" }, { label: "Indiranagar", value: "₹9,100" }] });
    expect(tree).toBeTruthy();
  });
  it("does not throw on an empty items array", () => {
    expect(() => RankedListView({ items: [] })).not.toThrow();
  });
});
describe("RankedList (OpenUI component)", () => {
  it("is named RankedList", () => expect(RankedList.name).toBe("RankedList"));
});

describe("BatchActionConfirmView", () => {
  it("renders affected items with from/to state", () => {
    const tree = BatchActionConfirmView({ actionLabel: "Pause these 2 underperforming campaigns?", items: [{ label: "Whitefield HSR", fromState: "active", toState: "paused" }, { label: "Indiranagar Launch", fromState: "active", toState: "paused" }] });
    expect(tree).toBeTruthy();
  });
  it("does not throw on an empty items array", () => {
    expect(() => BatchActionConfirmView({ actionLabel: "Confirm?", items: [] })).not.toThrow();
  });
});
describe("BatchActionConfirm (OpenUI component)", () => {
  it("is named BatchActionConfirm", () => expect(BatchActionConfirm.name).toBe("BatchActionConfirm"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ads-agent && npx vitest run lib/openui/shared-structured-views.test.ts`
Expected: FAIL with "Cannot find module './shared-structured-views'"

- [ ] **Step 3: Write minimal implementation**

```typescript
// ads-agent/lib/openui/shared-structured-views.ts
import { defineComponent } from "@openuidev/lang-core";
import React from "react";
import { z } from "zod";

const ComparisonCardSchema = z.object({
  title: z.string().optional().default(""),
  leftLabel: z.string(),
  leftValue: z.string(),
  rightLabel: z.string(),
  rightValue: z.string(),
});
export type ComparisonCardProps = z.infer<typeof ComparisonCardSchema>;
export type ComparisonCardViewInput = { [K in keyof ComparisonCardProps]?: ComparisonCardProps[K] | null };

/** Pure, read-only presentation of a two-sided before/after or A-vs-B comparison. Dual-mode. */
export function ComparisonCardView(raw: ComparisonCardViewInput) {
  const title = raw.title ?? "";
  const side = (label: string, value: string) =>
    React.createElement(
      "div",
      { className: "flex flex-1 flex-col gap-1 rounded-lg border border-border bg-card p-4" },
      React.createElement("span", { className: "text-xs font-medium text-muted-foreground" }, label),
      React.createElement("span", { className: "text-xl font-semibold text-card-foreground" }, value),
    );
  return React.createElement(
    "div",
    { className: "flex flex-col gap-2" },
    title && React.createElement("span", { className: "text-sm font-medium text-card-foreground" }, title),
    React.createElement(
      "div",
      { className: "flex gap-3" },
      side(raw.leftLabel ?? "", raw.leftValue ?? ""),
      side(raw.rightLabel ?? "", raw.rightValue ?? ""),
    ),
  );
}

export const ComparisonCard = defineComponent({
  name: "ComparisonCard",
  description:
    "Displays a two-sided before/after or A-vs-B comparison: an optional title, then a left " +
    "{label, value} and a right {label, value} side by side. Args are POSITIONAL in that key order " +
    "(title, leftLabel, leftValue, rightLabel, rightValue). Unset title is \"\". Use for " +
    "this-week-vs-last-week, campaign A/B, or lead-tier-shift questions.",
  props: ComparisonCardSchema,
  component: ({ props }: { props: ComparisonCardViewInput }) => React.createElement(ComparisonCardView, props),
});

const TimelineEventSchema = z.object({ timestamp: z.string(), description: z.string() });
const TimelineSchema = z.object({
  title: z.string().optional().default(""),
  events: z.array(TimelineEventSchema).optional().default([]),
});
export type TimelineProps = z.infer<typeof TimelineSchema>;
export type TimelineViewInput = {
  title?: string | null;
  events?: (z.infer<typeof TimelineEventSchema> | null)[] | null;
};

/** Pure, read-only presentation of a chronological event list. Dual-mode. Reusable for CRM lead
 * activity, a campaign change log, or a Reports audit trail — one component, multiple callers. */
export function TimelineView(raw: TimelineViewInput) {
  const title = raw.title ?? "";
  const events = raw.events ?? [];
  return React.createElement(
    "div",
    { className: "flex flex-col gap-2 rounded-lg border border-border bg-card p-4" },
    title && React.createElement("span", { className: "text-sm font-medium text-card-foreground" }, title),
    events.length === 0
      ? React.createElement("p", { className: "text-sm text-muted-foreground" }, "No events yet.")
      : React.createElement(
          "ol",
          { className: "flex flex-col gap-2 border-l border-border pl-3" },
          ...events.map(
            (event, index) =>
              event &&
              React.createElement(
                "li",
                { key: index, className: "flex flex-col text-sm" },
                React.createElement("span", { className: "text-xs text-muted-foreground" }, event.timestamp),
                React.createElement("span", { className: "text-card-foreground" }, event.description),
              ),
          ),
        ),
  );
}

export const Timeline = defineComponent({
  name: "Timeline",
  description:
    "Displays a chronological list of {timestamp, description} events under an optional title. " +
    "Args are POSITIONAL in that key order. Unset title is \"\"; unset events is []. Use for lead " +
    "activity history, a campaign change log, or an audit trail.",
  props: TimelineSchema,
  component: ({ props }: { props: TimelineViewInput }) => React.createElement(TimelineView, props),
});

const RankedItemSchema = z.object({ label: z.string(), value: z.string() });
const RankedListSchema = z.object({
  title: z.string().optional().default(""),
  items: z.array(RankedItemSchema).optional().default([]),
});
export type RankedListProps = z.infer<typeof RankedListSchema>;
export type RankedListViewInput = {
  title?: string | null;
  items?: (z.infer<typeof RankedItemSchema> | null)[] | null;
};

/** Pure, read-only presentation of a ranked top-N list with rank badges. Dual-mode. Reusable for
 * top campaigns by spend, top leads by score, or top corridors by budget burn. */
export function RankedListView(raw: RankedListViewInput) {
  const title = raw.title ?? "";
  const items = raw.items ?? [];
  return React.createElement(
    "div",
    { className: "flex flex-col gap-2 rounded-lg border border-border bg-card p-4" },
    title && React.createElement("span", { className: "text-sm font-medium text-card-foreground" }, title),
    items.length === 0
      ? React.createElement("p", { className: "text-sm text-muted-foreground" }, "Nothing to rank yet.")
      : React.createElement(
          "ol",
          { className: "flex flex-col gap-1.5" },
          ...items.map(
            (item, index) =>
              item &&
              React.createElement(
                "li",
                { key: index, className: "flex items-center justify-between gap-2 text-sm" },
                React.createElement(
                  "span",
                  { className: "flex items-center gap-2" },
                  React.createElement(
                    "span",
                    { className: "flex size-5 items-center justify-center rounded-full bg-secondary text-xs font-medium text-secondary-foreground" },
                    String(index + 1),
                  ),
                  React.createElement("span", { className: "text-card-foreground" }, item.label),
                ),
                React.createElement("span", { className: "font-medium text-card-foreground" }, item.value),
              ),
          ),
        ),
  );
}

export const RankedList = defineComponent({
  name: "RankedList",
  description:
    "Displays a ranked top-N list of {label, value} items with rank badges (1, 2, 3, ...) under an " +
    "optional title. Args are POSITIONAL in that key order. Unset title is \"\"; unset items is []. " +
    "Use for \"top N by X\" questions.",
  props: RankedListSchema,
  component: ({ props }: { props: RankedListViewInput }) => React.createElement(RankedListView, props),
});

const BatchActionItemSchema = z.object({
  label: z.string(),
  fromState: z.string().optional().default(""),
  toState: z.string().optional().default(""),
});
const BatchActionConfirmSchema = z.object({
  actionLabel: z.string(),
  items: z.array(BatchActionItemSchema).optional().default([]),
});
export type BatchActionConfirmProps = z.infer<typeof BatchActionConfirmSchema>;
export type BatchActionConfirmViewInput = {
  actionLabel?: string | null;
  items?: (z.infer<typeof BatchActionItemSchema> | null)[] | null;
};

/**
 * Pure, read-only presentation of a pending multi-item action — the batch-aware counterpart to
 * Spec 3's (unbuilt) single-item StageChangeConfirm. Same dual-mode convention as SetupCardView:
 * no onClick/onChange props, matching every other component in this file.
 *
 * ponytail: renders "Confirm"/"Cancel" as plain, unwired button elements — actually firing the
 * pending action is OpenUI's own Mutation()/@Run action system driven by a real ToolProvider
 * mutation, and platform-tools.ts (Task 10) ships with zero registered tools today (see this
 * plan's Global Constraints), so there is nothing for a click to invoke yet. Ceiling: this
 * component is visually complete but not wired to any real confirm/cancel action until a domain
 * registers its first mutation tool. Upgrade path: once Spec 3 (or any domain) adds a real
 * mutation ToolSpec, wire this view's buttons through OpenUI's Mutation() binding the same way
 * StageChangeConfirm is expected to.
 */
export function BatchActionConfirmView(raw: BatchActionConfirmViewInput) {
  const actionLabel = raw.actionLabel ?? "";
  const items = raw.items ?? [];
  return React.createElement(
    "div",
    { className: "flex flex-col gap-3 rounded-lg border border-border bg-card p-4" },
    React.createElement("span", { className: "text-sm font-medium text-card-foreground" }, actionLabel),
    items.length > 0 &&
      React.createElement(
        "ul",
        { className: "flex flex-col gap-1.5" },
        ...items.map(
          (item, index) =>
            item &&
            React.createElement(
              "li",
              { key: index, className: "flex items-center justify-between text-sm" },
              React.createElement("span", { className: "text-card-foreground" }, item.label),
              (item.fromState || item.toState) &&
                React.createElement(
                  "span",
                  { className: "text-xs text-muted-foreground" },
                  `${item.fromState || "—"} → ${item.toState || "—"}`,
                ),
            ),
        ),
      ),
    React.createElement(
      "div",
      { className: "flex gap-2" },
      React.createElement("button", { type: "button", className: "rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground" }, "Confirm"),
      React.createElement("button", { type: "button", className: "rounded-md border border-border px-3 py-1.5 text-xs font-medium text-card-foreground" }, "Cancel"),
    ),
  );
}

export const BatchActionConfirm = defineComponent({
  name: "BatchActionConfirm",
  description:
    "Shows a pending multi-item action before it executes: an action label (e.g. \"Pause these 3 " +
    "underperforming campaigns?\") and a list of affected items, each with an optional " +
    "fromState/toState. Args are POSITIONAL in that key order. Unset items is []. Use when the " +
    "model is about to act on multiple items at once — never execute the action without this " +
    "confirmation rendering first.",
  props: BatchActionConfirmSchema,
  component: ({ props }: { props: BatchActionConfirmViewInput }) => React.createElement(BatchActionConfirmView, props),
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ads-agent && npx vitest run lib/openui/shared-structured-views.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
cd ads-agent && npx eslint lib/openui/shared-structured-views.ts lib/openui/shared-structured-views.test.ts
git add lib/openui/shared-structured-views.ts lib/openui/shared-structured-views.test.ts
git commit -m "feat: add ComparisonCard, Timeline, RankedList, and BatchActionConfirm shared OpenUI components"
```

---

### Task 4: `AskAiTrigger.tsx` — the per-component AI handoff

**Files:**
- Create: `ads-agent/components/AskAiTrigger.tsx`
- Test: `ads-agent/components/AskAiTrigger.test.tsx`

**Interfaces:**
- Consumes: nothing new — `react`, `lucide-react` (`Sparkles`), `@/lib/utils`'s `cn`.
- Produces: `AskAiTrigger` React component with props `{ question: string; onAsk: (question: string) =>
  void; className?: string }`. `onAsk` is dependency-injected (not read from a specific Context
  internally) so this component has zero dependency on `CopilotProvider` (Task 5) and can be
  parallelized against it — any future caller (an embedded page chat, or the global Copilot via
  `useCopilot().seedAndOpen`, wired in a later task/spec) supplies its own handoff behavior. No task
  in this plan wires a real caller — per the spec's own Implementation order, this is "pure UI, no
  backend dependency," consumed by future Specs 2/3 pages.

- [ ] **Step 1: Write the failing test**

```typescript
// ads-agent/components/AskAiTrigger.test.tsx
import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AskAiTrigger } from "./AskAiTrigger";

describe("AskAiTrigger", () => {
  it("renders a button with an accessible label naming the question", () => {
    const html = renderToStaticMarkup(createElement(AskAiTrigger, { question: "Explain why CPL rose on Whitefield", onAsk: () => {} }));
    expect(html).toContain("Explain why CPL rose on Whitefield");
    expect(html).toContain("<button");
  });

  it("calls onAsk with the question when clicked — verified via the onClick handler directly (no jsdom/RTL in this repo)", () => {
    const onAsk = vi.fn();
    // AskAiTrigger's implementation must expose a plain onClick={() => onAsk(question)} handler;
    // we invoke the component function directly and call the returned element's onClick prop,
    // matching this repo's existing "call the function, inspect the tree" test convention
    // (no @testing-library/react dependency — see this plan's Global Constraints).
    const element = AskAiTrigger({ question: "Why did this lead go cold?", onAsk }) as { props: { onClick: () => void } };
    element.props.onClick();
    expect(onAsk).toHaveBeenCalledWith("Why did this lead go cold?");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ads-agent && npx vitest run components/AskAiTrigger.test.tsx`
Expected: FAIL with "Cannot find module './AskAiTrigger'"

- [ ] **Step 3: Write minimal implementation**

```tsx
// ads-agent/components/AskAiTrigger.tsx
"use client";

import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  /** Pre-seeded question, referencing the specific item's identity/data — e.g. "Explain why CPL
   * rose on Whitefield HSR Launch". */
  question: string;
  /** Opens the relevant chat surface (the embedded page chat if one exists for this domain,
   * otherwise the global Copilot) with `question` pre-seeded. Dependency-injected so this
   * component has no direct dependency on any specific chat surface's state. */
  onAsk: (question: string) => void;
  className?: string;
};

/**
 * Small sparkle-icon trigger, visible on hover — the concrete per-component handoff into the
 * model path (foundation spec's "AskAiTrigger — the per-component handoff"). A parent component
 * that wants this hover-reveal behavior wraps its container with `className="group"`; this
 * button's own className includes `opacity-0 group-hover:opacity-100` so it only appears when the
 * user hovers the parent (a KpiCard, an OpportunityCard, a table row, a board card, etc.).
 */
export function AskAiTrigger({ question, onAsk, className }: Props) {
  return (
    <button
      type="button"
      onClick={() => onAsk(question)}
      aria-label={`Ask AI: ${question}`}
      title={`Ask AI: ${question}`}
      className={cn(
        "flex size-6 items-center justify-center rounded-full border border-border bg-card text-muted-foreground opacity-0 transition-opacity hover:text-card-foreground focus-visible:opacity-100 group-hover:opacity-100",
        className,
      )}
    >
      <Sparkles className="size-3.5" aria-hidden="true" />
    </button>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ads-agent && npx vitest run components/AskAiTrigger.test.tsx`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
cd ads-agent && npx eslint components/AskAiTrigger.tsx components/AskAiTrigger.test.tsx
git add components/AskAiTrigger.tsx components/AskAiTrigger.test.tsx
git commit -m "feat: add AskAiTrigger per-component AI handoff button"
```

---

### Task 5: `copilot-state.ts` (reducer) + `CopilotProvider.tsx`

**Files:**
- Create: `ads-agent/components/copilot/copilot-state.ts`
- Create: `ads-agent/components/copilot/copilot-state.test.ts`
- Create: `ads-agent/components/copilot/CopilotProvider.tsx`

**Interfaces:**
- Consumes: nothing new — `react` only.
- Produces: `CopilotMessage` type (`{ id: string; role: "user" | "assistant"; content: string }`),
  `CopilotState`, `CopilotAction`, `copilotReducer`, `initialCopilotState` (all from
  `copilot-state.ts`) — the tested core. `CopilotProvider` (React Context component) and `useCopilot()`
  hook (from `CopilotProvider.tsx`) exposing: `isOpen: boolean`, `messages: CopilotMessage[]`,
  `pendingQuestion: string | null`, `open()`, `close()`, `toggle()`, `seedAndOpen(question: string)`,
  `appendMessage(message: CopilotMessage)`, `clearPendingQuestion()`. Task 9 (`CopilotFab`) consumes
  `isOpen`/`toggle()`. Task 11 (`CopilotPanel`) consumes all of the above. Task 13 (layout wiring)
  consumes `CopilotProvider` itself.

**Note on test strategy:** this repo has no `@testing-library/react` (see Global Constraints), so the
real test cycle below is `copilot-state.test.ts` (the pure reducer — all the meaningful state-transition
logic). `CopilotProvider.tsx` itself is a thin `useReducer` + Context wrapper with no independent logic
to unit test; it gets a documented manual-verification step instead (same "thin wrapper, verified
manually" treatment the v2 dashboard plan already gave its own thin integration components).

- [ ] **Step 1: Write the failing test**

```typescript
// ads-agent/components/copilot/copilot-state.test.ts
import { describe, expect, it } from "vitest";
import { copilotReducer, initialCopilotState, type CopilotMessage } from "./copilot-state";

describe("copilotReducer", () => {
  it("starts closed with no messages", () => {
    expect(initialCopilotState.isOpen).toBe(false);
    expect(initialCopilotState.messages).toEqual([]);
    expect(initialCopilotState.pendingQuestion).toBeNull();
  });

  it("OPEN sets isOpen true; CLOSE sets it false; TOGGLE flips it", () => {
    let state = copilotReducer(initialCopilotState, { type: "OPEN" });
    expect(state.isOpen).toBe(true);
    state = copilotReducer(state, { type: "CLOSE" });
    expect(state.isOpen).toBe(false);
    state = copilotReducer(state, { type: "TOGGLE" });
    expect(state.isOpen).toBe(true);
    state = copilotReducer(state, { type: "TOGGLE" });
    expect(state.isOpen).toBe(false);
  });

  it("SEED_AND_OPEN opens the panel and sets pendingQuestion", () => {
    const state = copilotReducer(initialCopilotState, { type: "SEED_AND_OPEN", question: "Why did CPL rise?" });
    expect(state.isOpen).toBe(true);
    expect(state.pendingQuestion).toBe("Why did CPL rise?");
  });

  it("CLEAR_PENDING_QUESTION nulls it out without touching messages or isOpen", () => {
    const seeded = copilotReducer(initialCopilotState, { type: "SEED_AND_OPEN", question: "q" });
    const cleared = copilotReducer(seeded, { type: "CLEAR_PENDING_QUESTION" });
    expect(cleared.pendingQuestion).toBeNull();
    expect(cleared.isOpen).toBe(true);
  });

  it("APPEND_MESSAGE appends to the message history, preserving order", () => {
    const m1: CopilotMessage = { id: "1", role: "user", content: "hi" };
    const m2: CopilotMessage = { id: "2", role: "assistant", content: "hello" };
    let state = copilotReducer(initialCopilotState, { type: "APPEND_MESSAGE", message: m1 });
    state = copilotReducer(state, { type: "APPEND_MESSAGE", message: m2 });
    expect(state.messages).toEqual([m1, m2]);
  });

  it("state survives being threaded through multiple actions in sequence (simulates a route change not resetting it)", () => {
    let state = initialCopilotState;
    state = copilotReducer(state, { type: "OPEN" });
    state = copilotReducer(state, { type: "APPEND_MESSAGE", message: { id: "1", role: "user", content: "hi" } });
    // A route change does not dispatch any action — this just documents that copilotReducer never
    // resets state on its own; CopilotProvider owns the same reducer instance across navigation
    // because it's mounted once at (admin)/layout.tsx (verified manually in Task 13).
    expect(state.isOpen).toBe(true);
    expect(state.messages).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ads-agent && npx vitest run components/copilot/copilot-state.test.ts`
Expected: FAIL with "Cannot find module './copilot-state'"

- [ ] **Step 3: Write minimal implementation**

```typescript
// ads-agent/components/copilot/copilot-state.ts
export type CopilotMessage = { id: string; role: "user" | "assistant"; content: string };

export type CopilotState = {
  isOpen: boolean;
  messages: CopilotMessage[];
  pendingQuestion: string | null;
};

export type CopilotAction =
  | { type: "OPEN" }
  | { type: "CLOSE" }
  | { type: "TOGGLE" }
  | { type: "SEED_AND_OPEN"; question: string }
  | { type: "CLEAR_PENDING_QUESTION" }
  | { type: "APPEND_MESSAGE"; message: CopilotMessage };

export const initialCopilotState: CopilotState = {
  isOpen: false,
  messages: [],
  pendingQuestion: null,
};

export function copilotReducer(state: CopilotState, action: CopilotAction): CopilotState {
  switch (action.type) {
    case "OPEN":
      return { ...state, isOpen: true };
    case "CLOSE":
      return { ...state, isOpen: false };
    case "TOGGLE":
      return { ...state, isOpen: !state.isOpen };
    case "SEED_AND_OPEN":
      return { ...state, isOpen: true, pendingQuestion: action.question };
    case "CLEAR_PENDING_QUESTION":
      return { ...state, pendingQuestion: null };
    case "APPEND_MESSAGE":
      return { ...state, messages: [...state.messages, action.message] };
    default:
      return state;
  }
}
```

```tsx
// ads-agent/components/copilot/CopilotProvider.tsx
"use client";

import { createContext, useContext, useMemo, useReducer, type ReactNode } from "react";
import { copilotReducer, initialCopilotState, type CopilotMessage } from "./copilot-state";

type CopilotContextValue = {
  isOpen: boolean;
  messages: CopilotMessage[];
  pendingQuestion: string | null;
  open: () => void;
  close: () => void;
  toggle: () => void;
  /** Opens the Copilot panel and pre-seeds `question` — the handoff target for AskAiTrigger and
   * proactive-signaling badge clicks (foundation spec's Proactive signaling section). */
  seedAndOpen: (question: string) => void;
  clearPendingQuestion: () => void;
  appendMessage: (message: CopilotMessage) => void;
};

const CopilotContext = createContext<CopilotContextValue | null>(null);

/**
 * Mounted once at (admin)/layout.tsx (Task 13) so open/closed state and message history survive
 * navigation between Home/Marketing/CRM/Reports — a floating overlay with one continuous
 * conversation, per the foundation spec's Global Copilot persistence requirement.
 */
export function CopilotProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(copilotReducer, initialCopilotState);

  const value = useMemo<CopilotContextValue>(
    () => ({
      isOpen: state.isOpen,
      messages: state.messages,
      pendingQuestion: state.pendingQuestion,
      open: () => dispatch({ type: "OPEN" }),
      close: () => dispatch({ type: "CLOSE" }),
      toggle: () => dispatch({ type: "TOGGLE" }),
      seedAndOpen: (question: string) => dispatch({ type: "SEED_AND_OPEN", question }),
      clearPendingQuestion: () => dispatch({ type: "CLEAR_PENDING_QUESTION" }),
      appendMessage: (message: CopilotMessage) => dispatch({ type: "APPEND_MESSAGE", message }),
    }),
    [state],
  );

  return <CopilotContext.Provider value={value}>{children}</CopilotContext.Provider>;
}

export function useCopilot(): CopilotContextValue {
  const ctx = useContext(CopilotContext);
  if (!ctx) throw new Error("useCopilot() must be called within a CopilotProvider");
  return ctx;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ads-agent && npx vitest run components/copilot/copilot-state.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Manually verify `CopilotProvider.tsx`**

Run: `cd ads-agent && npx tsc --noEmit` (confirms the Context/hook types compile — no runtime harness
exists for a bare Context component in this repo). Read the file once more and confirm `useCopilot()`
throws a clear error outside a `<CopilotProvider>` (defensive check already in Step 3's code) — this is
the manual-verification step this task substitutes for a component-render test.

- [ ] **Step 6: Commit**

```bash
cd ads-agent && npx eslint components/copilot/copilot-state.ts components/copilot/copilot-state.test.ts components/copilot/CopilotProvider.tsx
git add components/copilot/copilot-state.ts components/copilot/copilot-state.test.ts components/copilot/CopilotProvider.tsx
git commit -m "feat: add Copilot state reducer and CopilotProvider context"
```

---

### Task 6: Verify Spec 1 dual-mode convention compliance (audit)

**Files:**
- Read-only inspection: `ads-agent/lib/openui/campaign-library.ts`,
  `ads-agent/components/campaign-draft-chat/AiSetupView.tsx`
- Modify (only if a real gap is found — expected: no changes needed):
  `ads-agent/lib/openui/campaign-library.ts`

**Interfaces:**
- Consumes: nothing — this task reads existing, shipped code.
- Produces: a short written confirmation (paste into the task's report, not a new file) that
  `SetupCardView` already satisfies the dual-mode convention the foundation spec generalizes. No other
  task in this plan depends on this task's output — it's independently reviewable and safe to run
  fully in parallel with everything else in Wave 1.

- [ ] **Step 1: Check the convention's three criteria against `SetupCardView`**

The dual-mode convention (foundation spec, "The hybrid rendering model") requires, for a component to
be usable both by direct data-fetch and by the model path:

1. **A plain React function taking typed props**, callable directly with no OpenUI machinery.
2. **A separate `defineComponent()` wrapper** whose `component` field is a thin adapter
   (`({ props }) => React.createElement(View, props)`) — the wrapper does not duplicate rendering
   logic.
3. **Defensive normalization of `null`** on every optional prop, since OpenUI's streaming Renderer may
   hand the component `null` before Zod defaults apply (this is the exact bug this spec's own
   investigation fixed elsewhere in `campaign-chat.ts` — see the Resilience section — the convention
   check here is about the component's *props handling*, a different, already-fixed concern:
   `campaign-library.test.ts`'s existing "does not throw when OpenUI streaming passes null array
   props" test already covers this for `SetupCardView`).

Run: `cd ads-agent && npx vitest run lib/openui/campaign-library.test.ts`
Expected: PASS (existing suite, unmodified) — confirms criterion 3 already has a regression test.

- [ ] **Step 2: Read `campaign-library.ts` lines 63-167 and confirm criteria 1 and 2 directly**

Read `SetupCardView` (a plain function, `raw: SetupCardViewInput` typed, no OpenUI imports used
inside its body) and the `SetupCard = defineComponent({ ..., component: ({ props }) =>
React.createElement(SetupCardView, props) })` block immediately below it. Confirm the `component`
field is exactly the thin one-line adapter shape criterion 2 requires — it is (see the file as read
during this plan's own investigation, reproduced in this plan's context above).

- [ ] **Step 3: Confirm the deterministic (direct data-fetch) call site**

Read `AiSetupView.tsx`'s non-streaming branch: `<SetupCardView assistantReply="" status={draft.status}
... />` — this is the deterministic-path call the convention requires (no LLM call, called directly
from real `draft` state). Confirms `SetupCardView` is genuinely dual-mode today, not model-path-only.

- [ ] **Step 4: Record the finding**

Expected finding (per the spec's own Implementation order item 6): **no changes needed.**
`SetupCardView`/`SetupCard` already satisfy all three criteria — it is the reference implementation
every new component in Tasks 1-3 above was written to match. State this explicitly in the task's
completion report; if Step 1 or Step 2 instead surfaces a real gap, fix it in
`campaign-library.ts` and add a regression test to `campaign-library.test.ts` before reporting DONE
(escalate to the human first if the fix would touch the shipped `SetupCardSchema`'s field shape,
since that's a wider blast radius than this audit's scope).

- [ ] **Step 5: Commit (only if Step 4 required a code change; otherwise skip — nothing to commit)**

```bash
cd ads-agent && npx vitest run lib/openui/campaign-library.test.ts
git add lib/openui/campaign-library.ts lib/openui/campaign-library.test.ts
git commit -m "fix: close a dual-mode convention gap found in SetupCardView audit"
```

---

### Task 7: `lib/openui/parse-retry.ts` — generic bounded-retry helper

**Files:**
- Create: `ads-agent/lib/openui/parse-retry.ts`
- Test: `ads-agent/lib/openui/parse-retry.test.ts`

**Interfaces:**
- Consumes: nothing — zero repo-specific imports, fully generic.
- Produces: `ParseAttempt<T>`, `ParseFn<T>`, `RetryModelFn`, `parseWithBoundedRetry()` — all exported.
  Task 12 (`copilot-chat.ts`) is the consumer, supplying its own `parse` function
  (`parseCopilotResponse`) and `retryModel` function (pushes feedback onto the message history and
  calls the model once more).

- [ ] **Step 1: Write the failing test**

```typescript
// ads-agent/lib/openui/parse-retry.test.ts
import { describe, expect, it, vi } from "vitest";
import { parseWithBoundedRetry, type ParseAttempt } from "./parse-retry";

function fakeParse(text: string): ParseAttempt<string> {
  return text === "valid" ? { kind: "ok", value: text } : { kind: "error", errors: [`bad text: "${text}"`] };
}

describe("parseWithBoundedRetry", () => {
  it("returns ok immediately without calling retryModel when the first parse succeeds", async () => {
    const retryModel = vi.fn();
    const result = await parseWithBoundedRetry("valid", fakeParse, retryModel);
    expect(result).toEqual({ kind: "ok", value: "valid" });
    expect(retryModel).not.toHaveBeenCalled();
  });

  it("retries exactly once with the specific errors, and succeeds if the retry parses", async () => {
    const retryModel = vi.fn().mockResolvedValue("valid");
    const result = await parseWithBoundedRetry("garbled", fakeParse, retryModel);
    expect(result).toEqual({ kind: "ok", value: "valid" });
    expect(retryModel).toHaveBeenCalledTimes(1);
    expect(retryModel.mock.calls[0][0]).toContain('bad text: "garbled"');
  });

  it("gives up after one failed retry — never loops, returns the second failure's errors", async () => {
    const retryModel = vi.fn().mockResolvedValue("still garbled");
    const result = await parseWithBoundedRetry("garbled", fakeParse, retryModel);
    expect(result.kind).toBe("error");
    if (result.kind === "error") expect(result.errors[0]).toContain('bad text: "still garbled"');
    expect(retryModel).toHaveBeenCalledTimes(1);
  });

  it("propagates an exception thrown by retryModel (e.g. InsufficientCreditsError) rather than swallowing it", async () => {
    class FakeCreditsError extends Error {}
    const retryModel = vi.fn().mockRejectedValue(new FakeCreditsError("out of credits"));
    await expect(parseWithBoundedRetry("garbled", fakeParse, retryModel)).rejects.toThrow(FakeCreditsError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ads-agent && npx vitest run lib/openui/parse-retry.test.ts`
Expected: FAIL with "Cannot find module './parse-retry'"

- [ ] **Step 3: Write minimal implementation**

```typescript
// ads-agent/lib/openui/parse-retry.ts
export type ParseAttempt<T> = { kind: "ok"; value: T } | { kind: "error"; errors: string[] };

export type ParseFn<T> = (rawText: string) => ParseAttempt<T>;

/** Sends `feedback` (the specific parse errors + a request to re-emit) as the next user turn and
 * returns the model's raw text reply. Any error it throws (e.g. an insufficient-credits error)
 * propagates to parseWithBoundedRetry's caller unmodified — this helper never swallows it. */
export type RetryModelFn = (feedback: string) => Promise<string>;

/**
 * Bounded retry-on-parse-failure: attempt `parse(firstRawText)`; on failure, call `retryModel()`
 * exactly once with the specific errors, parse that reply, and return it — success or failure —
 * without a second retry. This is the convention mandated by
 * docs/superpowers/specs/2026-08-05-openui-platform-foundation-design.md's Resilience section:
 * never zero retries (a user should never be dead-ended on the first structurally-bad response),
 * and never more than one (unbounded retries risk masking a genuinely broken model call behind
 * repeated latency/cost). `campaign-chat.ts`'s inline implementation is the reference this
 * generalizes — extracted now that a second caller (the Copilot route, Task 12) needs the same
 * mechanic, per the threshold that spec's own Resilience section sets for extraction.
 */
export async function parseWithBoundedRetry<T>(
  firstRawText: string,
  parse: ParseFn<T>,
  retryModel: RetryModelFn,
): Promise<ParseAttempt<T>> {
  const first = parse(firstRawText);
  if (first.kind === "ok") return first;

  const feedback = `That could not be parsed (${first.errors.join("; ") || "unknown parse error"}). Re-emit exactly one valid statement, positional args only — no markdown fences, no prose outside the statement.`;
  const retryRawText = await retryModel(feedback);
  return parse(retryRawText);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ads-agent && npx vitest run lib/openui/parse-retry.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
cd ads-agent && npx eslint lib/openui/parse-retry.ts lib/openui/parse-retry.test.ts
git add lib/openui/parse-retry.ts lib/openui/parse-retry.test.ts
git commit -m "feat: extract generic bounded-retry-on-parse-failure helper"
```

---

### Task 8: `shared-library.ts` — barrel composing Tasks 1-3

**Files:**
- Create: `ads-agent/lib/openui/shared-library.ts`
- Test: `ads-agent/lib/openui/shared-library.test.ts`

**Interfaces:**
- Consumes: `StatCard`, `KpiGrid` (Task 1); `InsightCallout`, `ChecklistCard`, `AlertBanner` (Task 2);
  `ComparisonCard`, `Timeline`, `RankedList`, `BatchActionConfirm` (Task 3) — all `DefinedComponent`
  values, re-imported here.
- Produces: `sharedLibrary` (a `Library`, via `createLibrary({ components: [...] })`, no fixed `root` —
  the model may render any of the nine as its turn's root component) and a re-export of every
  individual component/view/prop-type from the three Task 1-3 files, so callers can `import {
  sharedLibrary, StatCardView, ... } from "./shared-library"` without knowing the three-file split
  underneath. Task 10 (`platform-library.ts`) imports `sharedLibrary`.

- [ ] **Step 1: Write the failing test**

```typescript
// ads-agent/lib/openui/shared-library.test.ts
import { describe, expect, it } from "vitest";
import { sharedLibrary } from "./shared-library";

describe("sharedLibrary", () => {
  it("registers exactly the nine shared components, no duplicates", () => {
    const names = Object.keys(sharedLibrary.components).sort();
    expect(names).toEqual(
      [
        "AlertBanner", "BatchActionConfirm", "ChecklistCard", "ComparisonCard",
        "InsightCallout", "KpiGrid", "RankedList", "StatCard", "Timeline",
      ].sort(),
    );
  });

  it("has no fixed root — the model may render any registered component as the turn's root", () => {
    expect(sharedLibrary.root).toBeUndefined();
  });

  it("generates a non-empty system prompt mentioning every component", () => {
    const prompt = sharedLibrary.prompt({ preamble: "test" });
    for (const name of ["StatCard", "KpiGrid", "InsightCallout", "ChecklistCard", "AlertBanner", "ComparisonCard", "Timeline", "RankedList", "BatchActionConfirm"]) {
      expect(prompt).toContain(name);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ads-agent && npx vitest run lib/openui/shared-library.test.ts`
Expected: FAIL with "Cannot find module './shared-library'"

- [ ] **Step 3: Write minimal implementation**

```typescript
// ads-agent/lib/openui/shared-library.ts
import { createLibrary } from "@openuidev/lang-core";
import { StatCard, KpiGrid } from "./shared-metric-cards";
import { InsightCallout, ChecklistCard, AlertBanner } from "./shared-narrative-cards";
import { ComparisonCard, Timeline, RankedList, BatchActionConfirm } from "./shared-structured-views";

export * from "./shared-metric-cards";
export * from "./shared-narrative-cards";
export * from "./shared-structured-views";

/**
 * The nine general-purpose, domain-agnostic OpenUI components (foundation spec's "New shared,
 * general-purpose components" table). No fixed `root` — unlike campaignLibrary (always renders
 * SetupCard), any of these nine may be the model's chosen root for a given turn, since which one
 * fits depends entirely on the question asked. platform-library.ts (Task 10) composes this with
 * campaignLibrary for the global Copilot; individual domain libraries (Specs 2/3, once built) are
 * expected to import from here rather than redefining any of these nine (see foundation spec's
 * Migration path — StatCard specifically is owned here, not by analytics-library.ts).
 */
export const sharedLibrary = createLibrary({
  components: [StatCard, KpiGrid, InsightCallout, ChecklistCard, AlertBanner, ComparisonCard, Timeline, RankedList, BatchActionConfirm],
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ads-agent && npx vitest run lib/openui/shared-library.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
cd ads-agent && npx eslint lib/openui/shared-library.ts lib/openui/shared-library.test.ts
git add lib/openui/shared-library.ts lib/openui/shared-library.test.ts
git commit -m "feat: compose the nine shared OpenUI components into sharedLibrary"
```

---

### Task 9: `CopilotFab.tsx` — floating trigger button

**Files:**
- Create: `ads-agent/components/copilot/CopilotFab.tsx`

**Interfaces:**
- Consumes: `useCopilot()` (Task 5) for `isOpen`/`toggle()`.
- Produces: `CopilotFab` React component, props `{ hasAlert?: boolean }` (per this plan's Global
  Constraints, `hasAlert` is accepted but no task computes a real value for it — a future Spec 2/3 task
  wires a real threshold query). Task 13 (layout wiring) mounts this.

**Note on test strategy:** same as Task 5's `CopilotProvider.tsx` — no `@testing-library/react` in this
repo, so this thin, purely-presentational component (one button, one conditional badge dot) gets a
manual-verification step instead of an automated render test, matching the v2 dashboard plan's own
precedent for equally thin UI shells.

- [ ] **Step 1: Write the component**

```tsx
// ads-agent/components/copilot/CopilotFab.tsx
"use client";

import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCopilot } from "./CopilotProvider";

type Props = {
  /** Rule-based, SQL/code-computed alert flag (foundation spec's Proactive signaling section) —
   * not computed by this component; the caller supplies it. No task in this plan wires a real
   * value (see this plan's Global Constraints) — defaults to false until one does. */
  hasAlert?: boolean;
};

/** Floating trigger button, shown on every admin page — toggles the Copilot panel open/closed. */
export function CopilotFab({ hasAlert = false }: Props) {
  const { isOpen, toggle } = useCopilot();

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isOpen ? "Close AI Copilot" : "Open AI Copilot"}
      aria-expanded={isOpen}
      className={cn(
        "fixed bottom-6 right-6 z-40 flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105",
      )}
    >
      <Sparkles className="size-5" aria-hidden="true" />
      {hasAlert && (
        <span
          aria-hidden="true"
          className="absolute right-0 top-0 size-3 rounded-full border-2 border-background bg-destructive"
        />
      )}
    </button>
  );
}
```

- [ ] **Step 2: Manually verify**

Run: `cd ads-agent && npx tsc --noEmit` (confirms `useCopilot()`'s type is satisfied and the component
compiles). Full visual/interaction verification happens in Task 14's manual pass once Task 13 mounts
this inside a real `<CopilotProvider>` in the running app (a standalone unit test would need a Provider
wrapper this repo has no rendering harness for — consistent with Task 5's same reasoning).

- [ ] **Step 3: Commit**

```bash
cd ads-agent && npx eslint components/copilot/CopilotFab.tsx
git add components/copilot/CopilotFab.tsx
git commit -m "feat: add CopilotFab floating trigger button"
```

---

### Task 10: `platform-library.ts` + `platform-tools.ts` — composition layer

**Files:**
- Create: `ads-agent/lib/openui/platform-library.ts`
- Create: `ads-agent/lib/openui/platform-library.test.ts`
- Create: `ads-agent/lib/openui/platform-tools.ts`
- Create: `ads-agent/lib/openui/platform-tools.test.ts`

**Interfaces:**
- Consumes: `campaignLibrary` (existing, `campaign-library.ts`, unmodified), `sharedLibrary` (Task 8).
- Produces: `platformLibrary` (a `Library`, all of `campaignLibrary`'s + `sharedLibrary`'s components,
  no fixed root); `composeToolProviders()`, `composeToolSpecs()` (generic merge functions),
  `platformToolProvider` (`Record<string, (args) => Promise<unknown>>`, currently `{}`),
  `platformToolSpecs` (`ToolSpec[]`, currently `[]`). Task 11 (`CopilotPanel`) consumes
  `platformLibrary` + `platformToolProvider`. Task 12 (`copilot-chat.ts`) consumes `platformLibrary` +
  `platformToolSpecs`.

- [ ] **Step 1: Write the failing tests**

```typescript
// ads-agent/lib/openui/platform-library.test.ts
import { describe, expect, it } from "vitest";
import { platformLibrary } from "./platform-library";

describe("platformLibrary", () => {
  it("registers SetupCard plus all nine shared components, exactly once each", () => {
    const names = Object.keys(platformLibrary.components).sort();
    expect(names).toEqual(
      [
        "SetupCard",
        "AlertBanner", "BatchActionConfirm", "ChecklistCard", "ComparisonCard",
        "InsightCallout", "KpiGrid", "RankedList", "StatCard", "Timeline",
      ].sort(),
    );
    expect(names).toHaveLength(10);
  });

  it("has no fixed root — the global Copilot may render any composed component as the turn's root", () => {
    expect(platformLibrary.root).toBeUndefined();
  });

  it("generates a non-empty system prompt mentioning SetupCard and a shared component", () => {
    const prompt = platformLibrary.prompt({ preamble: "test" });
    expect(prompt).toContain("SetupCard");
    expect(prompt).toContain("KpiGrid");
  });
});
```

```typescript
// ads-agent/lib/openui/platform-tools.test.ts
import { describe, expect, it } from "vitest";
import { composeToolProviders, composeToolSpecs, platformToolProvider, platformToolSpecs } from "./platform-tools";
import type { ToolSpec } from "@openuidev/lang-core";

describe("composeToolProviders", () => {
  it("merges multiple domain tool-provider maps into one", () => {
    const a = { get_users: async () => [1, 2] };
    const b = { get_leads: async () => [3] };
    const merged = composeToolProviders(a, b);
    expect(Object.keys(merged).sort()).toEqual(["get_leads", "get_users"]);
  });

  it("throws on a duplicate tool name across domains", () => {
    const a = { get_users: async () => [] };
    const b = { get_users: async () => [] };
    expect(() => composeToolProviders(a, b)).toThrow(/duplicate tool name "get_users"/);
  });

  it("returns an empty object when called with no providers", () => {
    expect(composeToolProviders()).toEqual({});
  });
});

describe("composeToolSpecs", () => {
  const spec = (name: string): ToolSpec => ({ name, inputSchema: {}, outputSchema: {} });

  it("merges multiple domain tool-spec lists into one", () => {
    const merged = composeToolSpecs([spec("get_users")], [spec("get_leads")]);
    expect(merged.map((s) => s.name).sort()).toEqual(["get_leads", "get_users"]);
  });

  it("throws on a duplicate tool spec name across domains", () => {
    expect(() => composeToolSpecs([spec("get_users")], [spec("get_users")])).toThrow(/duplicate tool spec name "get_users"/);
  });

  it("returns an empty array when called with no spec lists", () => {
    expect(composeToolSpecs()).toEqual([]);
  });
});

describe("platformToolProvider / platformToolSpecs", () => {
  it("compose zero domain tool sets today — no domain has authored a ToolSpec/ToolProvider yet (see this plan's Global Constraints)", () => {
    expect(platformToolProvider).toEqual({});
    expect(platformToolSpecs).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ads-agent && npx vitest run lib/openui/platform-library.test.ts lib/openui/platform-tools.test.ts`
Expected: FAIL with "Cannot find module './platform-library'" / "'./platform-tools'"

- [ ] **Step 3: Write minimal implementation**

```typescript
// ads-agent/lib/openui/platform-library.ts
import { createLibrary } from "@openuidev/lang-core";
import { campaignLibrary } from "./campaign-library";
import { sharedLibrary } from "./shared-library";

/**
 * The global Copilot's composed component registry: every domain library's components plus the
 * nine shared ones, merged into one Library with no fixed root (the model chooses which
 * registered component fits each turn). Today this merges campaignLibrary (Spec 1, shipped) and
 * sharedLibrary (Task 8) — crmLibrary/analyticsLibrary (Specs 2/3) are unbuilt and are added here
 * unchanged, one line each, once they exist (foundation spec's Migration path). Embedded per-page
 * chats (Campaign Chat today) keep using their own narrower domain-only library, unaffected by
 * this composition.
 */
export const platformLibrary = createLibrary({
  components: [...Object.values(campaignLibrary.components), ...Object.values(sharedLibrary.components)],
});
```

```typescript
// ads-agent/lib/openui/platform-tools.ts
import type { ToolSpec } from "@openuidev/lang-core";

export type ToolProviderMap = Record<string, (args: Record<string, unknown>) => Promise<unknown>>;

/** Merges any number of domain tool-provider maps into one, throwing on a name collision (two
 * domains registering the same tool name is a bug, not a valid override — silently letting the
 * second one win would hide it). */
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

/** Same collision-detection behavior as composeToolProviders, for the prompt-facing ToolSpec[] side. */
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
 * The global Copilot's composed tool registry. Currently merges ZERO domain tool sets — verified
 * during this plan's codebase investigation: Spec 1's Campaign Chat never defined a
 * ToolSpec/ToolProvider (SetupCard is pure structured-output parsing, no Query()/Mutation() calls;
 * see docs/superpowers/specs/2026-08-05-openui-platform-foundation-design.md's Architecture
 * correction), and Specs 2/3 (CRM, Reports) are approved-but-unbuilt. This is the intended
 * extension point: when a domain adds its first `<domain>-tools.ts` (a ToolProviderMap + ToolSpec[]
 * pair, real examples once Spec 2/3 land), import and add it to the two calls below — no other
 * change needed here.
 */
export const platformToolProvider: ToolProviderMap = composeToolProviders(
  // no domain tool providers exist yet — add e.g. campaignToolProvider here once a domain defines one
);
export const platformToolSpecs: ToolSpec[] = composeToolSpecs(
  // no domain tool specs exist yet
);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ads-agent && npx vitest run lib/openui/platform-library.test.ts lib/openui/platform-tools.test.ts`
Expected: PASS (3 + 7 = 10 tests)

- [ ] **Step 5: Commit**

```bash
cd ads-agent && npx eslint lib/openui/platform-library.ts lib/openui/platform-library.test.ts lib/openui/platform-tools.ts lib/openui/platform-tools.test.ts
git add lib/openui/platform-library.ts lib/openui/platform-library.test.ts lib/openui/platform-tools.ts lib/openui/platform-tools.test.ts
git commit -m "feat: compose platform-library and platform-tools cross-domain registries"
```

---

### Task 11: `CopilotPanel.tsx` — the floating chat panel UI

**Files:**
- Create: `ads-agent/components/copilot/CopilotPanel.tsx`

**Interfaces:**
- Consumes: `useCopilot()` (Task 5); `platformLibrary`, `platformToolProvider` (Task 10); `Renderer`
  from `@openuidev/react-lang`. Calls `POST /api/copilot/chat` (Task 12) — mirrors
  `CampaignDraftChat.tsx`'s exact SSE-consumption loop (`res.body.getReader()`, `\n\n`-delimited
  `data:` frames), generalized: no `draftId` in the URL, and request body carries `{ content, history }`
  (ephemeral client-side history, no DB) instead of relying on a server-persisted thread.
- Produces: `CopilotPanel` React component (no props — reads everything from `useCopilot()`). Task 13
  (layout wiring) mounts this.

**Note on test strategy:** same reasoning as Tasks 5 and 9 — this repo has no
`@testing-library/react`/jsdom rendering harness, and this component's substantive logic (SSE frame
parsing) is an exact structural copy of `CampaignDraftChat.tsx`'s already-shipped, untested-in-isolation
loop (that component has no dedicated unit test either — its correctness is covered by
`messages/route.test.ts`'s server-side contract test plus manual verification). This task gets the same
treatment: a manual-verification step, plus Task 14's cross-domain manual smoke pass exercises it
end-to-end against the real route.

- [ ] **Step 1: Write the component**

```tsx
// ads-agent/components/copilot/CopilotPanel.tsx
"use client";

import { useEffect, useState } from "react";
import { Renderer } from "@openuidev/react-lang";
import { Loader2, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { platformLibrary } from "@/lib/openui/platform-library";
import { platformToolProvider } from "@/lib/openui/platform-tools";
import { useCopilot } from "./CopilotProvider";

type StreamEvent = { delta: string } | { done: true; reply: string } | { done: true; error: string };

export function CopilotPanel() {
  const { isOpen, close, messages, appendMessage, pendingQuestion, clearPendingQuestion } = useCopilot();
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function sendMessage(content: string) {
    const trimmed = content.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setError(null);
    setStreamingText("");
    appendMessage({ id: `local-${Date.now()}`, role: "user", content: trimmed });
    setInput("");

    try {
      const res = await fetch("/api/copilot/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: trimmed, history: messages }),
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Failed to reach the Copilot");
        return;
      }

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
          } else if ("error" in event) {
            setError(event.error);
          } else {
            appendMessage({ id: `local-reply-${Date.now()}`, role: "assistant", content: event.reply });
          }
        }
      }
    } finally {
      setSending(false);
      setStreamingText("");
    }
  }

  // Drains a pre-seeded question (AskAiTrigger / proactive-signaling badge handoff) exactly once
  // after the panel opens.
  useEffect(() => {
    if (isOpen && pendingQuestion) {
      const question = pendingQuestion;
      clearPendingQuestion();
      void sendMessage(question);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, pendingQuestion]);

  if (!isOpen) return null;

  return (
    <Card className="fixed bottom-24 right-6 z-40 flex h-[70vh] w-[420px] max-w-[calc(100vw-3rem)] flex-col shadow-xl">
      <CardHeader className="flex-row items-center justify-between border-b border-border">
        <CardTitle className="text-base font-semibold text-foreground">AI Copilot</CardTitle>
        <Button variant="outline" size="icon" onClick={close} aria-label="Close AI Copilot">
          <X className="size-4" />
        </Button>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-3 overflow-hidden pt-4">
        <div className="flex-1 space-y-3 overflow-y-auto pr-1">
          {messages.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Ask about campaigns, leads, or performance — I can pull up cards, charts, or lists to answer.
            </p>
          )}
          {messages.map((message) =>
            message.role === "user" ? (
              <div key={message.id} className="ml-auto max-w-[85%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground">
                {message.content}
              </div>
            ) : (
              <div key={message.id} className="max-w-[95%]">
                <Renderer response={message.content} library={platformLibrary} toolProvider={platformToolProvider} isStreaming={false} />
              </div>
            ),
          )}
          {sending && streamingText && (
            <div className="max-w-[95%]">
              <Renderer response={streamingText} library={platformLibrary} toolProvider={platformToolProvider} isStreaming />
            </div>
          )}
          {sending && !streamingText && (
            <div className="max-w-[85%] rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">Thinking…</div>
          )}
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex gap-2">
          <input
            className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
            placeholder="Ask the Copilot…"
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
          <Button size="icon" disabled={sending || !input.trim()} onClick={() => void sendMessage(input)}>
            {sending ? <Loader2 className="size-4 animate-spin" /> : <Send />}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Manually verify**

Run: `cd ads-agent && npx tsc --noEmit` — confirms the imports and `Renderer` prop types compile
correctly (`platformLibrary` from `platform-library.ts`, `platformToolProvider` from
`platform-tools.ts` — two different files, easy to conflate since both live under `lib/openui/`).
Full behavior (a real streamed turn rendering a component) is exercised in Task 14's manual smoke
pass, once Task 12's route exists and Task 13 mounts this panel in the real layout.

- [ ] **Step 3: Commit**

```bash
cd ads-agent && npx eslint components/copilot/CopilotPanel.tsx
git add components/copilot/CopilotPanel.tsx
git commit -m "feat: add CopilotPanel floating chat UI"
```

---

### Task 12: `/api/copilot/chat/route.ts` + `copilot-chat.ts` decision-engine module

**Files:**
- Create: `ads-agent/lib/decision-engine/copilot-chat.ts`
- Create: `ads-agent/lib/decision-engine/copilot-chat.test.ts`
- Create: `ads-agent/app/api/copilot/chat/route.ts`
- Create: `ads-agent/app/api/copilot/chat/route.test.ts`

**Interfaces:**
- Consumes: `platformLibrary` (Task 10); `parseWithBoundedRetry` (Task 7); existing
  `callMeteredStreamingChatCompletion` (`lib/metering/metered-stream-client.ts`), `streamChatCompletion`
  (`lib/openui/bifrost-stream.ts`), `isBifrostConfigured`/`ChatMessage` (`lib/bifrost/client.ts`),
  `InsufficientCreditsError`/`MeteringContext` (`lib/metering/types.ts`), `getSession`
  (`lib/auth/dal.ts`), `DEFAULT_ORG_ID`/`DEFAULT_USER_ID` (`lib/metering/dev-context.ts`),
  `requireApiRole` (`lib/auth/dal.ts`) — all existing, unmodified, reused verbatim (foundation spec's
  explicit requirement).
- Produces: `draftCopilotReply()` (async generator, same `{type:"delta"}`/`{type:"done"}` event shape
  as `campaign-chat.ts`'s `draftCampaignChatReply`), `CopilotMessage` type, `POST` route handler.
  Task 11 (`CopilotPanel`) is the client of this route.

- [ ] **Step 1: Write the failing tests for `copilot-chat.ts`**

```typescript
// ads-agent/lib/decision-engine/copilot-chat.test.ts
import { describe, expect, it, vi } from "vitest";

const { isBifrostConfigured, callMeteredStreamingChatCompletion, getSession } = vi.hoisted(() => ({
  isBifrostConfigured: vi.fn(),
  callMeteredStreamingChatCompletion: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock("../bifrost/client", () => ({ isBifrostConfigured, }));
vi.mock("../metering/metered-stream-client", () => ({ callMeteredStreamingChatCompletion }));
vi.mock("../auth/dal", () => ({ getSession }));
vi.mock("../openui/bifrost-stream", () => ({ streamChatCompletion: vi.fn() }));

import { draftCopilotReply } from "./copilot-chat";
import { InsufficientCreditsError } from "../metering/types";

async function drain(gen: AsyncGenerator<{ type: "delta"; content: string } | { type: "done"; reply: string }>) {
  const events = [];
  for await (const event of gen) events.push(event);
  return events;
}

function fakeStream(...chunks: string[]) {
  return (async function* () {
    for (const chunk of chunks) yield { type: "delta" as const, content: chunk };
  })();
}

describe("draftCopilotReply", () => {
  it("returns a fixed message when Bifrost is not configured", async () => {
    isBifrostConfigured.mockReturnValue(false);
    const events = await drain(draftCopilotReply({ history: [], userMessage: "hi" }));
    expect(events).toEqual([{ type: "done", reply: expect.stringContaining("Bifrost is not configured") }]);
  });

  it("streams deltas then yields the parsed root component's raw text on success", async () => {
    isBifrostConfigured.mockReturnValue(true);
    getSession.mockResolvedValue(null);
    callMeteredStreamingChatCompletion.mockReturnValueOnce(fakeStream(`root = StatCard`, `("Leads", "42")`));
    const events = await drain(draftCopilotReply({ history: [], userMessage: "how many leads?" }));
    expect(events[0]).toEqual({ type: "delta", content: "root = StatCard" });
    expect(events[events.length - 1]).toEqual({ type: "done", reply: 'root = StatCard("Leads", "42")' });
  });

  it("accepts a short plain-text acknowledgment with no component statement", async () => {
    isBifrostConfigured.mockReturnValue(true);
    getSession.mockResolvedValue(null);
    callMeteredStreamingChatCompletion.mockReturnValueOnce(fakeStream("Done — paused that campaign."));
    const events = await drain(draftCopilotReply({ history: [], userMessage: "pause it" }));
    expect(events[events.length - 1]).toEqual({ type: "done", reply: "Done — paused that campaign." });
  });

  it("retries once on a parse failure and succeeds if the retry parses", async () => {
    isBifrostConfigured.mockReturnValue(true);
    getSession.mockResolvedValue(null);
    callMeteredStreamingChatCompletion
      .mockReturnValueOnce(fakeStream("not valid openui lang at all, way too long to count as a trivial ack because it goes on and on describing things nobody asked for"))
      .mockReturnValueOnce(fakeStream(`root = StatCard("Leads", "42")`));
    const events = await drain(draftCopilotReply({ history: [], userMessage: "how many leads?" }));
    expect(callMeteredStreamingChatCompletion).toHaveBeenCalledTimes(2);
    expect(events[events.length - 1]).toEqual({ type: "done", reply: 'root = StatCard("Leads", "42")' });
  });

  it("gives up gracefully after one failed retry — no silent hang, no third attempt", async () => {
    isBifrostConfigured.mockReturnValue(true);
    getSession.mockResolvedValue(null);
    const garbled = "not valid openui lang at all, way too long to count as a trivial ack because it goes on and on describing things nobody asked for";
    callMeteredStreamingChatCompletion.mockReturnValueOnce(fakeStream(garbled)).mockReturnValueOnce(fakeStream(garbled));
    const events = await drain(draftCopilotReply({ history: [], userMessage: "how many leads?" }));
    expect(callMeteredStreamingChatCompletion).toHaveBeenCalledTimes(2);
    expect(events[events.length - 1]).toEqual({ type: "done", reply: expect.stringContaining("trouble putting that together") });
  });

  it("returns the credits-exhausted message when the first model call throws InsufficientCreditsError", async () => {
    isBifrostConfigured.mockReturnValue(true);
    getSession.mockResolvedValue(null);
    callMeteredStreamingChatCompletion.mockImplementationOnce(() => {
      throw new InsufficientCreditsError();
    });
    const events = await drain(draftCopilotReply({ history: [], userMessage: "hi" }));
    expect(events).toEqual([{ type: "done", reply: expect.stringContaining("run out of AI credits") }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ads-agent && npx vitest run lib/decision-engine/copilot-chat.test.ts`
Expected: FAIL with "Cannot find module './copilot-chat'"

- [ ] **Step 3: Write minimal implementation of `copilot-chat.ts`**

```typescript
// ads-agent/lib/decision-engine/copilot-chat.ts
import { createParser } from "@openuidev/lang-core";
import { isBifrostConfigured, type ChatMessage } from "../bifrost/client";
import { streamChatCompletion } from "../openui/bifrost-stream";
import { platformLibrary } from "../openui/platform-library";
import { parseWithBoundedRetry, type ParseAttempt } from "../openui/parse-retry";
import { callMeteredStreamingChatCompletion } from "../metering/metered-stream-client";
import { InsufficientCreditsError, type MeteringContext } from "../metering/types";
import { getSession } from "../auth/dal";
import { DEFAULT_ORG_ID, DEFAULT_USER_ID } from "../metering/dev-context";

export type CopilotMessage = { role: "user" | "assistant"; content: string };

export type CopilotTurnEvent = { type: "delta"; content: string } | { type: "done"; reply: string };

/** A response with no informational content (a one-word acknowledgment) stays plain text — the
 * foundation spec's Response composition rule 4. Only attempt component parsing when the text
 * looks like it's trying to emit one (a "root = Name(" statement); otherwise, treat short plain
 * text as a valid trivial acknowledgment rather than a parse failure. */
const PLAIN_ACK_MAX_LENGTH = 120;

function buildSystemPrompt(): string {
  return platformLibrary.prompt({
    preamble:
      "You are the Gentle Space admin dashboard's AI Copilot. Answer questions about campaigns, " +
      "leads, and performance by rendering the most specific matching component rather than prose.",
    additionalRules: [
      "Prefer rendering the most specific matching component over plain text — component > prose, " +
        "always, unless the response carries no information at all.",
      "A response with no informational content (a one-word acknowledgment like \"Done\" or " +
        "\"Cancelled\" after a confirmed action) may stay plain text, under 120 characters, with no " +
        "\"root = ...\" statement at all — do not force a trivial ack into a component.",
      "No tools are registered yet — do not use Query() or Mutation(); render components using " +
        "literal prop values drawn only from this conversation.",
      "Output only openui-lang (root = ComponentName(...)) or a short plain acknowledgment. No " +
        "markdown fences, no prose outside a component statement.",
    ],
  });
}

function parseCopilotResponse(text: string): ParseAttempt<string> {
  const trimmed = text.trim();
  if (!trimmed) return { kind: "error", errors: ["empty response"] };

  const looksLikeComponentStatement = /root\s*=\s*[A-Z]\w*\s*\(/.test(trimmed);
  if (!looksLikeComponentStatement) {
    if (trimmed.length <= PLAIN_ACK_MAX_LENGTH) return { kind: "ok", value: trimmed };
    return { kind: "error", errors: ["response has no component statement and is too long to treat as a plain acknowledgment"] };
  }

  const parser = createParser(platformLibrary.toJSONSchema());
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

async function* runCopilotModel(
  ctx: MeteringContext,
  messages: ChatMessage[],
): AsyncGenerator<{ type: "delta"; content: string }, string, unknown> {
  let full = "";
  for await (const chunk of callMeteredStreamingChatCompletion(
    ctx,
    { messages, temperature: 0.4, maxTokens: 2048, timeoutMs: 20_000 },
    streamChatCompletion,
  )) {
    if (chunk.type === "delta") {
      full += chunk.content;
      yield { type: "delta", content: chunk.content };
    }
  }
  return full;
}

async function runCopilotModelSilent(ctx: MeteringContext, messages: ChatMessage[]): Promise<string> {
  const gen = runCopilotModel(ctx, messages);
  let result = await gen.next();
  while (!result.done) result = await gen.next();
  return result.value;
}

export async function* draftCopilotReply(input: {
  history: CopilotMessage[];
  userMessage: string;
}): AsyncGenerator<CopilotTurnEvent, void, unknown> {
  if (!isBifrostConfigured()) {
    yield { type: "done", reply: "Bifrost is not configured (BIFROST_BASE_URL), so the Copilot can't respond yet. Ask an admin to set it." };
    return;
  }

  const session = await getSession();
  const ctx: MeteringContext = {
    orgId: session?.orgId ?? DEFAULT_ORG_ID,
    userId: session?.userId ?? DEFAULT_USER_ID,
    feature: "ads-agent:copilot-chat",
  };

  const messages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt() },
    ...input.history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: input.userMessage },
  ];

  let firstRaw: string;
  try {
    firstRaw = yield* runCopilotModel(ctx, messages);
  } catch (err) {
    if (err instanceof InsufficientCreditsError) {
      yield { type: "done", reply: "This organization has run out of AI credits — ask an admin to allocate more from Usage & Credits." };
      return;
    }
    yield { type: "done", reply: "The Copilot is unavailable right now — try again shortly." };
    return;
  }

  let attempt: ParseAttempt<string>;
  try {
    attempt = await parseWithBoundedRetry(firstRaw, parseCopilotResponse, async (feedback) => {
      messages.push({ role: "assistant", content: firstRaw });
      messages.push({ role: "user", content: feedback });
      return await runCopilotModelSilent(ctx, messages);
    });
  } catch (err) {
    if (err instanceof InsufficientCreditsError) {
      yield { type: "done", reply: "This organization has run out of AI credits — ask an admin to allocate more from Usage & Credits." };
      return;
    }
    yield { type: "done", reply: "The Copilot is unavailable right now — try again shortly." };
    return;
  }

  if (attempt.kind === "error") {
    yield { type: "done", reply: "I had trouble putting that together — could you rephrase, or ask something more specific?" };
    return;
  }

  yield { type: "done", reply: attempt.value };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ads-agent && npx vitest run lib/decision-engine/copilot-chat.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Write the failing test for `route.ts`**

```typescript
// ads-agent/app/api/copilot/chat/route.test.ts
import { describe, expect, it, vi } from "vitest";

const { requireApiRole, draftCopilotReply } = vi.hoisted(() => ({
  requireApiRole: vi.fn(),
  draftCopilotReply: vi.fn(),
}));

vi.mock("@/lib/auth/dal", () => ({ requireApiRole }));
vi.mock("@/lib/decision-engine/copilot-chat", () => ({ draftCopilotReply }));

import { POST } from "./route";

function postRequest(body: unknown) {
  return new Request("http://localhost/api/copilot/chat", { method: "POST", body: JSON.stringify(body) });
}

async function readEvents(res: Response) {
  const text = await res.text();
  return text
    .split("\n\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => JSON.parse(line.slice("data:".length).trim()));
}

describe("POST /api/copilot/chat", () => {
  it("returns 401/403 passthrough when requireApiRole rejects", async () => {
    const rejection = { ok: false as const, response: new Response(null, { status: 403 }) };
    requireApiRole.mockResolvedValue(rejection);
    const res = await POST(postRequest({ content: "hi", history: [] }));
    expect(res.status).toBe(403);
  });

  it("requires operator role", async () => {
    requireApiRole.mockResolvedValue({ ok: true, session: { userId: "u1", orgId: "o1" } });
    draftCopilotReply.mockImplementation(async function* () {
      yield { type: "done", reply: "ok" };
    });
    await POST(postRequest({ content: "hi", history: [] }));
    expect(requireApiRole).toHaveBeenCalledWith("operator");
  });

  it("returns 400 when content is missing", async () => {
    requireApiRole.mockResolvedValue({ ok: true, session: { userId: "u1", orgId: "o1" } });
    const res = await POST(postRequest({ content: "", history: [] }));
    expect(res.status).toBe(400);
  });

  it("streams deltas then a done event with the reply", async () => {
    requireApiRole.mockResolvedValue({ ok: true, session: { userId: "u1", orgId: "o1" } });
    draftCopilotReply.mockImplementation(async function* () {
      yield { type: "delta", content: "root = Stat" };
      yield { type: "delta", content: 'Card("Leads", "42")' };
      yield { type: "done", reply: 'root = StatCard("Leads", "42")' };
    });
    const res = await POST(postRequest({ content: "how many leads?", history: [] }));
    const events = await readEvents(res);
    expect(events[0]).toEqual({ delta: "root = Stat" });
    expect(events[1]).toEqual({ delta: 'Card("Leads", "42")' });
    expect(events[2]).toEqual({ done: true, reply: 'root = StatCard("Leads", "42")' });
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd ads-agent && npx vitest run app/api/copilot/chat/route.test.ts`
Expected: FAIL with "Cannot find module './route'"

- [ ] **Step 7: Write minimal implementation of `route.ts`**

```typescript
// ads-agent/app/api/copilot/chat/route.ts
import { NextResponse } from "next/server";
import { requireApiRole } from "@/lib/auth/dal";
import { draftCopilotReply, type CopilotMessage } from "@/lib/decision-engine/copilot-chat";

export async function POST(req: Request) {
  const access = await requireApiRole("operator");
  if (!access.ok) return access.response;

  const { content, history } = (await req.json()) as { content: string; history?: CopilotMessage[] };
  if (!content?.trim()) return NextResponse.json({ error: "content is required" }, { status: 400 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      function send(event: Record<string, unknown>) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }

      try {
        let reply = "";
        for await (const event of draftCopilotReply({ history: history ?? [], userMessage: content })) {
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
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `cd ads-agent && npx vitest run app/api/copilot/chat/route.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 9: Commit**

```bash
cd ads-agent && npx eslint lib/decision-engine/copilot-chat.ts lib/decision-engine/copilot-chat.test.ts app/api/copilot/chat/route.ts app/api/copilot/chat/route.test.ts
git add lib/decision-engine/copilot-chat.ts lib/decision-engine/copilot-chat.test.ts app/api/copilot/chat/route.ts app/api/copilot/chat/route.test.ts
git commit -m "feat: add global Copilot chat route with bounded parse-retry"
```

---

### Task 13: `(admin)/layout.tsx` wiring — mount the Copilot

**Files:**
- Modify: `ads-agent/app/(admin)/layout.tsx`

**Interfaces:**
- Consumes: `CopilotProvider` (Task 5), `CopilotFab` (Task 9), `CopilotPanel` (Task 11).
- Produces: every admin page now renders behind `<CopilotProvider>`, with `<CopilotFab>` +
  `<CopilotPanel>` mounted once, gated to `operator`/`admin` roles.

- [ ] **Step 1: Modify `(admin)/layout.tsx`**

Current file (reproduced from this plan's own investigation — read it once more before editing to
confirm nothing has drifted):

```tsx
import type { ReactNode } from "react";
import { Clock } from "lucide-react";
import { getCronSettings } from "@/lib/db/settings";
import { cn } from "@/lib/utils";
import { requireSession } from "@/lib/auth/dal";
import { Breadcrumb } from "@/components/Breadcrumb";
import { CommandPalette } from "@/components/CommandPalette";
import { RunNowButton } from "@/components/RunNowButton";
import { SidebarNav } from "@/components/SidebarNav";
import { UserMenu } from "@/components/UserMenu";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();

  if (!session.role) {
    // ...pending-approval branch, unchanged...
  }

  const settings = await getCronSettings();

  return (
    <div className="mx-auto grid min-h-dvh max-w-[1400px] grid-cols-[220px_1fr]">
      {/* ...sidebar, header, main, unchanged... */}
      <CommandPalette role={session.role} />
    </div>
  );
}
```

Apply this diff: add the three new imports, compute a `canUseCopilot` boolean from `session.role`
(same `"operator" | "admin"` gate as the route's `requireApiRole("operator")`), and wrap the returned
JSX's outer `<div>` in `<CopilotProvider>`, adding `<CopilotFab>` and `<CopilotPanel>` as siblings of
the existing `<CommandPalette>`:

```tsx
import type { ReactNode } from "react";
import { Clock } from "lucide-react";
import { getCronSettings } from "@/lib/db/settings";
import { cn } from "@/lib/utils";
import { requireSession } from "@/lib/auth/dal";
import { Breadcrumb } from "@/components/Breadcrumb";
import { CommandPalette } from "@/components/CommandPalette";
import { RunNowButton } from "@/components/RunNowButton";
import { SidebarNav } from "@/components/SidebarNav";
import { UserMenu } from "@/components/UserMenu";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CopilotProvider } from "@/components/copilot/CopilotProvider";
import { CopilotFab } from "@/components/copilot/CopilotFab";
import { CopilotPanel } from "@/components/copilot/CopilotPanel";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await requireSession();

  if (!session.role) {
    return (
      <div className="flex min-h-dvh items-center justify-center px-6">
        <Card className="w-full max-w-sm">
          <CardHeader className="items-center gap-4 pt-8 text-center">
            <span className="flex size-10 items-center justify-center rounded-full bg-accent">
              <Clock className="size-5 text-accent-foreground" strokeWidth={2} aria-hidden="true" />
            </span>
            <div className="flex flex-col gap-1.5">
              <CardTitle className="text-xl font-semibold text-foreground">
                Your account is pending approval
              </CardTitle>
              <CardDescription className="text-balance">
                Signed in as {session.email}. An admin needs to assign you a role from the Users
                page before you can access the dashboard.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="pb-8 text-center text-xs text-muted-foreground">
            Refresh this page after your role is assigned.
          </CardContent>
        </Card>
      </div>
    );
  }

  const settings = await getCronSettings();
  // Same minimum tier as the Copilot route's requireApiRole("operator") gate (lib/auth/dal.ts) —
  // defense in depth, mirroring how SidebarNav/nav-config.ts already gate nav visibility by role.
  const canUseCopilot = session.role === "operator" || session.role === "admin";

  return (
    <CopilotProvider>
      <div className="mx-auto grid min-h-dvh max-w-[1400px] grid-cols-[220px_1fr]">
        <aside className="border-r border-border">
          <div className="px-4 py-4 text-sm font-semibold tracking-tight">ads-agent</div>
          <SidebarNav role={session.role} />
        </aside>
        <div className="flex flex-col">
          <header className="flex h-14 items-center justify-between border-b border-border px-6">
            <Breadcrumb />
            <div className="flex items-center gap-4">
              <span className="hidden items-center gap-1 rounded-md border border-border px-1.5 py-0.5 text-xs text-muted-foreground sm:flex">
                <kbd>⌘</kbd>
                <kbd>K</kbd>
              </span>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <span
                  className={cn(
                    "inline-block size-2 rounded-full",
                    settings.enabled ? "bg-emerald-500" : "bg-muted-foreground/40",
                  )}
                  aria-hidden
                />
                Cron: {settings.enabled ? "on" : "off"}
                <span className="text-muted-foreground/60">
                  · Last run {settings.lastRunAt ? new Date(settings.lastRunAt).toLocaleString() : "never"}
                </span>
              </div>
              <RunNowButton />
              <UserMenu email={session.email} role={session.role} />
            </div>
          </header>
          <main className="flex-1 px-6 py-6">{children}</main>
        </div>
        <CommandPalette role={session.role} />
        {canUseCopilot && (
          <>
            <CopilotFab />
            <CopilotPanel />
          </>
        )}
      </div>
    </CopilotProvider>
  );
}
```

- [ ] **Step 2: Manually verify**

Run: `cd ads-agent && npx tsc --noEmit && npm run build` — confirms the modified layout compiles and
the whole app still builds (no test file targets `layout.tsx` directly in this repo — its previous
redesign task was also verified this way, per the v2 dashboard plan's own precedent). Then run the
full suite once to confirm nothing else regressed:

Run: `cd ads-agent && npx vitest run`
Expected: PASS (every existing test plus every test added in Tasks 1-3, 5, 7, 8, 10, 12 of this plan)

- [ ] **Step 3: Commit**

```bash
cd ads-agent && npx eslint "app/(admin)/layout.tsx"
git add "app/(admin)/layout.tsx"
git commit -m "feat: mount the global Copilot in the admin layout"
```

---

### Task 14: Full manual verification pass

**Files:** none created or modified — this task only runs and observes the app.

**Interfaces:** none — this is the plan's closing verification gate, matching the foundation spec's
Success criteria section point by point.

- [ ] **Step 1: Run the full automated suite and lint**

Run: `cd ads-agent && npx vitest run && npx eslint .`
Expected: every test across this plan's 14 tasks passes; zero new lint warnings.

- [ ] **Step 2: Start the dev server**

Run: `cd ads-agent && npm run dev` (background this — it's a long-running process)

- [ ] **Step 3: Confirm no LLM call on page load**

Navigate to `/` (Overview), `/campaigns`, `/proposals` without opening any chat. Confirm the Copilot
FAB is visible (bottom-right) for an operator/admin session but its badge dot is absent (no
`hasAlert` wiring exists yet — expected, see Global Constraints). Confirm no new row appears from a
manual `usage_ledger` check (`SELECT * FROM usage_ledger ORDER BY created_at DESC LIMIT 5;` via
`psql`/the app's DB client) — browsing alone must never debit credits.

- [ ] **Step 4: Confirm Copilot persistence across navigation**

Click the FAB to open the Copilot on `/`. Send one message (e.g. "how many campaigns are active?").
Wait for a reply. Navigate to `/proposals` via the sidebar. Confirm the panel is still open with the
same message history intact (verifies `CopilotProvider`'s single mount point at layout-level, Task 13).

- [ ] **Step 5: Confirm a rendered component (not a wall of text) for a substantive question**

Ask a question that should render one of the nine shared components (e.g. "give me a scorecard" →
expect `KpiGrid`/`StatCard` rendering, not prose) or `SetupCard` (e.g. a campaign-drafting question, if
reachable from this surface's system prompt). Confirm the response renders as a card/grid via
`<Renderer>`, not a wall of plain text.

- [ ] **Step 6: Confirm the parse-retry convention holds (no dead end)**

This is hard to trigger deterministically via the real model in manual testing — the automated
coverage in Task 12's `copilot-chat.test.ts` (retry-then-succeed, give-up-after-one-failed-retry) is
the primary verification for this criterion, consistent with how Spec 1's own equivalent fix was
verified (tests, not manual reproduction of a flaky model failure). Confirm those two tests are present
and passing as part of Step 1 above.

- [ ] **Step 7: Confirm a trivial acknowledgment stays plain text**

Ask a yes/no or confirmation-style question expected to produce a short ack (e.g. follow up "ok thanks"
after a substantive answer). Confirm the reply renders as plain text, not forced into a card — spot
check against the foundation spec's Response composition rule 4.

- [ ] **Step 8: Record findings**

Write a short summary (in the task's completion report, not a new file) confirming each of the
foundation spec's Success criteria that this plan's scope covers: no LLM call on page load,
persistence across navigation, rendered-component-over-prose behavior, and the parse-retry convention.
Note explicitly that cross-domain tool calls (a single Copilot turn calling two different domains'
tools) and the proactive-signaling badge are **not yet testable** — both require Spec 2 or 3's first
real tool set, which is out of this plan's scope (see Global Constraints); flag them as the natural
next plan once either spec is implemented.

---

## Self-Review

**1. Spec coverage:** every item in the foundation spec's "Implementation order" list maps to a task —
`shared-library.ts` (Tasks 1, 2, 3, 8), `AskAiTrigger` (Task 4), `platform-library.ts`/`platform-tools.ts`
(Task 10), `CopilotProvider.tsx`/`CopilotFab.tsx`/layout wiring (Tasks 5, 9, 13), `/api/copilot/chat/
route.ts`/`CopilotPanel.tsx` (Tasks 11, 12), and the Spec 1 dual-mode retrofit/verification (Task 6).
The Resilience section's bounded-retry mandate is met by Task 7 (extraction) + Task 12 (the second,
real caller) with its own dedicated tests. The one deliberate scope decision beyond the spec's literal
text — correcting the `campaign-tools.ts`/`platform-tools.ts` "existing to merge" assumption after
codebase verification — is called out explicitly in Global Constraints and propagated consistently
through Tasks 10 and 12 (an empty, tested, documented `platformToolProvider`/`platformToolSpecs`, and a
Copilot prompt that explicitly tells the model no tools exist yet).

**2. Placeholder scan:** no task contains "TBD"/"implement later"/"add appropriate error handling"
without code. Task 11 deliberately includes and then fixes an incorrect import in Steps 1-2 — that is
real, working code with a documented correction step, not a placeholder.

**3. Type consistency:** `CopilotMessage` (`{ id, role, content }` in `copilot-state.ts` for the
client-side reducer vs. `{ role, content }`, no `id`, in `copilot-chat.ts`'s server-side type) are
intentionally two different shapes for two different layers (client state needs a stable `id` for React
keys; the wire/model-history shape doesn't) — `CopilotPanel.tsx`'s request body
(`JSON.stringify({ content, history: messages })`) sends the client shape, and `route.ts`/`copilot-chat.ts`
only read `.role`/`.content` off each entry, so the extra `id` field round-trips harmlessly. Every
`*View` function's prop-normalization pattern (`raw.field ?? default`) matches `SetupCardViewInput`'s
established convention exactly across all nine new components. `ToolProviderMap`'s shape in
`platform-tools.ts` matches `RendererProps.toolProvider`'s installed type
(`Record<string, (args: Record<string, unknown>) => Promise<unknown>> | McpClientLike | null`) exactly,
confirmed by reading `@openuidev/react-lang`'s `.d.cts` directly rather than assuming.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-05-openui-platform-foundation.md`. Two
execution options:

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task (up to 7 in parallel per
Wave 1, then 2, 1, 2, 1, 1 in later waves), review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using `superpowers:executing-plans`, batch
execution with checkpoints.

Which approach?
