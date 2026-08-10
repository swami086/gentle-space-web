# Hermes Agent Bridge (ads-agent Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Containerize the Google Ads MCP server so any other container (a future Hermes deployment included) can reach it by Compose service name, add a `propose_change` MCP tool that is the *only* surface an external agent may ever call to affect `ads-agent`, add a `campaign_strategy` proposal kind for narrative recommendations, and close a silent-failure gap in the executor.

**Architecture:** `ProposalKind` gains `"campaign_strategy"` (types.ts + a widened `proposals.kind` CHECK constraint). `executeProposal`'s switch gets an explicit no-op case for it plus a `default: throw` so any future unhandled kind fails loudly instead of being marked executed having done nothing. The existing Google Ads MCP server (`mcp/google-ads-server/`) gains an 8th tool, `propose_change`, that only ever calls `createProposal()` — never a Google Ads/Meta connector — and its hardcoded `localhostHostValidation()` guard becomes a configurable `hostHeaderValidation(allowlist)` driven by a new `GOOGLE_ADS_MCP_ALLOWED_HOSTS` env var. The server is added as its own service (`google-ads-mcp`) to both Compose files, reusing the existing `ads-agent` Docker image with a `command:` override — zero new Dockerfile.

**Tech Stack:** TypeScript, `@modelcontextprotocol/server`/`node` (already installed, no new deps), Zod v4, Vitest, PostgreSQL (raw SQL via `pg`), Docker Compose.

**Related:** [`docs/superpowers/specs/2026-08-10-hermes-agent-ads-ops-design.md`](../specs/2026-08-10-hermes-agent-ads-ops-design.md) (approved design spec — read this first for the "why", including the 5 gaps found during research: no external write surface, no strategy proposal shape, the executor's missing `default` case, the container-unreachable `localhost` bind, and the prod Compose file's missing `GOOGLE_ADS_MCP_URL`).

## Global Constraints

