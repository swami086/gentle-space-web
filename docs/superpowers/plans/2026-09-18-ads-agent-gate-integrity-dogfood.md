# Ads-agent Gate Integrity + Campaign Dogfood Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:dispatching-parallel-agents` for Wave 1–2, then `superpowers:subagent-driven-development` (or `executing-plans`) for merge/integration. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Parallel model:** Dispatch each Wave-N task agent with **`composer-2.5-fast`** (`model: composer-2.5-fast`). Agents must **not** share writable files (see ownership table). After each wave, the coordinator merges and runs the wave gate tests before starting the next wave.

**Goal:** Close the MCP write-bypass hole, make approve/preflight honest, and make Google Search campaign create dogfoodable (Bifrost or Hermes → ready including `finalUrl` → proposal → approve → worker → test account).

**Architecture:** Dual Google Ads MCP surfaces (`read` on `:8766`, `write` on `:8769`) from one server binary; host connector selects URL by tool class; preflight probes read MCP; draft readiness requires `finalUrl`; Hermes campaign chat persists SetupCard fields like Bifrost chat.

**Tech Stack:** ads-agent Next.js 15, Vitest, Docker Compose, `@modelcontextprotocol/client` + server, Google Ads MCP in-repo (`mcp/google-ads-server`), Bifrost/Vertex (unchanged).

## Global Constraints

- Do **not** weaken the human approval gate; do **not** auto-execute Ads writes from chat/Hermes.
- Meta create remains out of scope; leave Meta connector as-is.
- Do **not** invent OAuth tokens; if live smoke hits `invalid_grant`, document blocker and still ship code/tests.
- Prefer smallest diffs; no new npm dependencies.
- Database remains consolidated `localhost:5433` / `gentle_space_listings` / `adsagent` schema.
- Every task: TDD where logic exists; run the listed vitest files before claiming done.
- **Commit only if the user/coordinator explicitly requests** (repo user rule). Stage locally; do not push.

---

## Parallel execution guide (Composer 2.5)

### File ownership (hard locks)

| Agent ID | Owns (write) | Must not touch |
|----------|--------------|----------------|
| **A-MCP** | `ads-agent/mcp/google-ads-server/**`, `ads-agent/scripts/run-google-ads-mcp.ts`, Compose service defs for MCP in `ads-agent/docker-compose.yml` | `lib/bifrost/*`, UI, draft-rules |
| **B-Draft** | `ads-agent/lib/decision-engine/campaign-draft-rules.ts`, `*.test.ts` sibling | MCP server, approve route |
| **C-UI** | `ads-agent/app/(admin)/proposals/[id]/ProposalActions.tsx`, `page.tsx` (copy/feedback only) | MCP, preflight |
| **D-Health** | `ads-agent/lib/env-status.ts`, `ads-agent/lib/env-status.test.ts`, new `ads-agent/lib/connectors/google-ads-health.ts` (+ test) | MCP registerTool lists |
| **E-Connector** | `ads-agent/lib/bifrost/google-ads-mcp-tools.ts`, `google-ads-mcp-client.ts` (+ tests), `ads-agent/lib/connectors/google-ads.ts` (+ tests), `ads-agent/.env.example` | MCP `index.ts` tool registration (consume A’s surface API only) |
| **F-Preflight** | `ads-agent/lib/decision-engine/preflight.ts`, `preflight.test.ts`, `ads-agent/app/api/proposals/[id]/approve/route.ts` (+ test) | MCP server files |
| **G-Hermes** | `ads-agent/components/CampaignDraftChat.tsx`, Hermes campaign persistence path under `ads-agent/lib/hermes/**` and/or `ads-agent/app/api/hermes/**` / `campaign-drafts` as needed | MCP write surface |
| **H-Integrate** | README smoke section, optional `scripts/smoke-google-ads-surfaces.mts`, wave gate script | Prefer read-only fixes; may touch `.env.example` comments only if E done |

### Skills each agent must load first

**Catalog roots (Cursor global):**
- Superpowers: `~/.cursor/plugins/cache/cursor-public/superpowers/*/skills/<name>/SKILL.md`
- Domain skills: `~/.cursor/skills/<name>/SKILL.md`

