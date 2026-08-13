# S14 `performance` and `campaign` Agents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Parallelism:** One git worktree + branch per implementation subagent (`superpowers:using-git-worktrees` / `best-of-n-runner`). Ceiling: **8 concurrent implementation subagents**. Never share a working tree across parallel writers. Prefer Torbit (`project_id` `1672773718350201492`) over grep — re-index if commit drifts past `481ad25`.

**Goal:** Ship agent-topology Stage 4 so Hermes profiles **`performance`** and **`campaign`** read spend analytics from the **ClickHouse replica** (not Postgres OLTP), optionally enrich via **Google Ads MCP read tools**, and queue **pending** proposals (`campaign.pause` / `campaign.create` / `campaign.budget_change`) — gate: **live Hermes E2E against local Docker ClickHouse proves replica reads**.

**Architecture:** Extend the S10/S12 thin-profile pattern: server-owned mint allowlists in `lib/agent/*-tools.ts` + `profiles.ts`, Hermes skills under `docs/superpowers/hermes-skills/`, wake stubs with `HERMES_WAKE=1`. Context-MCP `get_campaign_performance` already hits ClickHouse (`read-performance.ts`). Option 3: Hermes profiles also connect to Google Ads MCP (`:8766`) but **only** its three read tools — never Ads write tools / never `propose_change` (domain writes only via context-MCP `create_proposal`).

**Tech Stack:** TypeScript, Next.js route handlers, Vitest, existing `mintTaskToken`, ClickHouse HTTP (`AGENT_CLICKHOUSE_*`), Hermes profiles + MCP, skill markdown.

**Specs (authoritative):**
- [`docs/superpowers/specs/2026-08-13-s14-performance-campaign-agents-design.md`](../specs/2026-08-13-s14-performance-campaign-agents-design.md)
- [`docs/superpowers/specs/2026-08-12-agent-topology-design.md`](../specs/2026-08-12-agent-topology-design.md) §4, §10 Stage 4
- [`docs/superpowers/specs/2026-08-12-build-sequence.md`](../specs/2026-08-12-build-sequence.md) S14 gate
- Patterns: S10 design + S12 plan/runbook

**Torbit hubs (GentleSpace_Web):**
- Profiles/mint: `ads-agent/lib/agent/{profiles,leads-tools,orchestrator-tools}.ts`, `ads-agent/app/api/internal/agent/task-token/route.ts`
- CH path: `ads-agent/mcp/context-server/read-performance.ts`
- Wake: `ads-agent/scripts/wake-{leads,orchestrator}-agent.ts`
- Ads MCP: `ads-agent/mcp/google-ads-server/index.ts` (reads: `list_campaign_performance`, `search_terms_report`, `list_accessible_customers`; writes exist — **do not** enable for S14 profiles)
- Skills: `docs/superpowers/hermes-skills/ads-agent/`

## Decisions locked in this plan

| ID | Decision |
|---|---|
| **S14-D1** | Both profiles this cycle (`performance` + `campaign`). |
| **S14-D2** | Kinds: `performance` → `campaign.pause` only; `campaign` → `campaign.create` \| `campaign.budget_change` only. |
| **S14-D3** | Gate = **live Hermes two-profile E2E** vs local Docker ClickHouse (operator-run); CI ships unit/replica harness. |
| **S14-D4** | Both mint allowlists include `get_campaign_performance`. |
| **S14-D5** | Option 3: thin Hermes + Google Ads MCP **read-only** enrichment. |
| **S14-D6** | No new Postgres migrations. |
| **S14-D7** | Ads MCP write tools (`create_campaign`, `pause_campaign`, `update_campaign_budget`, `add_negative_keyword`, `propose_change`) are **forbidden** on S14 Hermes profiles — configure `tools.include` / skill bans. Domain mutate = context-MCP `create_proposal` only. |
| **S14-D8** | No new npm dependencies. Prefer Torbit over grep. |

## Global Constraints

