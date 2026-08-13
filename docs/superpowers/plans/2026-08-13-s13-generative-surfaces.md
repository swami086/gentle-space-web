# S13 Generative Surfaces (F1–F5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Parallelism:** One git worktree + branch per implementation subagent (`superpowers:using-git-worktrees` / `best-of-n-runner`). Ceiling: **8 concurrent implementation subagents**. Never share a working tree across parallel writers.
>
> **OpenUI:** REQUIRED skill `~/.cursor/skills/openui/SKILL.md` for every task that touches libraries, Renderer, Query/Mutation, or prompts. Prefer installed `@openuidev/*` APIs over inventing patterns.

**Goal:** Ship backend-spec F1–F5 so Ask / Why / call-prep answers are **org-scoped**, emit **typed OpenUI action proposals** (not free-form mutate), ground claims in an **explicit citation allowlist**, and **persist** so Why survives refresh — gate: **answers cite only the grounding pack**.

**Architecture:** Keep the **existing self-hosted OpenUI stack** (`@openuidev/lang-core`, `react-lang`, `react-ui` — do **not** switch to OpenUI Cloud). Close F1 by binding analytics/campaign tools to session `Scope` the way CRM already does (`createCrmToolProvider(scope)`). Add a pure **grounding-pack** + **citation gate** shared by Why/Ask/call-prep. Add an OpenUI **ActionProposal** component whose clicks resolve via `resolveOpenUiAction`-style handlers into **pending proposals or navigation**, never live Google/Meta execute. Persist answers in migration **111**.

**Tech Stack:** TypeScript, Next.js App Router, Vitest, Zod v4 (`zod/v4`), `@openuidev/react-lang` `defineComponent` / `createLibrary` / `Renderer`, existing Bifrost metering, `pg` migrations, existing `toolScope` / `guard`.

**Specs (authoritative):**
- [`docs/superpowers/specs/2026-08-12-backend-features-design.md`](../specs/2026-08-12-backend-features-design.md) §F F1–F5
- [`docs/superpowers/specs/2026-08-12-build-sequence.md`](../specs/2026-08-12-build-sequence.md) S13 gate
- [`docs/superpowers/specs/2026-08-11-admin-ux-architecture-design.md`](../specs/2026-08-11-admin-ux-architecture-design.md) Ask / Why / Architecture A
- [`docs/superpowers/specs/2026-08-05-openui-platform-foundation-design.md`](../specs/2026-08-05-openui-platform-foundation-design.md) hybrid shell + AskAiTrigger
- Agent context pack as citation precedent: `ads-agent/mcp/context-server/context-pack.ts` (`rowIds` = cite allowlist)

**Torbit (indexed `/Users/swami/Documents/GentleSpace_Web`, project_id `1672773718350201492`):** prefer `run_sql` on `gl_file` / `gl_definition`. Hubs:
- `ads-agent/lib/openui/{tool-scope,platform-tools,analytics-tools,campaign-tools,crm-tools,hermes-library,shared-*}.ts`
- `ads-agent/app/api/openui/tools/route.ts` (`createPlatformToolProvider(access.scope)`)
- `ads-agent/components/AskAiTrigger.tsx` (implemented, **zero call sites**)
- `ads-agent/mcp/context-server/context-pack.ts`
- Installed: `@openuidev/lang-core ^0.2.10`, `@openuidev/react-lang ^0.2.9`, `@openuidev/react-ui ^0.13.6`, `zod ^4.4.3`

## Decisions locked in this plan