| Agent | Skills (read full SKILL.md before coding) | Why |
|-------|-------------------------------------------|-----|
| **All** | `using-superpowers`; OpenMemory `search_memory` (project `swami086/gentle-space-web`); Sourcegraph MCP as needed | Process + project facts |
| **Coordinator** | `dispatching-parallel-agents`, `subagent-driven-development`, `writing-plans` (verify only) | Wave dispatch + merge gates |
| **A-MCP** | `architect-reviewer`, `code-reviewer`, `api-design-reviewer` | Surface boundary / tool registration |
| **B-Draft** | `code-reviewer`, `adversarial-reviewer` | Fail-closed readiness rules |
| **C-UI** | `code-reviewer` | Minimal copy/feedback; no redesign |
| **D-Health** | `code-reviewer`, `adversarial-reviewer`, `chaos-engineer` (probe timeout mindset) | Fail-closed reachability |
| **E-Connector** | `architect-reviewer`, `code-reviewer`, `api-designer` | Dual URL client contract |
| **F-Preflight** | `adversarial-reviewer`, `code-reviewer`, `architect-reviewer` | Approve must block when MCP down |
| **G-Hermes** | `code-reviewer`, `backend-developer`; Sourcegraph for Hermes campaign contract | Persist SetupCard like Bifrost |
| **H-Integrate** | `code-reviewer`, `verification-before-completion` (if present) | Smoke + README + dogfood checklist |

Each Composer 2.5 subagent prompt **must** open with: “Load these skills first: …” listing the table row paths.

### Wave graph

```text
Wave 1 (parallel): A-MCP | B-Draft | C-UI | D-Health
        ↓
Wave 2 (parallel, after Wave 1 merged): E-Connector | F-Preflight
        ↓
Wave 3: G-Hermes
        ↓
Wave 4: H-Integrate + live dogfood checklist
```

Coordinator prompt for each subagent must include: **spec path**, **this plan task section only**, **ownership table**, **Interfaces** block, **model composer-2.5-fast**.

---

## File structure (target)

| Path | Responsibility |
|------|----------------|
| `mcp/google-ads-server/index.ts` | `GoogleAdsMcpSurface`, register tools by surface |
| `mcp/google-ads-server/surface.ts` (new, optional) | Pure helpers: `toolsForSurface`, parse env |
| `lib/bifrost/google-ads-mcp-tools.ts` | `GOOGLE_ADS_MCP_URL`, `GOOGLE_ADS_MCP_WRITE_URL`, tool name consts |
| `lib/bifrost/google-ads-mcp-client.ts` | `callGoogleAdsTool(name, args, { surface })` |
| `lib/connectors/google-ads-health.ts` | `probeGoogleAdsReadMcp(): Promise<{ ok, error? }>` |
| `lib/connectors/google-ads.ts` | Writes use `surface: "write"` |
| `lib/decision-engine/campaign-draft-rules.ts` | `finalUrl` in `isDraftReady` |
| `lib/decision-engine/preflight.ts` | Block on unreachable Google when kind needs Google |
| `lib/env-status.ts` | Keep configured booleans; health is separate probe |
| `docker-compose.yml` | `google-ads-mcp` + `google-ads-mcp-write` |
| Proposal UI | Post-approve scheduled messaging |

---

### Task 1 — A-MCP: Dual surface registration

**Wave:** 1 · **Agent:** A-MCP · **Model:** `composer-2.5-fast`

**Files:**
- Modify: `ads-agent/mcp/google-ads-server/index.ts`
- Create (optional): `ads-agent/mcp/google-ads-server/surface.ts`
- Modify: `ads-agent/mcp/google-ads-server/index.test.ts`
- Modify: `ads-agent/scripts/run-google-ads-mcp.ts` (pass surface from env)
- Modify: `ads-agent/docker-compose.yml` (second service)

