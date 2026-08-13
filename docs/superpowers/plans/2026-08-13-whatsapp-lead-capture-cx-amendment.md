# WhatsApp Lead-Capture CX Amendment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Parallelism:** One git worktree + branch per implementation subagent (`superpowers:using-git-worktrees` / `best-of-n-runner`). Ceiling: **8 concurrent implementation subagents**. Never share a working tree across parallel writers. Prefer Torbit (`project_id` `1672773718350201492`, repo `/Users/swami/Documents/GentleSpace_Web`, branch `main`) over grep — re-index before querying if HEAD drifts past the commit that wrote this plan.
>
> **This plan is organized into execution waves.** Within a wave, tasks touch **disjoint files** and have no unfinished interface dependency on each other — dispatch every task in a wave in the same batch. Do not start a dependent wave until every listed dependency has passed review.

**Goal:** Make the shipped WhatsApp lead-capture handoff reliable (no popup-block from awaited fetch), add an explicit post-submit confirmation with a fresh-click fallback, convert office/retail timeline fields to a shared 4-option choice group, and add trust/consent micro-copy — without changing CRM schema, AI tier rules, or `wa.me` message shape beyond carrying the chosen timeline label as a normal Step 2 string.

**Architecture:** Keep the 2026-08-03 hybrid model. Extend `Step2Field` with `kind`/`choices` so office `moveInTimeline` and retail `timeline` become button groups; answers remain plain strings so `foldStep2Answers`, `buildWhatsAppUrl`, and `qualify-prompt` need **no logic changes**. Extract a tiny injectable `submitWhatsAppHandoff` helper so the critical “`window.open` before `postLead`” ordering is unit-testable without `@testing-library/react` (root `package.json` has Vitest only — OpenMemory: prefer reducer/helper tests, no RTL). Extract a presentational confirmation panel component; wire both into `LeadCaptureModal` in a single merge task.

**Tech Stack:** Next.js 15.5.21 (App Router), React 19.2.4, TypeScript 5, Vitest 4.1 (`npm test -- <path>`), path alias `@/*` → repo root via `vitest.config.ts`.

**Spec (authoritative):** [`docs/superpowers/specs/2026-08-13-whatsapp-lead-capture-cx-amendment-design.md`](../specs/2026-08-13-whatsapp-lead-capture-cx-amendment-design.md)

**Torbit hubs (GentleSpace_Web `main`):**
| Area | Paths |
|---|---|
| Modal + context | `components/LeadCaptureModal.tsx`, `components/LeadCaptureContext.tsx` |
| Step 2 + wizard | `lib/leads/step2-fields.ts`, `lib/leads/wizard-steps.ts` |
| WhatsApp URL | `lib/whatsapp.ts` |
| AI qualifier (unchanged logic) | `lib/leads/qualify-prompt.ts`, `lib/leads/qualify-types.ts` |
| API (no changes) | `app/api/leads/route.ts` |
| Existing tests | `lib/leads/step2-fields.test.ts`, `lib/whatsapp.test.ts`, `lib/leads/qualify-prompt.test.ts` — **no** `LeadCaptureModal.test.tsx` today |

## Decisions locked in this plan

| ID | Decision |
|---|---|
| **CX-D1** | `window.open` runs synchronously **before** any `await`; `postLead` is fire-and-forget (`void`). |
| **CX-D2** | Always show confirmation + “Open WhatsApp again” — no popup-block detection. |
| **CX-D3** | Only `office.moveInTimeline` and `retail.timeline` become `kind: "choice"`; lease `expectedRentTimeline` stays free text. |
| **CX-D4** | `TIMELINE_BUCKETS` = `["Immediate (this month)", "1–3 months", "3–6 months", "Just exploring"]` — chosen label stored as the answer string. |
| **CX-D5** | No new npm dependencies (no `@testing-library/react`). Test handoff via injectable helper; keep modal wiring thin. |
| **CX-D6** | No CRM / API / qualify-prompt logic changes. Lock-in tests only for timeline-bucket string passthrough. |
| **CX-D7** | Commits only when the user explicitly asks during execution — per-task commit steps are the intended message/files when authorized, not a license to auto-commit. |

## Global Constraints