- `ProposalKind`'s 4 existing literals (`create_campaign`, `pause`, `budget_change`, `add_negative_keyword`) stay byte-identical — only additive.
- No new npm dependencies — `hostHeaderValidation`/`originValidation` are already exported by the installed `@modelcontextprotocol/node@^2.0.0`; `createProposal` already exists in `lib/db/proposals.ts`.
- `propose_change` must never call a Google Ads or Meta connector function — it may only call `createProposal()`. This is the human-approval gate; do not weaken it.
- `migrate.ts` re-runs the *entire* `schema.sql` file on every invocation (no migration versioning) — any DDL change to an already-existing table must be an idempotent `ALTER` (e.g. `DROP CONSTRAINT IF EXISTS` then `ADD CONSTRAINT`), not just an edit inside the `CREATE TABLE IF NOT EXISTS` block, which is a no-op against a table that already exists.
- The Google Ads MCP server binds to `localhost` only when unconfigured (`GOOGLE_ADS_MCP_ALLOWED_HOSTS` unset) — containerized deployments must set it explicitly. Never bind the HTTP listener itself to `0.0.0.0`; only the Host-header allowlist widens.
- Tests use Vitest (`vi.mock`, `vi.hoisted`) in exactly the style of the existing `tools.test.ts` / `index.test.ts` / `execute.test.ts` files — do not introduce a different mocking style.
- Prefer Torbit MCP (`run_sql` against the already-indexed local DuckDB graph, `project_id = 1672773718350201492` for this repo's `main` branch; run `get_graph_schema` first if unsure of tables) over `grep` to confirm callers/importers of any file you're changing before changing it.

---

## Parallel Execution Waves

4 tasks total, organized into 2 waves plus a sequential integration step. Tasks within a wave touch **disjoint files** — dispatch every task in a wave as a separate subagent in the same message (per `superpowers:dispatching-parallel-agents`). Peak parallel width is 2 — this is a small, tightly-coupled change set (the MCP-server task and the executor task both need `campaign_strategy` to already exist as a `ProposalKind` literal before their code type-checks), well within the 8-subagent cap; forcing wider parallelism here would mean splitting single coherent deliverables (e.g. slicing one Compose-file edit into three trivial ones) against the "Task Right-Sizing" guidance.

| Wave | Tasks (parallel) | Depends on |
|---|---|---|
| 1 | Task 1 (types + schema), Task 2 (Compose containerization) | — (nothing, start immediately) |
| 2 | Task 3 (executor fix), Task 4 (`propose_change` tool + host-validation allowlist) | Wave 1 (Task 1's `ProposalKind`/`CampaignStrategyPayload` types) |
| 3 | Task 5 (integration verification — sequential, not a subagent) | Wave 2 |

Recommended Cursor skill per subagent (announce `Using engineering-skills2 → <skill>` per that router's convention; `mcp-builder` and `tdd-guide` are standalone skills, not part of the `engineering-skills2` bundle):

| Task | File(s) | Recommended skill(s) |
|---|---|---|
| 1 | `lib/types.ts`, `lib/db/schema.sql` | `engineering-skills2 senior-backend` |
| 2 | `ads-agent/docker-compose.yml`, `deploy/docker-compose.prod.yml` | `engineering-skills2 senior-devops` |
| 3 | `lib/executor/execute.ts` | `engineering-skills2 senior-backend`, `~/.cursor/skills/engineering-skills2` → `tdd-guide` |
| 4 | `mcp/google-ads-server/tools.ts`, `mcp/google-ads-server/index.ts`, `.env.example` | `~/.cursor/skills/anthropic-agent-skills/mcp-builder/SKILL.md`, `engineering-skills2 senior-backend` |
| 5 | (verification only) | `engineering-skills2 code-reviewer` |

Every subagent prompt in this plan should tell the worker: "Before writing any code, run `run_sql` against the Torbit graph (already indexed; `get_graph_schema` first if unsure of tables) to confirm which files import/call what you're changing — avoid `grep` where a graph query answers the same question." Confirmed importers relevant to this plan (already queried, no need to re-run): `lib/types.ts`'s `ProposalKind`/`Proposal` are imported by `lib/db/proposals.ts`, `lib/executor/execute.ts`/`.test.ts`, `app/(admin)/proposals/[id]/CampaignProposalEditForm.tsx`, and several route tests — none of them switch on `kind` except `execute.ts` and the `create_campaign`-specific edit-form gate in `page.tsx`, so widening the union is additive everywhere except `execute.ts` (Task 3).

---

### Task 1: `lib/types.ts` + `lib/db/schema.sql` — new proposal kind

**Files:**
- Modify: `ads-agent/lib/types.ts:60` (the `ProposalKind` line)
- Modify: `ads-agent/lib/db/schema.sql:36-48` (the `proposals` table block)

**Interfaces:**
- Produces: `ProposalKind` gains `"campaign_strategy"`; new `CampaignStrategyRecommendation` and `CampaignStrategyPayload` types.
- Consumed by: Task 3 (`execute.ts`'s switch), Task 4 (`propose_change`'s input type).

- [ ] **Step 1: Write the failing check**

This is a type-level change with no live-Postgres test harness in this repo (every `lib/db/*.test.ts` mocks `getPool().query`, confirmed by reading `lib/db/proposals.test.ts`) — the meaningful "red" here is a TypeScript compile error. Add a case to `ads-agent/lib/db/proposals.test.ts`'s `describe("createProposal", ...)` block (after the existing `"defaults rationale to null when omitted"` test):

```typescript
  it("accepts the campaign_strategy kind", async () => {
    query.mockResolvedValue({ rows: [{ ...row, kind: "campaign_strategy" }] });
    await createProposal({
      kind: "campaign_strategy",
      campaignId: null,
      payload: { summary: "Shift budget toward Whitefield", recommendations: [] },
      triggeredRule: "hermes:campaign_strategy",
    });
    expect(query.mock.calls[0][1][0]).toBe("campaign_strategy");
  });
```

- [ ] **Step 2: Run the type checker to verify it fails**

Run: `cd ads-agent && npx tsc --noEmit`
Expected: FAIL — `Argument of type '{ kind: "campaign_strategy"; ... }' is not assignable to parameter of type 'NewProposal'` (`"campaign_strategy"` is not yet in the `ProposalKind` union).

- [ ] **Step 3: Write the implementation**

In `ads-agent/lib/types.ts`, replace line 60:

```typescript
export type ProposalKind = "create_campaign" | "pause" | "budget_change" | "add_negative_keyword";
```

with:

```typescript
export type ProposalKind =
  | "create_campaign"
  | "pause"
  | "budget_change"
  | "add_negative_keyword"
  | "campaign_strategy";

/** One line item inside a campaign_strategy proposal's payload — advisory, not an atomic mutation. */
export type CampaignStrategyRecommendation = {
  title: string;
  rationale: string;
  suggestedAction?: string;
};

/** Payload shape for a campaign_strategy proposal — a narrative recommendation, not a single
 * ad-platform mutation. executeProposal no-ops this kind (see lib/executor/execute.ts). */
export type CampaignStrategyPayload = {
  summary: string;
  recommendations: CampaignStrategyRecommendation[];
};
```

In `ads-agent/lib/db/schema.sql`, replace the `proposals` table block (lines 36-48):

```sql
CREATE TABLE IF NOT EXISTS proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL CHECK (kind IN ('create_campaign','pause','budget_change','add_negative_keyword')),
  campaign_id UUID REFERENCES campaigns(id),
  payload JSONB NOT NULL,
  triggered_rule TEXT NOT NULL,
  rationale TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','executed','failed')),
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ,
  executed_at TIMESTAMPTZ
);
```

with:

```sql
CREATE TABLE IF NOT EXISTS proposals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL CHECK (kind IN ('create_campaign','pause','budget_change','add_negative_keyword','campaign_strategy')),
  campaign_id UUID REFERENCES campaigns(id),
  payload JSONB NOT NULL,
  triggered_rule TEXT NOT NULL,
  rationale TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','executed','failed')),
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ,
  executed_at TIMESTAMPTZ
);

-- migrate.ts re-runs this entire file on every invocation; CREATE TABLE IF NOT EXISTS is a no-op
-- against a table that already exists, so widening the CHECK constraint above never takes effect
-- on its own for an already-provisioned database. Make the widening idempotent instead.
ALTER TABLE proposals DROP CONSTRAINT IF EXISTS proposals_kind_check;
ALTER TABLE proposals ADD CONSTRAINT proposals_kind_check
  CHECK (kind IN ('create_campaign','pause','budget_change','add_negative_keyword','campaign_strategy'));
```

- [ ] **Step 4: Run the type checker and tests to verify they pass**

Run: `cd ads-agent && npx tsc --noEmit && npx vitest run lib/db/proposals.test.ts`
Expected: PASS (`tsc` clean; `proposals.test.ts` 8 tests, including the new one).

- [ ] **Step 5: Commit**

```bash
git add ads-agent/lib/types.ts ads-agent/lib/db/schema.sql ads-agent/lib/db/proposals.test.ts
git commit -m "feat(ads-agent): add campaign_strategy proposal kind"
```

---

### Task 2: Containerize the Google Ads MCP server (Docker Compose)

**Files:**
- Modify: `ads-agent/docker-compose.yml`
- Modify: `deploy/docker-compose.prod.yml`

**Interfaces:**
- Produces: a `google-ads-mcp` Compose service in both files, reachable by other containers as `http://google-ads-mcp:8766/mcp`.
- No code dependency on any other task — reuses the *existing* `ads-agent` image/build context and the *existing* `scripts/run-google-ads-mcp.ts` entrypoint verbatim; only the `GOOGLE_ADS_MCP_ALLOWED_HOSTS` env var name is a contract with Task 4 (already fixed by the approved design spec, so no ordering dependency in practice).

This is an infra-only task — there is no Vitest suite for Compose YAML. The verification step is `docker compose config` (validates YAML syntax + variable interpolation, a real deterministic command with a real expected outcome) plus an actual `up`.

- [ ] **Step 1: Add the service to local dev Compose**

In `ads-agent/docker-compose.yml`, add a new service after `twenty-mcp-gateway` (before the `volumes:` block):

```yaml
  google-ads-mcp:
    build: .
    command: ["npx", "tsx", "scripts/run-google-ads-mcp.ts"]
    depends_on:
      db:
        condition: service_healthy
    env_file:
      - .env.local
    environment:
      # env_file loads the host-oriented DATABASE_URL (localhost:5434); override it for the
      # in-network Postgres service name — "localhost" inside this container is itself, not the host.
      DATABASE_URL: postgres://ads_agent:ads_agent_local_dev@db:5432/ads_agent
      GOOGLE_ADS_MCP_ALLOWED_HOSTS: localhost,127.0.0.1,google-ads-mcp
    ports:
      - "8766:8766"
    restart: unless-stopped
```

- [ ] **Step 2: Validate the local Compose file**

Run: `cd ads-agent && docker compose config --quiet`
Expected: exits 0 with no output (valid YAML; no unresolved required variables — `.env.local` is only read at container start via `env_file`, not at `config` time, so this validates structure/syntax, not the credentials themselves).

- [ ] **Step 3: Add the service to production Compose**

In `deploy/docker-compose.prod.yml`, add a new service after `bifrost` (before `ads-db:`):

```yaml
  google-ads-mcp:
    build: ../ads-agent
    command: ["npx", "tsx", "scripts/run-google-ads-mcp.ts"]
    depends_on:
      ads-db:
        condition: service_healthy
    networks:
      - default
    environment:
      DATABASE_URL: ${ADS_AGENT_DATABASE_URL:-postgres://ads_agent:${ADS_DB_PASSWORD}@ads-db:5432/ads_agent}
      GOOGLE_ADS_DEVELOPER_TOKEN: ${GOOGLE_ADS_DEVELOPER_TOKEN:-}
      GOOGLE_ADS_CLIENT_ID: ${GOOGLE_ADS_CLIENT_ID:-}
      GOOGLE_ADS_CLIENT_SECRET: ${GOOGLE_ADS_CLIENT_SECRET:-}
      GOOGLE_ADS_REFRESH_TOKEN: ${GOOGLE_ADS_REFRESH_TOKEN:-}
      GOOGLE_ADS_CUSTOMER_ID: ${GOOGLE_ADS_CUSTOMER_ID:-}
      GOOGLE_ADS_MCP_ALLOWED_HOSTS: google-ads-mcp,localhost,127.0.0.1
    expose:
      - "8766"
    restart: unless-stopped
```

- [ ] **Step 4: Wire the existing `ads-agent` service to it and fix the missing `GOOGLE_ADS_MCP_URL`**

In `deploy/docker-compose.prod.yml`'s `ads-agent` service, add to its `depends_on:` block (after the existing `bifrost: condition: service_started`):

```yaml
      google-ads-mcp:
        condition: service_started
```

And add to its `environment:` block (after the existing `GOOGLE_ADS_CUSTOMER_ID: ${GOOGLE_ADS_CUSTOMER_ID:-}` line — this line was previously missing entirely, which is why Google Ads MCP calls in production have been silently unreachable):

```yaml
      GOOGLE_ADS_MCP_URL: http://google-ads-mcp:8766/mcp
```

- [ ] **Step 5: Validate the production Compose file**

Run: `cd deploy && docker compose -f docker-compose.prod.yml config --quiet`
Expected: exits 0 with no output. (This repo's prod Compose is normally combined with a base file and real `.env.production` on the VM — if `docker compose config` complains about unrelated missing variables from other services in this file, confirm the *new* `google-ads-mcp` block and the `ads-agent` diff specifically parse with `docker compose -f docker-compose.prod.yml config --quiet 2>&1 | grep -i google-ads-mcp` returning nothing, i.e. no error mentioning the new service.)

- [ ] **Step 6: Commit**

```bash
git add ads-agent/docker-compose.yml deploy/docker-compose.prod.yml
git commit -m "feat(ads-agent): containerize the Google Ads MCP server"
```

---

### Task 3: `lib/executor/execute.ts` — close the silent-failure gap

**Files:**
- Modify: `ads-agent/lib/executor/execute.ts:98-112`
- Modify: `ads-agent/lib/executor/execute.test.ts`

**Interfaces:**
- Consumes: Task 1's `ProposalKind` (now includes `"campaign_strategy"`).
- No signature change — `executeProposal(proposalId: string): Promise<{ status: "executed" | "failed"; error?: string }>` is unchanged.

- [ ] **Step 1: Write the failing tests**

Add to `ads-agent/lib/executor/execute.test.ts`, inside the existing `describe("executeProposal", ...)` block (after the `"adds a negative keyword on the correct campaign"` test, using the same hoisted mocks already declared at the top of the file — no new imports needed):

```typescript
  it("no-ops a campaign_strategy proposal and marks it executed without touching any connector", async () => {
    getProposalById.mockResolvedValue(
      approvedProposal({
        kind: "campaign_strategy",
        campaignId: null,
        payload: { summary: "Shift budget toward Whitefield", recommendations: [] },
      }),
    );

    const result = await executeProposal("prop-1");

    expect(getCampaignById).not.toHaveBeenCalled();
    expect(pauseGoogleCampaign).not.toHaveBeenCalled();
    expect(markProposalExecuted).toHaveBeenCalledWith("prop-1");
    expect(result).toEqual({ status: "executed" });
  });

  it("marks an unrecognized proposal kind as failed instead of silently executing it", async () => {
    getProposalById.mockResolvedValue(approvedProposal({ kind: "future_kind" as never }));

    const result = await executeProposal("prop-1");

    expect(markProposalExecuted).not.toHaveBeenCalled();
    expect(markProposalFailed).toHaveBeenCalledWith(
      "prop-1",
      expect.stringContaining("future_kind"),
    );
    expect(result).toEqual({ status: "failed", error: expect.stringContaining("future_kind") });
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ads-agent && npx vitest run lib/executor/execute.test.ts`
Expected: the second test FAILS — today's switch has no `default` case, so an unrecognized `kind` falls through and unconditionally hits `markProposalExecuted`, not `markProposalFailed`. (The first test currently passes by coincidence — the same fallthrough happens to look like a no-op for `campaign_strategy` too; it is kept as a regression test documenting the intended, explicit behavior once Step 3 lands.)

- [ ] **Step 3: Write the implementation**

In `ads-agent/lib/executor/execute.ts`, replace the `switch` block (lines 99-112):

```typescript
    switch (proposal.kind) {
      case "create_campaign":
        await executeCreateCampaign(proposal.payload as unknown as CreateCampaignPayload);
        break;
      case "pause":
        await executePause(proposal.payload as unknown as CampaignActionPayload);
        break;
      case "budget_change":
        await executeBudgetChange(proposal.payload as unknown as BudgetChangePayload);
        break;
      case "add_negative_keyword":
        await executeAddNegativeKeyword(proposal.payload as unknown as NegativeKeywordPayload);
        break;
    }
```

with:

```typescript
    switch (proposal.kind) {
      case "create_campaign":
        await executeCreateCampaign(proposal.payload as unknown as CreateCampaignPayload);
        break;
      case "pause":
        await executePause(proposal.payload as unknown as CampaignActionPayload);
        break;
      case "budget_change":
        await executeBudgetChange(proposal.payload as unknown as BudgetChangePayload);
        break;
      case "add_negative_keyword":
        await executeAddNegativeKeyword(proposal.payload as unknown as NegativeKeywordPayload);
        break;
      case "campaign_strategy":
        // Narrative/advisory proposal (see lib/types.ts's CampaignStrategyPayload) — nothing to
        // execute against an ad platform.
        break;
      default:
        // Defense in depth: every ProposalKind literal is handled above, so this only fires for
        // a kind the type system doesn't know about (e.g. stale data). Fail loudly instead of
        // falling through to markProposalExecuted having done nothing.
        throw new Error(`executeProposal: unhandled proposal kind "${proposal.kind}"`);
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ads-agent && npx vitest run lib/executor/execute.test.ts`
Expected: PASS (all original 7 cases + 2 new ones).

- [ ] **Step 5: Commit**

```bash
git add ads-agent/lib/executor/execute.ts ads-agent/lib/executor/execute.test.ts
git commit -m "fix(ads-agent): executor fails loudly on an unhandled proposal kind instead of silently executing it"
```

---

### Task 4: `propose_change` MCP tool + configurable host-validation allowlist

**Files:**
- Modify: `ads-agent/mcp/google-ads-server/tools.ts`
- Modify: `ads-agent/mcp/google-ads-server/tools.test.ts`
- Modify: `ads-agent/mcp/google-ads-server/index.ts`
- Modify: `ads-agent/mcp/google-ads-server/index.test.ts`
- Modify: `ads-agent/.env.example`

**Interfaces:**
- Consumes: Task 1's `ProposalKind`/`NewProposal` types; the existing `createProposal` from `../../lib/db/proposals` (no changes needed there — it already accepts any `NewProposal`, confirmed by reading `lib/db/proposals.ts`, which does zero kind-specific branching).
- Produces: `proposeChange(input: NewProposal): Promise<{ proposalId: string }>` in `tools.ts`; an 8th registered tool, `propose_change`, in `index.ts`; `resolveGoogleAdsMcpAllowedHosts(): string[]` in `index.ts` (exported for direct unit testing, rather than standing up a live HTTP server in the test suite).

- [ ] **Step 1: Write the failing tests**

In `ads-agent/mcp/google-ads-server/tools.test.ts`, add a new mock alongside the existing `vi.mock("google-ads-api", ...)` block (top of file, after it):

```typescript
const createProposalMock = vi.hoisted(() => vi.fn());
vi.mock("../../lib/db/proposals", () => ({ createProposal: createProposalMock }));
```

Add `createProposalMock.mockReset();` inside the existing `beforeEach(() => { ... })` block, alongside the other `.mockReset()` calls.

Add a new `describe` block at the end of the file:

```typescript
describe("proposeChange", () => {
  it("calls createProposal with the given input and returns the new proposal id", async () => {
    createProposalMock.mockResolvedValue({
      id: "prop-99",
      kind: "campaign_strategy",
      campaignId: null,
      payload: { summary: "Shift budget toward Whitefield", recommendations: [] },
      triggeredRule: "hermes:campaign_strategy",
      rationale: "Search volume up 30% in Whitefield this week",
      status: "pending",
      error: null,
      createdAt: "2026-08-10T00:00:00.000Z",
      decidedAt: null,
      executedAt: null,
    });
    const { proposeChange } = await import("./tools");
    const input = {
      kind: "campaign_strategy" as const,
      campaignId: null,
      payload: { summary: "Shift budget toward Whitefield", recommendations: [] },
      triggeredRule: "hermes:campaign_strategy",
      rationale: "Search volume up 30% in Whitefield this week",
    };

    const result = await proposeChange(input);

    expect(result).toEqual({ proposalId: "prop-99" });
    expect(createProposalMock).toHaveBeenCalledWith(input);
  });
});
```

In `ads-agent/mcp/google-ads-server/index.test.ts`:

1. Add `proposeChange: vi.fn()` to the `toolsMock` hoisted object (alongside the 7 existing entries).
2. Replace the `WRITE_TOOL_NAMES` constant:

```typescript
const WRITE_TOOL_NAMES = ["create_campaign", "pause_campaign", "update_campaign_budget", "add_negative_keyword"];
```

with:

```typescript
const WRITE_TOOL_NAMES = [
  "create_campaign",
  "pause_campaign",
  "update_campaign_budget",
  "add_negative_keyword",
  "propose_change",
];
```

3. Replace the tool-count test's `it(...)` description (the `toEqual` line already reads from `WRITE_TOOL_NAMES`, so it needs no further edit beyond the constant change above):

```typescript
  it("registers exactly 7 tools: 3 read + 4 write", async () => {
```

with:

```typescript
  it("registers exactly 8 tools: 3 read + 5 write", async () => {
```

4. Add a new test after the `create_campaign` test:

```typescript
  it("propose_change calls proposeChange with the parsed input and returns the new proposal id", async () => {
    toolsMock.proposeChange.mockResolvedValue({ proposalId: "prop-99" });
    const client = await connectedClient();
    const input = {
      kind: "campaign_strategy" as const,
      campaignId: null,
      payload: { summary: "Shift budget toward Whitefield", recommendations: [] },
      triggeredRule: "hermes:campaign_strategy",
    };
    const result = await client.callTool({ name: "propose_change", arguments: input });
    expect(toolsMock.proposeChange).toHaveBeenCalledWith(input);
    const text = (result.content as { type: string; text: string }[])[0].text;
    expect(JSON.parse(text)).toEqual({ proposalId: "prop-99" });
    await client.close();
  });
```

5. Add a new top-level `describe` block at the end of the file for the allowlist helper:

```typescript
describe("resolveGoogleAdsMcpAllowedHosts", () => {
  const originalEnv = process.env.GOOGLE_ADS_MCP_ALLOWED_HOSTS;

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.GOOGLE_ADS_MCP_ALLOWED_HOSTS;
    else process.env.GOOGLE_ADS_MCP_ALLOWED_HOSTS = originalEnv;
  });

  it("defaults to localhost and 127.0.0.1 when unset", async () => {
    delete process.env.GOOGLE_ADS_MCP_ALLOWED_HOSTS;
    const { resolveGoogleAdsMcpAllowedHosts } = await import("./index");
    expect(resolveGoogleAdsMcpAllowedHosts()).toEqual(["localhost", "127.0.0.1"]);
  });

  it("parses a comma-separated allowlist, trimming whitespace", async () => {
    process.env.GOOGLE_ADS_MCP_ALLOWED_HOSTS = "google-ads-mcp, localhost , 127.0.0.1";
    const { resolveGoogleAdsMcpAllowedHosts } = await import("./index");
    expect(resolveGoogleAdsMcpAllowedHosts()).toEqual(["google-ads-mcp", "localhost", "127.0.0.1"]);
  });
});
```

And add `afterEach` to the existing `import { beforeEach, describe, expect, it, vi } from "vitest";` line, making it `import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd ads-agent && npx vitest run mcp/google-ads-server/tools.test.ts mcp/google-ads-server/index.test.ts`
Expected: FAIL — `proposeChange` is not exported from `./tools` yet; `propose_change` is not a registered tool yet; `resolveGoogleAdsMcpAllowedHosts` is not exported from `./index` yet.

- [ ] **Step 3: Write the implementation**

In `ads-agent/mcp/google-ads-server/tools.ts`, add to the top import block (after the existing `import { requireEnv } from "../../lib/env";` line):

```typescript
import { createProposal } from "../../lib/db/proposals";
import type { NewProposal } from "../../lib/types";
```

Append at the end of the file (after `addGoogleNegativeKeyword`):

```typescript
/**
 * The one write surface an external agent (e.g. a future Hermes deployment) may call — never
 * touches the Google Ads or Meta APIs directly, only ever inserts a `pending` row via
 * createProposal(). Approval, rejection, and execution flow through the exact same
 * /api/proposals/[id]/approve|reject routes and executeProposal() as every other proposal.
 */
export async function proposeChange(input: NewProposal): Promise<{ proposalId: string }> {
  const proposal = await createProposal(input);
  return { proposalId: proposal.id };
}
```

In `ads-agent/mcp/google-ads-server/index.ts`, replace the import block (lines 1-17):

```typescript
import { createServer } from "node:http";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import {
  localhostHostValidation,
  localhostOriginValidation,
  toNodeHandler,
} from "@modelcontextprotocol/node";
import { z } from "zod";
import {
  addGoogleNegativeKeyword,
  createFullGoogleCampaign,
  fetchGoogleAdsPerformance,
  fetchGoogleSearchTerms,
  listAccessibleCustomers,
  pauseGoogleCampaign,
  updateGoogleCampaignBudget,
} from "./tools";
```

with:

```typescript
import { createServer } from "node:http";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import {
  hostHeaderValidation,
  localhostOriginValidation,
  toNodeHandler,
} from "@modelcontextprotocol/node";
import { z } from "zod";
import {
  addGoogleNegativeKeyword,
  createFullGoogleCampaign,
  fetchGoogleAdsPerformance,
  fetchGoogleSearchTerms,
  listAccessibleCustomers,
  pauseGoogleCampaign,
  proposeChange,
  updateGoogleCampaignBudget,
} from "./tools";

const PROPOSAL_KINDS = [
  "create_campaign",
  "pause",
  "budget_change",
  "add_negative_keyword",
  "campaign_strategy",
] as const;

/** Host-header allowlist for the DNS-rebinding guard, driven by GOOGLE_ADS_MCP_ALLOWED_HOSTS
 * (comma-separated). Defaults to localhost-only for the tsx-on-host workflow; containerized
 * deployments (docker-compose.yml, deploy/docker-compose.prod.yml) set it to include the Compose
 * service name ("google-ads-mcp") so other containers can reach this server by that name. */
export function resolveGoogleAdsMcpAllowedHosts(): string[] {
  const raw = process.env.GOOGLE_ADS_MCP_ALLOWED_HOSTS;
  if (!raw) return ["localhost", "127.0.0.1"];
  return raw
    .split(",")
    .map((host) => host.trim())
    .filter((host) => host.length > 0);
}
```

Add the new tool registration inside `buildGoogleAdsMcpServer()`, after the existing `add_negative_keyword` tool (before the closing `return server;`):

```typescript
  server.registerTool(
    "propose_change",
    {
      description:
        "Create a pending ads-agent proposal for human review. The only tool an external agent may call to affect ads-agent — never mutates the Google Ads or Meta APIs directly.",
      inputSchema: z.object({
        kind: z.enum(PROPOSAL_KINDS),
        campaignId: z.string().nullable(),
        payload: z.record(z.string(), z.unknown()),
        triggeredRule: z.string(),
        rationale: z.string().optional(),
      }),
    },
    async (input) => ({
      content: [{ type: "text", text: JSON.stringify(await proposeChange(input)) }],
    }),
  );
```

Replace `startGoogleAdsMcpServer`'s guard construction:

```typescript
  const validateHost = localhostHostValidation();
  const validateOrigin = localhostOriginValidation();
```

with:

```typescript
  const validateHost = hostHeaderValidation(resolveGoogleAdsMcpAllowedHosts());
  const validateOrigin = localhostOriginValidation();
```

In `ads-agent/.env.example`, add after the existing `GOOGLE_ADS_MCP_URL=http://localhost:8766/mcp` line:

```bash
# Comma-separated Host-header allowlist for the Google Ads MCP server's DNS-rebinding guard.
# Defaults to localhost,127.0.0.1 when unset; docker-compose.yml sets this to include
# "google-ads-mcp" (the Compose service name) so other containers can reach it.
GOOGLE_ADS_MCP_ALLOWED_HOSTS=localhost,127.0.0.1
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd ads-agent && npx tsc --noEmit && npx vitest run mcp/google-ads-server/tools.test.ts mcp/google-ads-server/index.test.ts`
Expected: PASS — `tools.test.ts` (8 cases: 7 original + 1 new), `index.test.ts` (7 cases: 4 original + 1 updated count + 1 new tool test + 2 allowlist tests).

- [ ] **Step 5: Commit**

```bash
git add ads-agent/mcp/google-ads-server/tools.ts ads-agent/mcp/google-ads-server/tools.test.ts ads-agent/mcp/google-ads-server/index.ts ads-agent/mcp/google-ads-server/index.test.ts ads-agent/.env.example
git commit -m "feat(ads-agent): add propose_change MCP tool and containerization-ready host allowlist"
```

---

### Task 5: Final integration verification (sequential — not a subagent)

Do this yourself after Waves 1–2 complete; it is the "integration" step from `superpowers:dispatching-parallel-agents` and must not be parallelized.

- [ ] **Step 1: Confirm no accidental overlap across tasks**

Run: `cd /Users/swami/Documents/GentleSpace_Web && git status --porcelain`
Expected: only the files listed across Tasks 1–4 are modified — no unexpected files.

- [ ] **Step 2: Full type check, test suite, build, and lint**

Run: `cd ads-agent && npx tsc --noEmit && npm test && npm run build && npm run lint`
Expected: all pass with zero new warnings — this exercises every task's changes together (Task 1's widened type flowing into Task 3's switch and Task 4's tool input schema simultaneously, which no individual task's own test run does).

- [ ] **Step 3: Validate both Compose files end-to-end**

Run: `cd ads-agent && docker compose config --quiet && cd ../deploy && docker compose -f docker-compose.prod.yml config --quiet`
Expected: both exit 0.

- [ ] **Step 4: Live container smoke test (local dev)**

Run (requires `.env.local` already filled per the README, including Google Ads credentials — placeholder values are fine since the tool handlers only throw when actually called, not at registration time):

```bash
cd ads-agent
docker compose up -d db
npm run migrate
docker compose up -d google-ads-mcp
docker compose logs google-ads-mcp
```

Expected: logs show `google-ads-mcp listening on http://localhost:8766/mcp` with no crash. Then, from the host (confirms the published port + default allowlist both work):

```bash
GOOGLE_ADS_MCP_URL=http://localhost:8766/mcp npx tsx -e '
import { listGoogleAdsTools } from "./lib/bifrost/google-ads-mcp-client";
listGoogleAdsTools().then((tools) => console.log(tools.map((t) => t.name)));
'
```

Expected: prints an array of 8 tool names including `propose_change`. Stop the container afterward: `docker compose down`.

- [ ] **Step 5: Mark the design spec's success criteria**

Open `docs/superpowers/specs/2026-08-10-hermes-agent-ads-ops-design.md` and check off every box in its "Success criteria" section that Steps 1–4 above verified. Leave unchecked only whatever requires a real production deploy (the prod Compose `depends_on`/env wiring is now correct, but verifying it live is a deploy-time action, not something this plan's local verification can confirm).

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-08-10-hermes-agent-ads-ops-design.md
git commit -m "docs(ads-agent): check off automated Hermes bridge success criteria"
```