**Interfaces:**
- Produces: `export type GoogleAdsMcpSurface = "read" | "write"`; `export function resolveGoogleAdsMcpSurface(env?: NodeJS.ProcessEnv): GoogleAdsMcpSurface` — default **`"read"`** if unset/invalid; `buildGoogleAdsMcpServer(surface?: GoogleAdsMcpSurface)`
- Read surface tools: exactly `list_campaign_performance`, `search_terms_report`, `list_accessible_customers`
- Write surface tools: exactly `create_campaign`, `pause_campaign`, `update_campaign_budget`, `add_negative_keyword`, `propose_change`
- Compose write service: host/container port **8769** (`8769:8769` per design), env `GOOGLE_ADS_MCP_SURFACE=write`, `GOOGLE_ADS_MCP_PORT=8769`, `GOOGLE_ADS_MCP_BIND=0.0.0.0`, same allowlist pattern as read

- [ ] **Step 1: Failing test — read surface omits writes**

```typescript
import { describe, it, expect, vi } from "vitest";
// After exporting a test helper that lists registered tool names from buildGoogleAdsMcpServer:
it("read surface does not register create_campaign", async () => {
  const names = await registeredToolNames("read");
  expect(names).toEqual([
    "list_campaign_performance",
    "search_terms_report",
    "list_accessible_customers",
  ]);
  expect(names).not.toContain("create_campaign");
});

it("write surface registers mutate tools and not list_campaign_performance", async () => {
  const names = await registeredToolNames("write");
  expect(names).toContain("create_campaign");
  expect(names).not.toContain("list_campaign_performance");
});
```

(Adapt to existing in-memory MCP test style in `index.test.ts` — prefer extending that file’s patterns.)

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd ads-agent && npx vitest run mcp/google-ads-server/index.test.ts
```

- [ ] **Step 3: Implement surface split**

```typescript
export type GoogleAdsMcpSurface = "read" | "write";

export function resolveGoogleAdsMcpSurface(env: NodeJS.ProcessEnv = process.env): GoogleAdsMcpSurface {
  return env.GOOGLE_ADS_MCP_SURFACE === "write" ? "write" : "read";
}

export function buildGoogleAdsMcpServer(surface: GoogleAdsMcpSurface = resolveGoogleAdsMcpSurface()): McpServer {
  const server = new McpServer({ name: "google-ads-mcp", version: "1.0.0" });
  if (surface === "read") {
    // register 3 read tools only
  } else {
    // register 4 mutate + propose_change only
  }
  return server;
}
```

Update `startGoogleAdsMcpServer` to use resolved surface. Compose:

```yaml
  google-ads-mcp-write:
    build: .
    command: ["npx", "tsx", "scripts/run-google-ads-mcp.ts"]
    env_file: [.env.local]
    environment:
      GOOGLE_ADS_MCP_SURFACE: write
      GOOGLE_ADS_MCP_BIND: "0.0.0.0"
      GOOGLE_ADS_MCP_ALLOWED_HOSTS: localhost,127.0.0.1,google-ads-mcp-write,host.docker.internal
      DATABASE_URL: postgres://ads_agent:ads_agent_local_dev@db:5432/ads_agent
    ports:
      - "8769:8769"
```

Script must honor `GOOGLE_ADS_MCP_PORT` (default `8766` for read service). Write service sets `GOOGLE_ADS_MCP_PORT=8769` so Compose maps `8769:8769` as in the design.

- [ ] **Step 4: Tests PASS**

```bash
cd ads-agent && npx vitest run mcp/google-ads-server/index.test.ts
```

- [ ] **Step 5: Stop — do not commit unless coordinator asks**

---

### Task 2 — B-Draft: `finalUrl` required for ready

**Wave:** 1 · **Agent:** B-Draft · **Model:** `composer-2.5-fast`

**Files:**
- Modify: `ads-agent/lib/decision-engine/campaign-draft-rules.ts`
- Modify: `ads-agent/lib/decision-engine/campaign-draft-rules.test.ts`

**Interfaces:**
- Produces: `isDraftReady` returns false when `finalUrl` missing/blank/non-http(s); `validateDraftFields` may push `finalUrl: ...` errors

- [ ] **Step 1: Failing tests**

```typescript
it("is false when finalUrl is missing", () => {
  expect(isDraftReady(draft({ finalUrl: "" }))).toBe(false);
});