| ID | Decision |
|---|---|
| **S13-D1** | **Self-hosted OpenUI only** — no Thesys Cloud migration. Use `Renderer` + domain/`openuiChatLibrary` merges; Query/Mutation via `/api/openui/tools`. |
| **S13-D2** | **F1:** Replace `ADS_AGENT_ORG_ID` binding in `analytics-tools` / `campaign-tools` with `create*ToolProvider(scope: Scope)` matching CRM. `toolScope()` / `guard().scope` only; ignore any `orgId` in tool args. |
| **S13-D3** | **F2:** OpenUI `ActionProposal` card → user confirm → create/navigate **pending** `proposals` (or open existing proposal). Never call executor / Google Ads from generative path. |
| **S13-D4** | **F4:** `GroundingPack` = `{ entity, id, rowIds, facts, builtAt }` built for session Scope (reuse context-pack fact shape where possible). Every model-visible number/name must map to a `rowIds` entry or fail the citation gate. |
| **S13-D5** | **F3:** Call-prep returns OpenUI Lang (or structured props → library) with **exactly three** talking points, each with `citationIds: string[]` subset of pack `rowIds`. Depends on enquiry + space facts; soft-degrade if attribution missing. |
| **S13-D6** | **F5:** Table `adsagent.generative_answers` (migration **111**) with `org_id`, RLS, `surface` enum (`ask`\|`why`\|`call_prep`), `subject_type`/`subject_id`, `pack_row_ids`, `openui_lang`, `follow_ups jsonb`. |
| **S13-D7** | Wire **AskAiTrigger** onto proposal detail (Why?) and at least one Today/KPI surface; Ask uses Copilot `seedAndOpen` (no new nav IA rewrite). |
| **S13-D8** | No new npm dependencies. Prefer Torbit over grep. |

## Global Constraints

- No new npm dependencies.
- Every data-layer function takes `Scope` first; wrong tenant → **404**, never 403.
- Schema-qualified SQL; numbered migrations only — **111** reserved for generative answers.
- Generative tools must not accept tenant from the model (data model §5 / `toolScope` contract).
- Agents/humans dispose: generative path may **propose**, never **execute** spend or send.
- OpenUI Lang v0.5: positional args, `root =` first for streaming, `zod/v4` prop order = arg order.
- Import `openuiChatLibrary` from `@openuidev/react-ui/genui-lib` (not package root) when on the server/shared path — same footgun as `hermes-library.ts`.
- Strip smuggle on persisted/display strings (`stripSmuggle`).
- Tests: Vitest colocated; run from `ads-agent/`. Prefer `composer-2.5-fast` for mechanical TDD; `inherit` for security (F1/F2/F4).
- Prefer Torbit MCP for navigation.

## Skills catalog shortlist (use these — do not invent others)

| Skill | Role in S13 |
|---|---|
| `~/.cursor/skills/openui/SKILL.md` | **Required** for library/Renderer/Query/prompt tasks |
| `superpowers:using-git-worktrees` | **Required** for every parallel implementer |
| `superpowers:test-driven-development` | **Required** for every code task |
| `superpowers:subagent-driven-development` | Orchestrator / SDD runner |
| `superpowers:requesting-code-review` | After each task |
| `superpowers:verification-before-completion` | Gate + finish |
| `superpowers:systematic-debugging` | Only if stuck |
| `engineering-skills/senior-frontend` | AskAiTrigger wiring, Why/call-prep UI |
| `engineering-skills/senior-backend` | Migrations, answers API, tool providers |
| `engineering-skills/ai-security` | Citation gate, ActionProposal trust boundary |
| `engineering-skills/senior-qa` / `adversarial-reviewer` | Final gate |
| `engineering-skills/tdd-guide` | Optional process assist for Vitest RED/GREEN |

Process skills apply to **every** task. Domain skills listed per task below.

## File map

| Path | Responsibility |
|---|---|
| `ads-agent/lib/openui/analytics-tools.ts` | `createAnalyticsToolProvider(scope)` — drop env org bind |
| `ads-agent/lib/openui/campaign-tools.ts` | `createCampaignToolProvider(scope)` — drop env org bind |
| `ads-agent/lib/openui/platform-tools.ts` | Compose scoped providers only |
| `ads-agent/lib/openui/tool-scope.ts` | Keep; optionally export `rejectClientOrgId(args)` helper |
| `ads-agent/lib/generative/grounding-pack.ts` | Build pack for Scope + entity/id |
| `ads-agent/lib/generative/citation-gate.ts` | Assert claims ⊆ pack.rowIds |
| `ads-agent/lib/generative/call-prep.ts` | Produce 3 talking points + citations |
| `ads-agent/lib/generative/action-proposal.ts` | Typed payload + resolve to pending proposal / URL |
| `ads-agent/lib/openui/generative-library.ts` | OpenUI `ActionProposal`, `CallPrepCard`, `WhyCard` |
| `ads-agent/lib/db/migrations/111_generative_answers.up.sql` (+ `.down.sql`) | Persist answers |
| `ads-agent/lib/db/generative-answers.ts` | CRUD with Scope |
| `ads-agent/app/api/generative/why/route.ts` | Why generation + persist |
| `ads-agent/app/api/generative/ask/route.ts` | Ask generation + persist |
| `ads-agent/app/api/generative/call-prep/route.ts` | Call-prep for enquiry id |
| `ads-agent/app/api/generative/answers/[id]/route.ts` | Read persisted answer + follow-ups |
| `ads-agent/components/generative/WhyPanel.tsx` | Renderer + AskAiTrigger |
| `ads-agent/components/generative/CallPrepBlock.tsx` | Enquiry talking points |
| `ads-agent/app/(admin)/proposals/[id]/page.tsx` | Mount WhyPanel |
| `ads-agent/app/(admin)/page.tsx` (or enquiry detail if present) | Mount CallPrep / AskAiTrigger |
| `docs/superpowers/specs/2026-08-13-s13-generative-surfaces-gate.md` | Gate record |