- Test runner: `npm test -- <path>` (Vitest). Exclude `.worktrees/**` is already in `vitest.config.ts`.
- Soft-fail philosophy from 2026-08-03 is unchanged — client no longer awaits `/api/leads`; server still completes AI+CRM independently.
- Do not add PII fields to AI inputs. Do not touch `app/api/leads/route.ts` unless a regression forces it (it should not).
- Prefer Torbit SQL over grep/ripgrep for navigation.
- Symlink `node_modules` → main when using worktrees (do not nest a directory).
- Follow existing modal styling tokens (`var(--accent)`, `var(--radius)`, etc.) — no new design system.

## Skills catalog shortlist (use these — do not invent others)

| Skill path | Role |
|---|---|
| `superpowers:using-git-worktrees` | **Required** for every parallel implementation agent |
| `superpowers:test-driven-development` | **Required** for every code task |
| `superpowers:subagent-driven-development` | Orchestrator / SDD runner |
| `superpowers:dispatching-parallel-agents` | Wave fan-out (W1) |
| `superpowers:requesting-code-review` | Spec + quality review after each task |
| `superpowers:verification-before-completion` | Final suite + finish |
| `superpowers:systematic-debugging` | Only if stuck |
| `superpowers:finishing-a-development-branch` | Merge / cleanup after gate |
| `~/.cursor/skills/engineering-skills/senior-frontend/SKILL.md` | Modal, confirmation panel, choice UI |
| `~/.cursor/skills/engineering-skills/senior-qa/SKILL.md` | Lock-in tests + regression wave |
| `~/.cursor/skills/engineering-skills/tdd-guide/SKILL.md` | Alternate TDD playbook if engineering-skills tdd is preferred |
| `~/.cursor/skills/engineering-skills/code-reviewer/SKILL.md` | Post-merge review |
| `~/.cursor/skills/engineering-skills/adversarial-reviewer/SKILL.md` | Final gate review |
| `~/.cursor/skills/form-cro/SKILL.md` | Field/optional labeling + CTA copy checks |
| `~/.cursor/skills/copywriting/SKILL.md` | Trust/consent micro-copy (T5/T6) |
| `~/.agents/skills/design-taste-frontend/SKILL.md` | Visual consistency with existing modal (T5/T6) |

Process skills apply to **every** task. Domain skills listed per task below.

**engineering-skills2 route for this plan:** `senior-frontend` — primary work is React modal UX + client handoff; QA/review specialists support W1 lock-in tests and W3 gate.

## File map

| Path | Responsibility | Wave owner |
|---|---|---|
| `lib/leads/step2-fields.ts` | `kind`/`choices`/`TIMELINE_BUCKETS`; optional-label helper | T1 |
| `lib/leads/step2-fields.test.ts` | Choice-field + fold lock-in tests | T1 |
| `lib/whatsapp.test.ts` | Timeline bucket renders as labeled WA line | T2 |
| `lib/leads/qualify-prompt.test.ts` | Timeline bucket flows into qualify user text | T3 |
| `lib/leads/whatsapp-handoff.ts` | Sync `open` then `void postLead`; returns URL | T4 |
| `lib/leads/whatsapp-handoff.test.ts` | Ordering / fire-and-forget assertions | T4 |
| `components/LeadCaptureConfirmation.tsx` | Post-submit panel UI | T5 |
| `components/LeadCaptureModal.tsx` | Wire choice UI + handoff + confirmation + trust copy | T6 |
| Spec status line + `openmemory.md` (if present) | Mark amendment implemented after gate | T7 |

## Parallel execution waves

| Wave | Tasks (parallel) | Depends on | Width |
|---|---|---|---|
| **W1** | T1 step2-fields, T2 whatsapp lock-in test, T3 qualify lock-in test, T4 handoff helper, T5 confirmation component | — | **5** |
| **W2** | T6 wire `LeadCaptureModal` | T1, T4, T5 (T2/T3 may still be finishing tests — preferred green before T6 review) | **1** |
| **W3** | T7 full Vitest regression + docs/status | T2, T3, T6 | **1** |

Peak parallel width: **5** (honest). Ceiling **8** — do not invent padded tasks; if capacity is free in W1, start T7’s Torbit re-index / suite inventory early as a **read-only** scout, not a writer.