it("is false when finalUrl is not http(s)", () => {
  expect(isDraftReady(draft({ finalUrl: "javascript:alert(1)" }))).toBe(false);
});

it("validateDraftFields rejects blank finalUrl when provided", () => {
  expect(validateDraftFields({ finalUrl: "  " }).some((e) => e.includes("finalUrl"))).toBe(true);
});
```

- [ ] **Step 2: Run — FAIL**

```bash
cd ads-agent && npx vitest run lib/decision-engine/campaign-draft-rules.test.ts
```

- [ ] **Step 3: Implement**

```typescript
function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

// in isDraftReady, after other checks:
if (!draft.finalUrl?.trim() || !isHttpUrl(draft.finalUrl.trim())) return false;
```

Also validate in `validateDraftFields` when `fields.finalUrl !== undefined`.

- [ ] **Step 4: PASS**

```bash
cd ads-agent && npx vitest run lib/decision-engine/campaign-draft-rules.test.ts
```

---

### Task 3 — C-UI: Approve → scheduled feedback

**Wave:** 1 · **Agent:** C-UI · **Model:** `composer-2.5-fast`

**Files:**
- Modify: `ads-agent/app/(admin)/proposals/[id]/ProposalActions.tsx`
- Modify: `ads-agent/app/(admin)/proposals/[id]/page.tsx` (only if needed for banner)

**Interfaces:**
- Consumes: existing approve JSON `{ ok, proposal: { status, undoUntil, ... } }`
- Produces: user-visible success/error from response; never silent discard

- [ ] **Step 1: Read current approve handler in `ProposalActions.tsx`**

- [ ] **Step 2: Ensure approve path**

```typescript
const res = await fetch(`/api/proposals/${id}/approve`, { method: "POST" });
const body = await res.json().catch(() => ({}));
if (!res.ok) {
  setError(body.error ?? body.preflight ? "Preflight failed" : "Approve failed");
  // if preflight present, surface first blocking check message
  return;
}
setInfo(
  `Scheduled. Status is "${body.proposal?.status ?? "scheduled"}". ` +
    `It executes after the undo window while worker:proposals is running.`,
);
router.refresh();
```

- [ ] **Step 3: Manual check** — open a pending proposal page; no unit test required if component is client-only without harness; optional lightweight test if project already tests this component.

- [ ] **Step 4: Stop**

---

### Task 4 — D-Health: Read-MCP probe helper

**Wave:** 1 · **Agent:** D-Health · **Model:** `composer-2.5-fast`

**Files:**
- Create: `ads-agent/lib/connectors/google-ads-health.ts`
- Create: `ads-agent/lib/connectors/google-ads-health.test.ts`
- Modify: `ads-agent/lib/env-status.ts` / test only if adding a sync flag — prefer **async probe separate** from `getConnectorStatus()`

**Interfaces:**
- Produces:

```typescript
export type GoogleAdsHealth = {
  configured: boolean;
  reachable: boolean;
  error?: string;
};

export async function probeGoogleAdsReadMcp(
  opts?: { timeoutMs?: number },
): Promise<GoogleAdsHealth>;
```

- Uses **read** URL only (`GOOGLE_ADS_MCP_URL`). Implementation may call `listGoogleAdsTools()` from bifrost client **or** a fetch with AbortSignal — if importing client creates circular deps, use dynamic import or duplicate minimal listTools call.
- `configured` mirrors env-status googleAds boolean (inline same checks to avoid coupling, or import `getConnectorStatus().googleAds`).

- [ ] **Step 1: Failing test with mocked client**

```typescript
it("reachable false when listTools throws", async () => {
  // mock listGoogleAdsTools to reject
  const h = await probeGoogleAdsReadMcp({ timeoutMs: 50 });
  expect(h.reachable).toBe(false);
  expect(h.error).toBeTruthy();
});
```

- [ ] **Step 2–4: Implement + PASS**

```bash
cd ads-agent && npx vitest run lib/connectors/google-ads-health.test.ts
```

---

## Wave 1 gate (coordinator)

```bash
cd ads-agent && npx vitest run \
  mcp/google-ads-server/index.test.ts \
  lib/decision-engine/campaign-draft-rules.test.ts \
  lib/connectors/google-ads-health.test.ts