## Parallel execution waves

| Wave | Tasks (parallel) | Depends on | Width |
|---|---|---|---|
| **W1** | T1 analytics scoped provider, T2 campaign scoped provider, T3 grounding-pack + citation-gate, T4 ActionProposal types | — | **4** |
| **W2** | T5 platform-tools + openui/tools tests | T1, T2 | **1** |
| **W3** | T6 generative OpenUI library, T7 call-prep module | T3, T4 | **2** |
| **W4** | T8 migration 111 + answers db | — (can start after W1 if parallel capacity) | **1** |
| **W5** | T9 why/ask/call-prep API routes | T3–T8 | **1** (single agent for three routes OK) **or** split to 3 if width free |
| **W6** | T10 WhyPanel + AskAiTrigger wiring, T11 CallPrepBlock | T6, T9 | **2** |
| **W7** | T12 gate tests + runbook/openmemory | T1–T11 | **1** |

Peak parallel width: **4** in W1 (honest). Ceiling remains **8** — optional split of T9 into three route tasks only if W5 starts with W4 complete and implementers are idle.

| Task | Recommended model | Domain skills |
|---|---|---|
| 1–2, 5, 8 | `composer-2.5-fast` | senior-backend + openui |
| 3–4, 7 | `composer-2.5-fast` | ai-security + tdd |
| 6, 10–11 | `composer-2.5-fast` | openui + senior-frontend |
| 9 | `inherit` | senior-backend + ai-security |
| 12 | `inherit` | senior-qa |

---

### Task 1: Scoped analytics tool provider (F1)

**Files:**
- Modify: `ads-agent/lib/openui/analytics-tools.ts`
- Modify: `ads-agent/lib/openui/analytics-tools.test.ts`

**Skills:** `openui`, `superpowers:test-driven-development`, `engineering-skills/senior-backend`, `engineering-skills/ai-security`

**Interfaces:**
- Produces: `export function createAnalyticsToolProvider(scope: Scope): ToolProviderMap`
- Deprecate/remove env-bound `analyticsToolProvider` **or** redefine it as a throw-on-use stub so call sites must migrate (prefer delete + fix compile errors in Task 5)

- [ ] **Step 1: Failing test** — `createAnalyticsToolProvider(scope)` calls handlers with that scope; tool args containing `orgId` do **not** change scope

```ts
it("binds the provided scope, not ADS_AGENT_ORG_ID", async () => {
  const scope = { kind: "org" as const, orgId: "10101010-1010-1010-1010-101010101010" };
  // mock listProposals / dashboard reads; invoke list_pending_proposals
  // assert mock received `scope`
});

it("ignores orgId in tool args", async () => {
  // pass args.orgId = other uuid; still uses provider scope
});
```

- [ ] **Step 2: Implement** — mirror `createCrmToolProvider(scope)` pattern; delete `bindScopedHandlers` env path
- [ ] **Step 3: PASS + commit** `fix(s13): scope analytics OpenUI tools from session`

---

### Task 2: Scoped campaign tool provider (F1)

**Files:**
- Modify: `ads-agent/lib/openui/campaign-tools.ts`
- Modify: `ads-agent/lib/openui/campaign-tools.test.ts`

**Skills:** same as Task 1

**Interfaces:**
- Produces: `export function createCampaignToolProvider(scope: Scope): ToolProviderMap`