- No new npm dependencies.
- Never log raw task tokens or SHA-256 digests.
- Mint must not accept client-supplied `toolAllowlist`.
- Tenant only from mint `orgId` → token → RLS / CH `SQL_current_tenant_id`.
- Agents must **not** fall back to Postgres `performance_snapshots` for analytical scans.
- Create/budget already refuse on stale CDC lag (`STALE_LAG_SECONDS` in `create-proposal.ts`); do not weaken.
- Tests: Vitest colocated `*.test.ts`. Prefer `composer-2.5-fast` for mechanical TDD; `inherit` for mint/security/gate.
- Symlink `ads-agent/node_modules` → main when using worktrees (do not nest a directory).

## Skills catalog shortlist (use these — do not invent others)

| Skill path | Role in S14 |
|---|---|
| `superpowers:using-git-worktrees` | **Required** for every parallel implementation agent |
| `superpowers:test-driven-development` | **Required** for every code task |
| `superpowers:subagent-driven-development` | Orchestrator / SDD runner |
| `superpowers:dispatching-parallel-agents` | Wave fan-out (W1/W3) |
| `superpowers:requesting-code-review` | Spec + quality review after each task |
| `superpowers:verification-before-completion` | Gate + finish |
| `superpowers:systematic-debugging` | Only if stuck |
| `superpowers:finishing-a-development-branch` | Merge / cleanup after gate |
| `~/.cursor/skills/engineering-skills/senior-backend/SKILL.md` | Allowlists, wake scripts, mint |
| `~/.cursor/skills/engineering-skills/ai-security/SKILL.md` | Mint / Ads write-tool ban / tenant |
| `~/.cursor/skills/engineering-skills/senior-prompt-engineer/SKILL.md` | Hermes skills |
| `~/.cursor/skills/engineering-skills/senior-qa/SKILL.md` | Gate harness + runbook |
| `~/.cursor/skills/engineering-skills/adversarial-reviewer/SKILL.md` | Final gate review |
| `docs/superpowers/hermes-skills/ads-agent/verification-before-proposing/SKILL.md` | Referenced by new Hermes skills |

Process skills apply to **every** task. Domain skills listed per task below.

## File map

| Path | Responsibility |
|---|---|
| `ads-agent/lib/agent/performance-tools.ts` | `PERFORMANCE_*` allowlist + TTL + assert |
| `ads-agent/lib/agent/campaign-tools.ts` | `CAMPAIGN_*` allowlist + TTL + assert |
| `ads-agent/lib/agent/google-ads-read-tools.ts` | Constant list of Ads MCP **read** tool names for skills/docs/tests |
| `ads-agent/lib/agent/proposal-kinds.ts` | `PERFORMANCE_PROPOSAL_KINDS` / `CAMPAIGN_PROPOSAL_KINDS` helpers |
| `ads-agent/lib/agent/profiles.ts` | Extend `AgentProfile` union + routing |
| `ads-agent/app/api/internal/agent/task-token/route.ts` | No logic change if profiles registry covers new names (update tests) |
| `ads-agent/mcp/context-server/read-performance.test.ts` | Strengthen replica invariant (URL host = CH env) |
| `ads-agent/scripts/wake-performance-agent.ts` | Opt-in wake stub |
| `ads-agent/scripts/wake-campaign-agent.ts` | Opt-in wake stub |
| `ads-agent/lib/generative/s14-gate.test.ts` **or** `ads-agent/lib/agent/s14-gate.test.ts` | CI gate: allowlists, CH URL, kind sets, Ads read-only constant |
| `docs/superpowers/hermes-skills/ads-agent/performance-review/SKILL.md` | Hermes skill |
| `docs/superpowers/hermes-skills/ads-agent/campaign-draft/SKILL.md` | Hermes skill |
| `docs/superpowers/specs/2026-08-13-s14-performance-campaign-agents-runbook.md` | Live E2E against Docker CH + Ads |
| `ads-agent/.env.example` | `PERFORMANCE_ORG_ID`, `CAMPAIGN_ORG_ID`, CH vars reminder |
| `openmemory.md` | S14 plan row |

## Parallel execution waves