```

Merge all Wave 1 branches/worktrees. Then start Wave 2.

---

### Task 5 — E-Connector: Dual URL client

**Wave:** 2 · **Agent:** E-Connector · **Model:** `composer-2.5-fast`  
**Depends on:** A-MCP merged (surface contract stable)

**Files:**
- Modify: `ads-agent/lib/bifrost/google-ads-mcp-tools.ts`
- Modify: `ads-agent/lib/bifrost/google-ads-mcp-client.ts` + `.test.ts`
- Modify: `ads-agent/lib/connectors/google-ads.ts` + `.test.ts`
- Modify: `ads-agent/.env.example`

**Interfaces:**
- Produces: `GOOGLE_ADS_MCP_WRITE_URL` default `http://localhost:8769/mcp`
- `callGoogleAdsTool(name, args, opts?: { surface?: "read" | "write" })`
- Write tool names always use write URL; read tools use read URL; calling a write name with `surface: "read"` throws before network

```typescript
const WRITE_NAMES = new Set([
  "create_campaign",
  "pause_campaign",
  "update_campaign_budget",
  "add_negative_keyword",
  "propose_change",
]);

function urlFor(name: string, surface?: "read" | "write"): string {
  const wantWrite = surface === "write" || WRITE_NAMES.has(name);
  if (WRITE_NAMES.has(name) && surface === "read") {
    throw new Error(`refusing to call write tool "${name}" on read surface`);
  }
  return wantWrite
    ? process.env.GOOGLE_ADS_MCP_WRITE_URL || "http://localhost:8769/mcp"
    : GOOGLE_ADS_MCP_URL;
}
```

Update `withClient` to accept URL. Connector write functions: pass `{ surface: "write" }`.

- [ ] **Step 1: Tests for URL selection + refuse**
- [ ] **Step 2: FAIL then implement**
- [ ] **Step 3:**

```bash
cd ads-agent && npx vitest run lib/bifrost/google-ads-mcp-client.test.ts lib/connectors/google-ads.test.ts
```

---

### Task 6 — F-Preflight: Block on unreachable Google

**Wave:** 2 · **Agent:** F-Preflight · **Model:** `composer-2.5-fast`  
**Depends on:** D-Health merged

**Files:**
- Modify: `ads-agent/lib/decision-engine/preflight.ts` + `preflight.test.ts`
- Modify: `ads-agent/app/api/proposals/[id]/approve/route.ts` + `approve/route.test.ts`

**Interfaces:**
- Extends `PreflightInput.connectors` to:

```typescript
connectors: {
  googleAds: boolean;      // configured
  googleAdsReachable?: boolean; // optional for back-compat; treat undefined as true only in unit tests of pure rules — approve route always passes boolean
  meta: boolean;
};
```

- `checkConnectorHealth`: if platform google and `googleAdsReachable === false` → block with message `Google Ads MCP read surface unreachable`

Approve route:

```typescript
const connectors = getConnectorStatus();
const health = await probeGoogleAdsReadMcp({ timeoutMs: 2000 });
const preflight = runPreflight({
  ...
  connectors: {
    googleAds: connectors.googleAds,
    googleAdsReachable: health.configured && health.reachable,
    meta: connectors.meta,
  },
});
```

- [ ] **Step 1–4: TDD preflight + update approve mocks**

```bash
cd ads-agent && npx vitest run lib/decision-engine/preflight.test.ts app/api/proposals/\[id\]/approve/route.test.ts
```

---

## Wave 2 gate

```bash
cd ads-agent && npx vitest run \
  lib/bifrost/google-ads-mcp-client.test.ts \
  lib/connectors/google-ads.test.ts \
  lib/decision-engine/preflight.test.ts \
  app/api/proposals/\[id\]/approve/route.test.ts
```

---

### Task 7 — G-Hermes: Persist campaign draft fields

**Wave:** 3 · **Agent:** G-Hermes · **Model:** `composer-2.5-fast`  
**Depends on:** B-Draft merged (`finalUrl` rules)