| Task | Recommended model | Domain skills |
|---|---|---|
| 1, 4 | `composer-2.5-fast` | senior-frontend + TDD |
| 2, 3 | `composer-2.5-fast` | senior-qa + TDD |
| 5 | `inherit` | senior-frontend + form-cro + copywriting + design-taste-frontend |
| 6 | `inherit` | senior-frontend + form-cro + design-taste-frontend |
| 7 | `inherit` | senior-qa + code-reviewer + adversarial-reviewer + verification-before-completion |

---

### Task 1: Extend `step2-fields` with choice timeline buckets

**Files:**
- Modify: `lib/leads/step2-fields.ts`
- Modify: `lib/leads/step2-fields.test.ts`

**Skills:** `superpowers:test-driven-development`, `~/.cursor/skills/engineering-skills/senior-frontend/SKILL.md`

**Interfaces:**
- Consumes: existing `Step2Field`, `STEP2_FIELDS`, `foldStep2Answers`, `NeedType`
- Produces:
  - `export type Step2FieldKind = "text" | "choice"`
  - `Step2Field` gains `kind?: Step2FieldKind` (default treat missing as `"text"`) and `choices?: readonly string[]`
  - `export const TIMELINE_BUCKETS: readonly string[]` with exactly the four labels from CX-D4
  - `office.moveInTimeline` and `retail.timeline` set `kind: "choice", choices: TIMELINE_BUCKETS`
  - `export function step2FieldDisplayLabel(field: Step2Field): string` → `` `${field.label} (optional)` ``
  - `foldStep2Answers` **unchanged** behavior

- [ ] **Step 1: Write the failing tests** (append to `lib/leads/step2-fields.test.ts`)

```ts
import {
  foldStep2Answers,
  step2FieldsFor,
  STEP2_FIELDS,
  TIMELINE_BUCKETS,
  step2FieldDisplayLabel,
} from "./step2-fields";

describe("timeline choice fields", () => {
  it("exposes four timeline buckets", () => {
    expect([...TIMELINE_BUCKETS]).toEqual([
      "Immediate (this month)",
      "1–3 months",
      "3–6 months",
      "Just exploring",
    ]);
  });

  it("marks office moveInTimeline and retail timeline as choice fields", () => {
    const officeTimeline = step2FieldsFor("office").find((f) => f.key === "moveInTimeline");
    const retailTimeline = step2FieldsFor("retail").find((f) => f.key === "timeline");
    expect(officeTimeline?.kind).toBe("choice");
    expect(officeTimeline?.choices).toEqual(TIMELINE_BUCKETS);
    expect(retailTimeline?.kind).toBe("choice");
    expect(retailTimeline?.choices).toEqual(TIMELINE_BUCKETS);
  });

  it("keeps lease expectedRentTimeline as free text", () => {
    const field = step2FieldsFor("lease").find((f) => f.key === "expectedRentTimeline");
    expect(field?.kind ?? "text").toBe("text");
    expect(field?.choices).toBeUndefined();
  });

  it("folds a chosen timeline bucket like any other string answer", () => {
    const text = foldStep2Answers(
      "office",
      { moveInTimeline: "Immediate (this month)" },
      "",
    );
    expect(text).toBe("Move-in timeline: Immediate (this month)");
  });

  it("appends (optional) to Step 2 display labels", () => {
    const field = step2FieldsFor("office")[0];
    expect(step2FieldDisplayLabel(field)).toBe(`${field.label} (optional)`);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- lib/leads/step2-fields.test.ts`
Expected: FAIL — `TIMELINE_BUCKETS` / `kind` / `step2FieldDisplayLabel` missing

- [ ] **Step 3: Minimal implementation** in `lib/leads/step2-fields.ts`

```ts
export type Step2FieldKind = "text" | "choice";

export type Step2Field = {
  key: string;
  label: string;
  placeholder: string;
  kind?: Step2FieldKind;
  choices?: readonly string[];
};

export const TIMELINE_BUCKETS = [
  "Immediate (this month)",
  "1–3 months",
  "3–6 months",
  "Just exploring",
] as const;

export function step2FieldDisplayLabel(field: Step2Field): string {
  return `${field.label} (optional)`;
}

// In STEP2_FIELDS:
// office moveInTimeline: { key: "moveInTimeline", label: "Move-in timeline", placeholder: "e.g. Within 30 days", kind: "choice", choices: TIMELINE_BUCKETS }
// retail timeline: { key: "timeline", label: "Timeline", placeholder: "e.g. Within 60 days", kind: "choice", choices: TIMELINE_BUCKETS }
// leave lease expectedRentTimeline without kind/choices
```