| Wave | Tasks (parallel) | Depends on | Width |
|---|---|---|---|
| **W1** | T1 performance-tools, T2 campaign-tools, T3 google-ads-read-tools, T4 proposal-kinds, T5 CH replica test strengthen | — | **5** |
| **W2** | T6 profiles registry + mint tests | T1, T2 | **1** |
| **W3** | T7 performance skill, T8 campaign skill, T9 wake-performance, T10 wake-campaign | T1–T4, T6 (skills need profile names; wakes need T6) | **4** |
| **W4** | T11 s14-gate Vitest, T12 runbook + env + openmemory | T5–T10 | **2** |

Peak parallel width: **5** (honest). Ceiling **8** — do not invent fake parallel work; if capacity free in W3, start T11 early once T1–T6 land.

| Task | Recommended model | Domain skills |
|---|---|---|
| 1–5, 9–10 | `composer-2.5-fast` | senior-backend + tdd |
| 6 | `inherit` | senior-backend + ai-security |
| 7–8 | `composer-2.5-fast` | senior-prompt-engineer |
| 11–12 | `inherit` | senior-qa + ai-security + adversarial-reviewer |

---

### Task 1: `performance-tools` allowlist

**Files:**
- Create: `ads-agent/lib/agent/performance-tools.ts`
- Create: `ads-agent/lib/agent/performance-tools.test.ts`

**Skills:** `superpowers:test-driven-development`, `~/.cursor/skills/engineering-skills/senior-backend/SKILL.md`

**Interfaces:**
- Produces:
  - `PERFORMANCE_PROFILE = "performance"`
  - `PERFORMANCE_TOOL_ALLOWLIST` (readonly string[]) including at least:
    `get_campaign_performance`, `get_context_pack`, `list_proposals`, `graph_query`, `create_proposal`
  - `PERFORMANCE_TOKEN_TTL_DEFAULT = 900`, `PERFORMANCE_TOKEN_TTL_MAX = 3600`
  - `clampPerformanceTtl(seconds: number | undefined): number`
  - `assertPerformanceProfile(profile: string): void` throws `forbidden_profile`

- [ ] **Step 1: Failing test**

```ts
import { describe, expect, it } from "vitest";
import {
  PERFORMANCE_TOOL_ALLOWLIST,
  clampPerformanceTtl,
  assertPerformanceProfile,
} from "./performance-tools";

it("includes get_campaign_performance and create_proposal", () => {
  expect(PERFORMANCE_TOOL_ALLOWLIST).toContain("get_campaign_performance");
  expect(PERFORMANCE_TOOL_ALLOWLIST).toContain("create_proposal");
});

it("clamps ttl", () => {
  expect(clampPerformanceTtl(99999)).toBe(3600);
  expect(clampPerformanceTtl(undefined)).toBe(900);
});

it("assertPerformanceProfile rejects others", () => {
  expect(() => assertPerformanceProfile("leads")).toThrow("forbidden_profile");
});
```

- [ ] **Step 2: Implement module** (mirror `orchestrator-tools.ts` shape)
- [ ] **Step 3: Vitest PASS** — `npx vitest run lib/agent/performance-tools.test.ts`
- [ ] **Step 4: Commit** `feat(s14): performance agent tool allowlist`

---

### Task 2: `campaign-tools` allowlist

**Files:**
- Create: `ads-agent/lib/agent/campaign-tools.ts`
- Create: `ads-agent/lib/agent/campaign-tools.test.ts`

**Skills:** `superpowers:test-driven-development`, `~/.cursor/skills/engineering-skills/senior-backend/SKILL.md`

**Interfaces:**
- Produces: same shape as Task 1 with `CAMPAIGN_PROFILE = "campaign"`
- Allowlist must include: `get_campaign_performance`, `get_context_pack`, `list_proposals`, `graph_query`, `create_proposal`, plus `search_spaces`, `get_space` for corridor drafting

- [ ] **Step 1: Failing tests** (mirror Task 1; assert spaces tools present)
- [ ] **Step 2: Implement**
- [ ] **Step 3: Vitest PASS**
- [ ] **Step 4: Commit** `feat(s14): campaign agent tool allowlist`

---

### Task 3: Google Ads MCP read-only tool constant

**Files:**
- Create: `ads-agent/lib/agent/google-ads-read-tools.ts`
- Create: `ads-agent/lib/agent/google-ads-read-tools.test.ts`