- [ ] **Step 1–4:** Same TDD pattern as Task 1 for `start_campaign_draft`
- [ ] **Commit:** `fix(s13): scope campaign OpenUI tools from session`

---

### Task 3: Grounding pack + citation gate (F4)

**Files:**
- Create: `ads-agent/lib/generative/grounding-pack.ts`
- Create: `ads-agent/lib/generative/grounding-pack.test.ts`
- Create: `ads-agent/lib/generative/citation-gate.ts`
- Create: `ads-agent/lib/generative/citation-gate.test.ts`

**Skills:** `superpowers:test-driven-development`, `engineering-skills/ai-security`, `engineering-skills/senior-backend`

**Interfaces:**
- Produces:
  - `export type GenerativeGroundingPack = { entity: "enquiry" \| "proposal" \| "campaign" \| "space"; id: string; builtAt: string; rowIds: string[]; facts: Record<string, unknown> }`
  - `export async function buildGroundingPack(scope: Scope, entity: GenerativeGroundingPack["entity"], id: string): Promise<GenerativeGroundingPack>`
  - `export function assertCitationsAllowed(pack: GenerativeGroundingPack, citationIds: string[]): void` — throws `citation_not_in_pack`
  - `export function extractClaimIdsFromOpenUi(openuiLang: string): string[]` — parses `citationIds` / `cite([...])` conventions used by generative library (document the convention in comments)

For **proposal** packs: load proposal + related campaign/corridor ids via existing `getProposalById(scope, id)`. For **enquiry**: reuse enquiry DB reads (same facts shape as context-pack where practical). Do **not** call agent_ro MCP from the Next route — use owner/session Scope pools.

- [ ] **Step 1: Tests for empty citations OK; foreign id throws; pack.rowIds non-empty when entity exists; 404-style throw when missing**
- [ ] **Step 2: Implement**
- [ ] **Commit:** `feat(s13): grounding pack and citation gate`

---

### Task 4: Action-proposal protocol (F2)

**Files:**
- Create: `ads-agent/lib/generative/action-proposal.ts`
- Create: `ads-agent/lib/generative/action-proposal.test.ts`

**Skills:** `openui`, `engineering-skills/ai-security`, `superpowers:test-driven-development`

**Interfaces:**
- Produces:
  - `export type ActionProposalPayload = { v: 1; kind: string; title: string; summary: string; href?: string; proposalId?: string; citationIds: string[] }`
  - `export function parseActionProposalPayload(raw: unknown): ActionProposalPayload`
  - `export function resolveActionProposalClick(payload: ActionProposalPayload): { kind: "navigate"; path: string } \| { kind: "noop" }` — **navigate only** to `/proposals/[id]` or provided safe relative `href` (must start with `/`, no `//`)

No network in this module.

- [ ] **Step 1: Tests** — reject absolute external URLs; accept `/proposals/…`; require citationIds array
- [ ] **Step 2: Implement**
- [ ] **Commit:** `feat(s13): typed action proposal protocol`

---

### Task 5: Wire platform-tools to scoped providers

**Files:**
- Modify: `ads-agent/lib/openui/platform-tools.ts`
- Modify: `ads-agent/lib/openui/platform-tools.test.ts` (create if missing)
- Modify: any imports of `analyticsToolProvider` / `campaignToolProvider` (Torbit: search `gl_definition` / file text via `run_sql` for symbol use)

**Skills:** `openui`, `engineering-skills/senior-backend`

**Interfaces:**
- `createPlatformToolProvider(scope)` must call `createCampaignToolProvider(scope)`, `createCrmToolProvider(scope)`, `createAnalyticsToolProvider(scope)`

- [ ] **Step 1: Test** that provider tools close over the passed scope (mock factories or spy)
- [ ] **Step 2: Fix compile breakages**
- [ ] **Run:** `npx vitest run lib/openui/platform-tools.test.ts lib/openui/analytics-tools.test.ts lib/openui/campaign-tools.test.ts app/api/openui/tools/route.test.ts`
- [ ] **Commit:** `fix(s13): platform OpenUI tools always session-scoped`

---

### Task 6: Generative OpenUI library (F2/F3 UI components)

**Files:**
- Create: `ads-agent/lib/openui/generative-library.ts`
- Create: `ads-agent/lib/openui/generative-library.test.ts`