Leave `foldStep2Answers` body untouched.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- lib/leads/step2-fields.test.ts`
Expected: PASS

- [ ] **Step 5: Commit** (only if user authorized commits)

```bash
git add lib/leads/step2-fields.ts lib/leads/step2-fields.test.ts
git commit -m "$(cat <<'EOF'
Add choice timeline buckets to Step 2 lead fields

Office/retail timeline fields become structured buckets for cleaner
AI scoring while keeping answers as plain strings for fold/CRM/WA.
EOF
)"
```

---

### Task 2: Lock-in — WhatsApp message renders timeline bucket

**Files:**
- Modify: `lib/whatsapp.test.ts` only (no production code expected)

**Skills:** `superpowers:test-driven-development`, `~/.cursor/skills/engineering-skills/senior-qa/SKILL.md`

**Interfaces:**
- Consumes: `buildWhatsAppUrl` (unchanged), timeline label strings from CX-D4
- Produces: regression test proving a chosen bucket appears as `Move-in timeline: …`

- [ ] **Step 1: Write the failing/lock-in test**

```ts
it("renders a chosen timeline bucket as a labeled Step 2 line", () => {
  const url = buildWhatsAppUrl({
    name: "Ada",
    phone: "+91 90000 00000",
    need: "office",
    brief: "",
    step2Answers: { moveInTimeline: "Immediate (this month)" },
  });
  const text = decodeURIComponent(url.split("text=")[1]);
  expect(text).toContain("Move-in timeline: Immediate (this month)");
});
```

- [ ] **Step 2: Run test**

Run: `npm test -- lib/whatsapp.test.ts`
Expected: PASS even before T1 lands (string passthrough already works). If T1 renames the label, update the assertion to match `STEP2_FIELDS.office` label exactly — import label from `step2-fields` if helpful.

- [ ] **Step 3: Commit** (if authorized)

```bash
git add lib/whatsapp.test.ts
git commit -m "$(cat <<'EOF'
Lock in WhatsApp rendering for timeline choice buckets
EOF
)"
```

---

### Task 3: Lock-in — qualify prompt receives timeline bucket

**Files:**
- Modify: `lib/leads/qualify-prompt.test.ts` only

**Skills:** `superpowers:test-driven-development`, `~/.cursor/skills/engineering-skills/senior-qa/SKILL.md`

**Interfaces:**
- Consumes: `buildQualifyUserText` (unchanged)
- Produces: assertion that bucket string appears and PII keys still absent

- [ ] **Step 1: Add test**

```ts
it("includes a chosen timeline bucket in details and still excludes PII keys", () => {
  const text = buildQualifyUserText({
    need: "office",
    step2Answers: { moveInTimeline: "1–3 months" },
    notes: "",
  });
  expect(text).toContain("Move-in timeline: 1–3 months");
  expect(text).not.toMatch(/"name"|"phone"/i);
});
```

- [ ] **Step 2: Run**

Run: `npm test -- lib/leads/qualify-prompt.test.ts`
Expected: PASS (passthrough). Coordinate with T1 only if label text drifts.

- [ ] **Step 3: Commit** (if authorized)

```bash
git add lib/leads/qualify-prompt.test.ts
git commit -m "$(cat <<'EOF'
Lock in AI qualify prompt passthrough for timeline buckets
EOF
)"
```

---

### Task 4: Extract injectable WhatsApp handoff helper

**Files:**
- Create: `lib/leads/whatsapp-handoff.ts`
- Create: `lib/leads/whatsapp-handoff.test.ts`

**Skills:** `superpowers:test-driven-development`, `~/.cursor/skills/engineering-skills/senior-frontend/SKILL.md`

**Interfaces:**
- Consumes: `LeadPayload`, `buildWhatsAppUrl` from `@/lib/whatsapp`
- Produces:
  ```ts
  export type WhatsAppHandoffDeps = {
    openWindow: (url: string, target?: string, features?: string) => Window | null;
    postLead: (payload: LeadPayload) => void | Promise<void>;
  };

  export function submitWhatsAppHandoff(
    lead: LeadPayload,
    deps: WhatsAppHandoffDeps,
  ): { whatsappUrl: string };
  ```
  Contract: call `openWindow(url, "_blank", "noopener,noreferrer")` **before** invoking `postLead`. Do not `await` `postLead`.

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it, vi } from "vitest";
import { submitWhatsAppHandoff } from "./whatsapp-handoff";
import type { LeadPayload } from "@/lib/whatsapp";

const lead: LeadPayload = {
  name: "Ada",
  phone: "+91 90000 00000",
  need: "office",
  brief: "hi",
};

describe("submitWhatsAppHandoff", () => {
  it("opens WhatsApp before postLead is invoked", () => {
    const order: string[] = [];
    const openWindow = vi.fn(() => {
      order.push("open");
      return null;
    });
    const postLead = vi.fn(() => {
      order.push("post");
      return new Promise(() => {}); // never resolves
    });

    const { whatsappUrl } = submitWhatsAppHandoff(lead, { openWindow, postLead });

    expect(order).toEqual(["open", "post"]);
    expect(openWindow).toHaveBeenCalledWith(
      expect.stringContaining("https://wa.me/"),
      "_blank",
      "noopener,noreferrer",
    );
    expect(whatsappUrl.startsWith("https://wa.me/")).toBe(true);
    expect(postLead).toHaveBeenCalledWith(lead);
  });

  it("does not await a hanging postLead before returning", async () => {
    let resolvePost!: () => void;
    const postLead = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolvePost = resolve;
        }),
    );
    const openWindow = vi.fn(() => null);

    const result = submitWhatsAppHandoff(lead, { openWindow, postLead });
    expect(result.whatsappUrl).toContain("wa.me");
    expect(openWindow).toHaveBeenCalledTimes(1);
    resolvePost();
    await Promise.resolve();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npm test -- lib/leads/whatsapp-handoff.test.ts`