**Skills:** `superpowers:test-driven-development`, `~/.cursor/skills/engineering-skills/ai-security/SKILL.md`

**Interfaces:**
- Produces:
  - `GOOGLE_ADS_MCP_READ_TOOLS = ["list_campaign_performance","search_terms_report","list_accessible_customers"] as const`
  - `GOOGLE_ADS_MCP_WRITE_TOOLS` = the five write/propose tool names from `mcp/google-ads-server/index.ts`
  - `assertGoogleAdsReadOnlyTool(name: string): void` throws if name is in write set

- [ ] **Step 1: Failing test** — read set has exactly 3; write set includes `propose_change` and `pause_campaign`; `assertGoogleAdsReadOnlyTool("pause_campaign")` throws
- [ ] **Step 2: Implement**
- [ ] **Step 3: Vitest PASS**
- [ ] **Step 4: Commit** `feat(s14): google ads MCP read-only tool inventory`

---

### Task 4: Proposal kind helpers

**Files:**
- Create: `ads-agent/lib/agent/proposal-kinds.ts`
- Create: `ads-agent/lib/agent/proposal-kinds.test.ts`

**Skills:** `superpowers:test-driven-development`, `~/.cursor/skills/engineering-skills/senior-backend/SKILL.md`

**Interfaces:**
- Produces:
  - `PERFORMANCE_PROPOSAL_KINDS = ["campaign.pause"] as const`
  - `CAMPAIGN_PROPOSAL_KINDS = ["campaign.create","campaign.budget_change"] as const`
  - `isAllowedProposalKind(profile: "performance"|"campaign", kind: string): boolean`

- [ ] **Step 1: Failing tests** — performance accepts pause only; campaign accepts create/budget only; cross rejects
- [ ] **Step 2: Implement**
- [ ] **Step 3: Vitest PASS**
- [ ] **Step 4: Commit** `feat(s14): profile proposal kind allowlists`

---

### Task 5: Strengthen ClickHouse replica invariant tests

**Files:**
- Modify: `ads-agent/mcp/context-server/read-performance.test.ts`

**Skills:** `superpowers:test-driven-development`, `~/.cursor/skills/engineering-skills/ai-security/SKILL.md`

**Interfaces:**
- Consumes: existing `getCampaignPerformance` / `resolveClickHouseUrl`
- Produces: additional assertions that fetch URL starts with `process.env.AGENT_CLICKHOUSE_URL` and body SQL references `campaign_performance_daily` (CH table), never `performance_snapshots`

- [ ] **Step 1: Add failing/new tests**

```ts
it("fetches only AGENT_CLICKHOUSE_URL (replica), never a postgres-looking host", async () => {
  await getCampaignPerformance(CLAIMS, { windowDays: 7 });
  const url = String(fetchMock.mock.calls[0][0]);
  expect(url.startsWith("http://clickhouse:8123")).toBe(true);
  expect(url).not.toMatch(/5432|5433|5434/);
});

it("SQL body targets campaign_performance_daily, not performance_snapshots", async () => {
  await getCampaignPerformance(CLAIMS, { windowDays: 7 });
  const body = String(fetchMock.mock.calls[0][1].body);
  expect(body).toContain("campaign_performance_daily");
  expect(body).not.toContain("performance_snapshots");
});
```

- [ ] **Step 2: Ensure implementation already satisfies (no production change unless tests reveal a bug)**
- [ ] **Step 3: Vitest PASS** — `npx vitest run mcp/context-server/read-performance.test.ts`
- [ ] **Step 4: Commit** `test(s14): assert performance reads ClickHouse replica only`

---

### Task 6: Extend `profiles.ts` + mint tests

**Files:**
- Modify: `ads-agent/lib/agent/profiles.ts`
- Modify: `ads-agent/lib/agent/profiles.test.ts`
- Modify: `ads-agent/app/api/internal/agent/task-token/route.test.ts` (add cases for new profiles)

**Skills:** `superpowers:test-driven-development`, `~/.cursor/skills/engineering-skills/senior-backend/SKILL.md`, `~/.cursor/skills/engineering-skills/ai-security/SKILL.md`