**Files:**
- Modify: `ads-agent/components/CampaignDraftChat.tsx`
- Likely: `ads-agent/app/api/hermes/chat/route.ts` and/or campaign-origin handler under `lib/decision-engine/hermes-chat.ts` / `lib/hermes/*`
- Tests colocated with whichever server module owns persistence

**Requirement:** When `origin: "campaign"` (or equivalent) Hermes turn completes with a SetupCard / field updates, call the same persistence as Bifrost `/messages` (`updateDraftFields` + `setDraftStatus(isDraftReady ? "ready" : "chatting")`) and return updated draft to the client so `Create Proposal` can enable.

**Approach (pick smallest that works):**
1. Preferred: server Hermes campaign path writes draft by `draftId` query/body param.  
2. Fallback: client parses SetupCard via existing `parseSetupCardResponse` / `normalizeOpenUiResponse` and `PATCH /api/campaign-drafts/:id`.

- [ ] **Step 1: Sourcegraph / read current Hermes campaign stream contract**
- [ ] **Step 2: Failing test at persistence boundary**
- [ ] **Step 3: Implement**
- [ ] **Step 4:**

```bash
cd ads-agent && npx vitest run lib/hermes lib/decision-engine/hermes-chat.test.ts components --passWithNoTests
# run the specific new/updated test file(s) you added
```

---

### Task 8 — H-Integrate: Surfaces smoke + README

**Wave:** 4 · **Agent:** H-Integrate · **Model:** `composer-2.5-fast`

**Files:**
- Modify: `ads-agent/README.md` (Credentials / Google Ads MCP section)
- Create: `ads-agent/scripts/smoke-google-ads-surfaces.mts` (listTools on read vs write URLs; no secrets printed)

**Dogfood checklist (manual):**

1. Refresh `GOOGLE_ADS_REFRESH_TOKEN` if `invalid_grant`.  
2. Confirm test customer ID + `GOOGLE_ADS_LOGIN_CUSTOMER_ID` if MCC.  
3. `docker compose up -d bifrost google-ads-mcp google-ads-mcp-write`  
4. `npm run dev` + `npm run worker:proposals` + auth-service  
5. New Campaign → chat or manual → `ready` → Create Proposal → Approve → wait undo → confirm Google test campaign / or `failed` with error on proposal  

- [ ] **Step 1: Smoke script**

```typescript
// listTools on READ url — assert no create_campaign
// listTools on WRITE url — assert create_campaign present
```

- [ ] **Step 2: Document ports 8766 / 8769 and `GOOGLE_ADS_MCP_WRITE_URL` in README**
- [ ] **Step 3: Run unit gate**

```bash
cd ads-agent && npm test
```

---

## Final acceptance

| # | Criterion | How |
|---|-----------|-----|
| 1 | Read MCP has no write tools | smoke script + unit tests |
| 2 | Write MCP not used by Bifrost tool list | `GOOGLE_ADS_MCP_READ_TOOL_NAMES` unchanged; resolver filter intact |
| 3 | Approve uses write URL | connector tests |
| 4 | Draft needs finalUrl | draft-rules tests |
| 5 | Approve blocks if read MCP down | preflight + approve tests |
| 6 | Approve UI shows scheduled messaging | manual |
| 7 | Hermes can reach ready | manual or unit |
| 8 | Full Google test create | manual (token prerequisite) |

---

## Coordinator dispatch templates

**Wave 1 (single message, 4 parallel Task tools):**

```text
model: composer-2.5-fast
You are agent A-MCP. Load skills: using-superpowers, architect-reviewer, code-reviewer.
Read docs/superpowers/specs/2026-09-18-ads-agent-gate-integrity-dogfood-design.md
and ONLY Task 1 in docs/superpowers/plans/2026-09-18-ads-agent-gate-integrity-dogfood.md.
Honor file ownership. Use Sourcegraph MCP if needed. Do not commit unless asked.
```

(Repeat for B-Draft Task 2, C-UI Task 3, D-Health Task 4.)

---

## Self-review (plan author)

- Spec coverage: D1–D5 each have tasks (1/5, 2, 6/4, 3, 7).  
- No TBD placeholders in task interfaces.  
- Parallel file locks prevent Write conflicts.  
- OAuth refresh explicitly out of code scope.