**Skills:** `openui` (**required**), `engineering-skills/senior-frontend`

**Interfaces:**
- `ActionProposal` — props via `zod/v4`: `title`, `summary`, `kind`, `href` optional, `citationIds: z.array(z.string())`
- `CallPrepCard` — `points: z.array(z.object({ text: z.string(), citationIds: z.array(z.string()) })).length(3)`
- `WhyCard` — `body: z.string()`, `citationIds: z.array(z.string())`, `followUps: z.array(z.string()).optional()`
- Export `generativeLibrary = createLibrary({ root: "WhyCard", components: [...] })` — or root `Card` wrapping; document root choice in file header
- Parser round-trip test with positional OpenUI Lang sample

Follow OpenUI skill: positional args = Zod key order; import patterns from `crm-library.ts` / `analytics-library.ts`.

- [ ] **Step 1: Failing parser tests**
- [ ] **Step 2: defineComponent + createLibrary**
- [ ] **Commit:** `feat(s13): OpenUI generative library (Why/CallPrep/ActionProposal)`

---

### Task 7: Call-prep generator (F3)

**Files:**
- Create: `ads-agent/lib/generative/call-prep.ts`
- Create: `ads-agent/lib/generative/call-prep.test.ts`

**Skills:** `superpowers:test-driven-development`, `engineering-skills/senior-backend`, `openui`

**Interfaces:**
- `export async function buildCallPrep(scope: Scope, enquiryId: string): Promise<{ pack: GenerativeGroundingPack; openuiLang: string; points: Array<{ text: string; citationIds: string[] }> }>`
- Uses `buildGroundingPack`; produces exactly 3 points; each `citationIds` ⊆ `pack.rowIds`
- If Bifrost unavailable: deterministic template from pack facts (no invented numbers)
- Run `assertCitationsAllowed` before return

- [ ] **Step 1: Unit tests with mocked pack**
- [ ] **Step 2: Implement**
- [ ] **Commit:** `feat(s13): call-prep generation grounded in pack`

---

### Task 8: Migration 111 + generative answers DB (F5)

**Files:**
- Create: `ads-agent/lib/db/migrations/111_generative_answers.up.sql`
- Create: `ads-agent/lib/db/migrations/111_generative_answers.down.sql`
- Create: `ads-agent/lib/db/generative-answers.ts`
- Create: `ads-agent/lib/db/generative-answers.test.ts`

**Skills:** `engineering-skills/senior-backend`, `postgres-pro` if available else senior-backend, `superpowers:test-driven-development`

**Schema (minimum):**
```sql
CREATE TABLE adsagent.generative_answers (
  id UUID PRIMARY KEY DEFAULT uuidv7(),
  org_id UUID NOT NULL REFERENCES public.orgs(id),
  surface TEXT NOT NULL CHECK (surface IN ('ask','why','call_prep')),
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  pack_row_ids TEXT[] NOT NULL,
  openui_lang TEXT NOT NULL,
  follow_ups JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- RLS FORCE + tenant_isolation policy using public.current_tenant()
```

**Interfaces:**
- `insertGenerativeAnswer(scope, input) → row`
- `getGenerativeAnswer(scope, id) → row | null` (null = 404 path)
- `listGenerativeAnswers(scope, { surface, subjectType, subjectId })`

- [ ] **Step 1: Tests with mocked pool or existing db test pattern**
- [ ] **Step 2: SQL + module**
- [ ] **Commit:** `feat(s13): generative_answers table and db module`

---

### Task 9: Why / Ask / Call-prep API routes

**Files:**
- Create: `ads-agent/app/api/generative/why/route.ts` (+ `.test.ts`)
- Create: `ads-agent/app/api/generative/ask/route.ts` (+ `.test.ts`)
- Create: `ads-agent/app/api/generative/call-prep/route.ts` (+ `.test.ts`)
- Create: `ads-agent/app/api/generative/answers/[id]/route.ts` (+ `.test.ts`)

**Skills:** `engineering-skills/senior-backend`, `engineering-skills/ai-security`, `openui`