**Interfaces:**
- Consumes: Task 1–2 exports
- Produces: `AgentProfile = "leads" | "orchestrator" | "performance" | "campaign"`; `isAgentProfile` / `allowlistFor` / `clampTtlFor` route correctly
- Note: existing `profiles.test.ts` currently expects `isAgentProfile("campaign") === false` — **flip** that assertion

- [ ] **Step 1: Update failing expectations first**
- [ ] **Step 2: Wire imports + switch/map in `profiles.ts`**
- [ ] **Step 3: Mint route tests** — POST with `profile: "performance"` returns 200 path (mock mint); unknown still 403; allowlist used is server-owned
- [ ] **Step 4: Vitest PASS** for profiles + route tests
- [ ] **Step 5: Commit** `feat(s14): mint performance and campaign profiles`

---

### Task 7: Hermes skill `performance-review`

**Files:**
- Create: `docs/superpowers/hermes-skills/ads-agent/performance-review/SKILL.md`

**Skills:** `~/.cursor/skills/engineering-skills/senior-prompt-engineer/SKILL.md`

**Interfaces:**
- Consumes: PERFORMANCE allowlist names, `GOOGLE_ADS_MCP_READ_TOOLS`, `PERFORMANCE_PROPOSAL_KINDS`
- Mirror structure of `leads-enquiry-triage/SKILL.md`

Required skill content:
1. Mint with `profile: "performance"`, org from `PERFORMANCE_ORG_ID`
2. **Required:** `get_campaign_performance` via context-MCP before any proposal
3. Optional: Ads MCP reads from `GOOGLE_ADS_MCP_READ_TOOLS` only — list write tools as **never call**
4. `get_context_pack` for campaign entity when pausing a specific campaign
5. `create_proposal` kind **only** `campaign.pause`; evidence = pack IDs
6. Related skill: `verification-before-proposing`

- [ ] **Step 1: Write SKILL.md**
- [ ] **Step 2: Commit** `docs(s14): performance-review Hermes skill`

---

### Task 8: Hermes skill `campaign-draft`

**Files:**
- Create: `docs/superpowers/hermes-skills/ads-agent/campaign-draft/SKILL.md`

**Skills:** `~/.cursor/skills/engineering-skills/senior-prompt-engineer/SKILL.md`

Required skill content:
1. Mint `profile: "campaign"`, org `CAMPAIGN_ORG_ID`
2. **Required:** `get_campaign_performance` before propose
3. Optional Ads MCP reads only (same ban list as Task 7)
4. Spaces tools allowed for corridor drafting
5. `create_proposal` kinds **only** `campaign.create` | `campaign.budget_change`
6. Document stale refuse: if tool returns `stale_data_refusal`, stop and report — do not invent numbers
7. Related: `verification-before-proposing`, optional cross-link existing `ads-agent-campaign-strategy` as reference only (do not call Ads write tools)

- [ ] **Step 1: Write SKILL.md**
- [ ] **Step 2: Commit** `docs(s14): campaign-draft Hermes skill`

---

### Task 9: Wake stub — performance

**Files:**
- Create: `ads-agent/scripts/wake-performance-agent.ts`
- Create: `ads-agent/scripts/wake-performance-agent.test.ts`

**Skills:** `superpowers:test-driven-development`, `~/.cursor/skills/engineering-skills/senior-backend/SKILL.md`

**Interfaces:** Mirror `wake-leads-agent.ts`:
- `parseWakeArgs` requires `--org-id=<uuid>`; optional `--corridor=`
- `main`: if `HERMES_WAKE !== "1"` log not scheduled exit 0; else log stub wake

- [ ] **Step 1: Failing tests for parse + HERMES_WAKE gate**
- [ ] **Step 2: Implement**
- [ ] **Step 3: Vitest PASS**
- [ ] **Step 4: Commit** `feat(s14): wake-performance-agent stub`

---

### Task 10: Wake stub — campaign

**Files:**
- Create: `ads-agent/scripts/wake-campaign-agent.ts`
- Create: `ads-agent/scripts/wake-campaign-agent.test.ts`

**Skills:** same as Task 9

- [ ] **Step 1–4:** Same pattern as Task 9 with campaign naming; optional `--corridor=`
- [ ] **Commit** `feat(s14): wake-campaign-agent stub`