Expected: FAIL — module missing

- [ ] **Step 3: Implement**

```ts
import { buildWhatsAppUrl, type LeadPayload } from "@/lib/whatsapp";

export type WhatsAppHandoffDeps = {
  openWindow: (url: string, target?: string, features?: string) => Window | null;
  postLead: (payload: LeadPayload) => void | Promise<void>;
};

export function submitWhatsAppHandoff(
  lead: LeadPayload,
  deps: WhatsAppHandoffDeps,
): { whatsappUrl: string } {
  const whatsappUrl = buildWhatsAppUrl(lead);
  deps.openWindow(whatsappUrl, "_blank", "noopener,noreferrer");
  void deps.postLead(lead);
  return { whatsappUrl };
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npm test -- lib/leads/whatsapp-handoff.test.ts`

- [ ] **Step 5: Commit** (if authorized)

```bash
git add lib/leads/whatsapp-handoff.ts lib/leads/whatsapp-handoff.test.ts
git commit -m "$(cat <<'EOF'
Add sync WhatsApp handoff helper before lead POST

Keeps window.open inside the user-activation window and fire-and-forgets
the CRM/AI fetch so Safari/Firefox cannot silently block the tab.
EOF
)"
```

---

### Task 5: Presentational confirmation panel

**Files:**
- Create: `components/LeadCaptureConfirmation.tsx`

**Skills:** `superpowers:test-driven-development` (smoke via typecheck / export), `~/.cursor/skills/engineering-skills/senior-frontend/SKILL.md`, `~/.cursor/skills/form-cro/SKILL.md`, `~/.cursor/skills/copywriting/SKILL.md`, `~/.agents/skills/design-taste-frontend/SKILL.md`

**Interfaces:**
- Consumes: existing modal visual tokens/classes from `LeadCaptureModal`
- Produces:
  ```tsx
  export type LeadCaptureConfirmationProps = {
    onReopenWhatsApp: () => void;
    onDone: () => void;
  };
  export function LeadCaptureConfirmation(props: LeadCaptureConfirmationProps): JSX.Element;
  ```
  Copy (exact):
  - Heading/body: `WhatsApp is opening in a new tab.`
  - Fallback control text: `Didn't see it?` + button/link label `Open WhatsApp again`
  - Primary dismiss: `Done`