**Contracts:**
- Auth: `guard("viewer")` for GET answers; `guard("operator")` for generate POSTs (match existing chat posture — if Copilot uses operator, stay consistent; document choice in route header)
- POST `/api/generative/why` body `{ proposalId }` → build pack → draft Why OpenUI → citation gate → persist → `{ id, openuiLang, followUps }`
- POST `/api/generative/ask` body `{ question, subjectType?, subjectId? }` → pack if subject → OpenUI answer → gate → persist
- POST `/api/generative/call-prep` body `{ enquiryId }` → `buildCallPrep` → persist surface `call_prep`
- GET `/api/generative/answers/[id]` → persisted row or 404

Never log full OpenUI blobs with PII at info level.

- [ ] **Step 1: Route tests with mocked generative modules**
- [ ] **Step 2: Implement**
- [ ] **Commit:** `feat(s13): generative why/ask/call-prep API routes`

---

### Task 10: WhyPanel + AskAiTrigger wiring (F5 UX)

**Files:**
- Create: `ads-agent/components/generative/WhyPanel.tsx` (+ test if practical)
- Modify: `ads-agent/app/(admin)/proposals/[id]/page.tsx`
- Modify: wire `AskAiTrigger` on proposal list or detail (hover group)
- Use Copilot `seedAndOpen` if available (Torbit: `CopilotPanel` / `copilot-state`)

**Skills:** `openui`, `engineering-skills/senior-frontend`

- Client component: fetch Why → `<Renderer response={openuiLang} library={generativeLibrary} isStreaming={…} onAction={…} />`
- Map `onAction` through `resolveOpenUiAction` + `resolveActionProposalClick`
- Persist id shown so refresh can GET answer

- [ ] **Step 1: Mount on proposal detail**
- [ ] **Step 2: Manual smoke notes in PR/task report**
- [ ] **Commit:** `feat(s13): Why panel and AskAiTrigger on proposals`

---

### Task 11: CallPrepBlock on enquiry surface

**Files:**
- Create: `ads-agent/components/generative/CallPrepBlock.tsx`
- Mount on the best existing enquiry UI surface (Torbit: if no dedicated page, mount on CRM opportunity detail or home Today card that links enquiries — **do not invent a full Enquiries IA**). Prefer `ads-agent/app/(admin)/crm/page.tsx` or home if enquiry detail page absent.

**Skills:** `openui`, `engineering-skills/senior-frontend`

- [ ] **Step 1: Component + mount**
- [ ] **Commit:** `feat(s13): call-prep OpenUI block`

---

### Task 12: S13 gate + docs

**Files:**
- Create: `docs/superpowers/specs/2026-08-13-s13-generative-surfaces-gate.md`
- Create: `ads-agent/lib/generative/s13-gate.test.ts` — citation gate rejects foreign id; scoped provider ignores arg orgId; ActionProposal rejects `javascript:` href; call-prep returns 3 cited points
- Modify: `openmemory.md` — add S13 plan row

**Skills:** `engineering-skills/senior-qa`, `engineering-skills/adversarial-reviewer`, `superpowers:verification-before-completion`

**Gate checklist:**
1. OpenUI tools for analytics/campaign use session Scope (no `ADS_AGENT_ORG_ID` on request path)
2. Generated Why/Ask/call-prep fail closed if citation ∉ pack
3. ActionProposal cannot navigate off-origin
4. Persisted answer reloadable by id under RLS
5. AskAiTrigger has ≥1 real call site

- [ ] **Step 1: Gate tests green**
- [ ] **Step 2: Gate doc + openmemory**
- [ ] **Commit:** `test(s13): generative surfaces gate`

---

## Spec coverage checklist

| Spec | Task |
|---|---|
| F1 org-scoped tools | T1, T2, T5 |
| F2 action-proposal protocol | T4, T6, T10 |
| F3 call-prep | T7, T9, T11 |
| F4 grounding pack | T3, T7, T9, T12 |
| F5 persistence | T8, T9, T10 |
| Build-sequence gate | T12 |
| OpenUI hybrid shell / AskAiTrigger | T10 |
| Admin UX Why / Ask | T9, T10 |

## Out of scope

- OpenUI Cloud / Thesys
- New Hermes profiles (S14+)
- Full Enquiries IA redesign
- Executing ads from generative cards
- CMS (S17)
- Replacing Copilot with `AgentInterface` shell (optional later)

## Execution handoff

After saving this plan, offer:

1. **Subagent-Driven (recommended)** — Composer 2.5 for mechanical tasks  
2. **Inline Execution**