---

### Task 11: CI gate harness `s14-gate.test.ts`

**Files:**
- Create: `ads-agent/lib/agent/s14-gate.test.ts`

**Skills:** `superpowers:test-driven-development`, `~/.cursor/skills/engineering-skills/senior-qa/SKILL.md`, `~/.cursor/skills/engineering-skills/ai-security/SKILL.md`

**Gate assertions (all in one file):**
1. `allowlistFor("performance")` includes `get_campaign_performance`, excludes enquiry tools if not needed
2. `allowlistFor("campaign")` includes `get_campaign_performance` + spaces tools
3. `isAllowedProposalKind` matrix from Task 4
4. `GOOGLE_ADS_MCP_READ_TOOLS` ∩ write tools = empty; write tools include `propose_change`
5. Import `PERFORMANCE_SQL` or re-call `getCampaignPerformance` with fetch mock — URL uses `AGENT_CLICKHOUSE_URL` (reuse Task 5 pattern inline)

- [ ] **Step 1: Write gate tests**
- [ ] **Step 2: `npx vitest run lib/agent/s14-gate.test.ts` PASS**
- [ ] **Step 3: Commit** `test(s14): performance/campaign agents gate`

---

### Task 12: Runbook + env + openmemory

**Files:**
- Create: `docs/superpowers/specs/2026-08-13-s14-performance-campaign-agents-runbook.md`
- Modify: `ads-agent/.env.example` (add `PERFORMANCE_ORG_ID`, `CAMPAIGN_ORG_ID`; remind `AGENT_CLICKHOUSE_URL`)
- Modify: `openmemory.md` — mark S14 plan IMPLEMENTED-pending-E2E / plan path

**Skills:** `~/.cursor/skills/engineering-skills/senior-qa/SKILL.md`, `superpowers:verification-before-completion`

Runbook must include:
1. Prerequisites: Docker ClickHouse up; context-mcp with `AGENT_CLICKHOUSE_*`; Hermes; optional Google Ads MCP
2. Seed note: ensure ClickHouse has rows in `campaign_performance_daily` for the test tenant — prefer running existing CDC replicate (`scripts/clickhouse/replicate.ts` / `lib/clickhouse/replicate.ts`) against a tenant that already has Postgres campaign snapshots; if still empty, runbook documents a minimal `INSERT` into `campaign_performance_daily` with `SQL_current_tenant_id` set to the test org (do not invent a second seed framework).
3. Hermes profile setup: `tools.include` = context-mcp tools needed + **only** `GOOGLE_ADS_MCP_READ_TOOLS`
4. Manual E2E steps: wake performance → pending `campaign.pause`; wake campaign → pending create or budget_change; verify admin `/proposals`
5. PASS criteria matching design §Acceptance gate
6. Explicit: Ads down → CH-only still satisfies replica items; Ads up → exercise one read tool

- [ ] **Step 1: Write runbook + env stubs (no secrets)**
- [ ] **Step 2: Update openmemory.md**
- [ ] **Step 3: Commit** `docs(s14): performance/campaign runbook and env stubs`

---

## Spec coverage checklist

| Spec requirement | Task |
|---|---|
| Both profiles | T1, T2, T6 |
| Proposal kinds | T4, T7, T8, T11 |
| Both get `get_campaign_performance` | T1, T2, T11 |
| ClickHouse not primary | T5, T11, T12 |
| Live Hermes E2E gate | T12 (operator) |
| Option 3 Ads enrich read-only | T3, T7, T8, T12 |
| Wake stubs | T9, T10 |
| No new PG migrations | Global |
| Human approval only | Skills + runbook |

## Out of scope (do not implement in S14 tasks)

- Meta Ads MCP
- Enabling Ads write tools on Hermes profiles
- Orchestrator auto Kanban link performance→campaign (optional later)
- Server-side profile→kind lock in `create_proposal` (deferred per design)
- `research` / `content` / CMS

## Execution handoff

After saving this plan, offer:

1. **Subagent-Driven (recommended)** — Composer 2.5 for mechanical tasks; peak width 5 (ceiling 8)  
2. **Inline Execution**

**Which approach?**