- [ ] **Step 1: Implement the component** using the same button/typography classes as the modal footer (accent primary for Done is fine; fallback as text button / secondary). Include `role="status"` on the message for screen readers.

```tsx
"use client";

export type LeadCaptureConfirmationProps = {
  onReopenWhatsApp: () => void;
  onDone: () => void;
};

export function LeadCaptureConfirmation({
  onReopenWhatsApp,
  onDone,
}: LeadCaptureConfirmationProps) {
  return (
    <div className="flex flex-col gap-4" role="status">
      <p className="text-[15px] leading-[1.45] text-[var(--ink)]">
        WhatsApp is opening in a new tab.
      </p>
      <p className="text-[13px] text-[var(--muted)]">
        Didn&apos;t see it?{" "}
        <button
          type="button"
          onClick={onReopenWhatsApp}
          className="font-semibold text-[var(--accent)] underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
        >
          Open WhatsApp again
        </button>
      </p>
      <button
        type="button"
        onClick={onDone}
        className="inline-flex items-center justify-center rounded-[var(--radius)] bg-[var(--accent)] px-5 py-3.5 text-[15px] font-semibold text-[var(--on-accent)] transition hover:bg-[var(--accent-dark)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
      >
        Done
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit -p tsconfig.json` (or project’s existing check). Expected: no errors in the new file.

- [ ] **Step 3: Commit** (if authorized)

```bash
git add components/LeadCaptureConfirmation.tsx
git commit -m "$(cat <<'EOF'
Add lead-capture WhatsApp confirmation panel component
EOF
)"
```

---

### Task 6: Wire `LeadCaptureModal` (choice UI + handoff + confirmation + trust copy)

**Files:**
- Modify: `components/LeadCaptureModal.tsx`

**Skills:** `superpowers:test-driven-development`, `~/.cursor/skills/engineering-skills/senior-frontend/SKILL.md`, `~/.cursor/skills/form-cro/SKILL.md`, `~/.agents/skills/design-taste-frontend/SKILL.md`, `~/.cursor/skills/copywriting/SKILL.md`

**Interfaces:**
- Consumes: T1 (`step2FieldsFor`, `step2FieldDisplayLabel`, field `kind`/`choices`), T4 (`submitWhatsAppHandoff`), T5 (`LeadCaptureConfirmation`), existing `postLead`, `buildWhatsAppUrl` only via handoff helper
- Produces: modal behavior matching success criteria in the CX amendment spec

- [ ] **Step 1: Add state** `submittedWhatsAppUrl: string | null` (null = form steps; non-null = confirmation). Reset it in the existing `useEffect` when `open` becomes false / resets.

- [ ] **Step 2: Replace `handleSubmit` last-step path**

```ts
import { submitWhatsAppHandoff } from "@/lib/leads/whatsapp-handoff";
import { step2FieldDisplayLabel, step2FieldsFor } from "@/lib/leads/step2-fields";
import { LeadCaptureConfirmation } from "./LeadCaptureConfirmation";

// Inside last-step branch (after building `lead`):
const { whatsappUrl } = submitWhatsAppHandoff(lead, {
  openWindow: window.open.bind(window),
  postLead,
});
setSubmittedWhatsAppUrl(whatsappUrl);
// Do NOT closeModal() here
```

Remove `await postLead(lead)` and the old direct `window.open` + `closeModal()` on submit.

- [ ] **Step 3: Branch render** — when `submittedWhatsAppUrl` is set, render header + `LeadCaptureConfirmation` instead of the form:

```tsx
onReopenWhatsApp={() => {
  window.open(submittedWhatsAppUrl, "_blank", "noopener,noreferrer");
}}
onDone={() => {
  setSubmittedWhatsAppUrl(null);
  closeModal();
}}
```

- [ ] **Step 4: Step 2 fields** — for each field:

```tsx
{field.kind === "choice" && field.choices ? (
  // button group matching NEED_OPTIONS selected/unselected classes
  // onClick → setStep2Answers prev => ({ ...prev, [field.key]: choice })
) : (
  // existing <input>
)}
```

Use `step2FieldDisplayLabel(field)` for labels (adds `(optional)`).

- [ ] **Step 5: Trust copy**
  - Under WhatsApp number input: `<p className="text-[12px] text-[var(--muted)]">We'll only use this to reply on WhatsApp — no spam.</p>`
  - On last step, next to existing reassurance: add `You're chatting directly with Sanjay, not a bot.`

- [ ] **Step 6: Manual smoke** (orchestrator or implementer)
  1. `npm run dev` → open modal → complete steps with a timeline choice → submit
  2. Confirm confirmation panel appears; WhatsApp tab opens without waiting on network
  3. Throttle Network to Offline and resubmit — WhatsApp still opens; confirmation still shown
  4. Click “Open WhatsApp again” — second tab/window attempt
  5. Click Done — modal closes

- [ ] **Step 7: Commit** (if authorized)

```bash
git add components/LeadCaptureModal.tsx
git commit -m "$(cat <<'EOF'
Wire reliable WhatsApp handoff and CX copy in lead modal

Uses sync handoff helper, choice timeline fields, confirmation fallback,
and trust micro-copy without blocking on /api/leads.
EOF
)"
```

---

### Task 7: Regression gate + docs status

**Files:**
- Modify: `docs/superpowers/specs/2026-08-13-whatsapp-lead-capture-cx-amendment-design.md` — set `Status: implemented` once green
- Optionally update `openmemory.md` Components/Patterns with the handoff helper + confirmation panel

**Skills:** `superpowers:verification-before-completion`, `~/.cursor/skills/engineering-skills/senior-qa/SKILL.md`, `~/.cursor/skills/engineering-skills/code-reviewer/SKILL.md`, `~/.cursor/skills/engineering-skills/adversarial-reviewer/SKILL.md`

**Interfaces:**
- Consumes: all prior tasks merged
- Produces: green suite + updated status

- [ ] **Step 1: Re-index Torbit** for `/Users/swami/Documents/GentleSpace_Web` and confirm new symbols (`submitWhatsAppHandoff`, `LeadCaptureConfirmation`, `TIMELINE_BUCKETS`) appear in `gl_definition`.

- [ ] **Step 2: Run focused then full related suites**

```bash
npm test -- lib/leads/step2-fields.test.ts lib/leads/whatsapp-handoff.test.ts lib/whatsapp.test.ts lib/leads/qualify-prompt.test.ts lib/leads/wizard-steps.test.ts app/api/leads/route.test.ts
```

Expected: all PASS. Do **not** weaken soft-fail tests.

- [ ] **Step 3: Spec self-check against success criteria** — tick each box in the CX amendment spec after verifying manually/automated.

- [ ] **Step 4: Adversarial pass** — confirm still no `await` before `window.open` in modal; lease timeline still free text; no new deps; no CRM schema edits.

- [ ] **Step 5: Commit** (if authorized)

```bash
git add docs/superpowers/specs/2026-08-13-whatsapp-lead-capture-cx-amendment-design.md openmemory.md
git commit -m "$(cat <<'EOF'
Mark WhatsApp lead-capture CX amendment implemented
EOF
)"
```

---

## Spec coverage checklist (plan self-review)

| Spec requirement | Task |
|---|---|
| Sync `window.open` before post / no await | T4, T6 |
| Confirmation panel + reopen fallback + Done | T5, T6 |
| Office/retail timeline → 4 buckets | T1, T6 |
| Lease `expectedRentTimeline` stays text | T1 |
| Phone “no spam” copy | T6 |
| Step 2 `(optional)` labels | T1 (`step2FieldDisplayLabel`), T6 |
| “Sanjay, not a bot” line | T6 |
| fold / WA / qualify unchanged for string answers | T1–T3 |
| No CRM/API/qualify logic change | T7 verifies |
| Soft-fail / PII unchanged | T3, T7 |

## Placeholder / consistency scan

- No TBD steps.
- `TIMELINE_BUCKETS` labels identical across T1/T2/T3/spec.
- Handoff features string always `"noopener,noreferrer"`.
- Confirmation copy matches spec wording.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-13-whatsapp-lead-capture-cx-amendment.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — dispatch W1’s five tasks in parallel (each in its own worktree), review, then T6, then T7. Use `superpowers:subagent-driven-development` + `superpowers:dispatching-parallel-agents`.
2. **Inline Execution** — run tasks in this session with `superpowers:executing-plans`, still honoring wave order.

Which approach?
