# S10 Leads Agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mint task tokens for Hermes via a privileged ads-agent HTTP API, document/install a Hermes `leads` skill that uses context-MCP to queue `enquiry.requirement_update` / `message.draft` proposals, and leave a wake-script stub for later scheduling.

**Architecture:** Server-owned `LEADS_TOOL_ALLOWLIST` + thin `POST /api/internal/agent/task-token` that calls existing `mintTaskToken()` (owner pool). Hermes (out of repo) calls mint then context-mcp `:8768`. No Kanban; manual E2E gate + `wake-leads-agent.ts` stub.

**Tech Stack:** TypeScript, Next.js App Router route handlers, Vitest, Zod (inline validation ok), existing `mintTaskToken` / context-MCP, Hermes skill markdown.

**Related:** [`docs/superpowers/specs/2026-08-13-s10-leads-agent-design.md`](../specs/2026-08-13-s10-leads-agent-design.md)

## Global Constraints

- No new npm dependencies.
- Never log raw task tokens or their SHA-256 (agent spec §6).
- Mint route must not accept a client-supplied `toolAllowlist` — server sets it.
- S10 rejects any `profile` other than `"leads"`.
- Omit `get_campaign_performance` from the leads allowlist.
- Do not register node-cron; wake script is opt-in via `HERMES_WAKE=1`.
- Do not expand app-data-MCP for minting or context tools.
- Middleware already excludes `/api` — mint route must still authenticate with `x-agent-internal-key`.
- Tests: Vitest + `vi.hoisted` / `vi.mock` style as in `app/api/hermes/chat/route.test.ts`.
- Prefer Composer 2.5 / `composer-2.5-fast` for mechanical TDD tasks; `inherit` only if judgment is required.

---

## File map

| Path | Responsibility |
|---|---|
| `ads-agent/lib/agent/leads-tools.ts` | `LEADS_TOOL_ALLOWLIST`, TTL constants, profile check |
| `ads-agent/lib/agent/leads-tools.test.ts` | Unit tests for allowlist contents + TTL clamp helper |
| `ads-agent/app/api/internal/agent/task-token/route.ts` | HTTP mint endpoint |
| `ads-agent/app/api/internal/agent/task-token/route.test.ts` | Auth / validation / happy path (mock `mintTaskToken`) |
| `docs/superpowers/hermes-skills/ads-agent/leads-enquiry-triage/SKILL.md` | Hermes skill |
| `ads-agent/scripts/wake-leads-agent.ts` | Cron stub |
| `ads-agent/scripts/wake-leads-agent.test.ts` | Arg / env behaviour without calling Hermes |
| `ads-agent/.env.example` | `AGENT_INTERNAL_API_KEY`, `LEADS_ORG_ID` stubs |
| `docs/superpowers/specs/2026-08-13-s10-leads-agent-runbook.md` | Ops: Hermes MCP config + manual gate |

---

## Parallel Execution Waves

| Wave | Tasks (parallel) | Depends on |
|---|---|---|
| 1 | Task 1 (`leads-tools`), Task 3 (Hermes skill), Task 4 (wake stub) | — |
| 2 | Task 2 (mint route) | Task 1 |
| 3 | Task 5 (env + runbook + openmemory) | Tasks 1–4 |

Peak parallel width: **3** (Wave 1).

| Task | Recommended model |
|---|---|
| 1–4 | `composer-2.5-fast` |
| 5 | `composer-2.5-fast` |

---

### Task 1: Leads tool allowlist module

**Files:**
- Create: `ads-agent/lib/agent/leads-tools.ts`
- Create: `ads-agent/lib/agent/leads-tools.test.ts`

**Interfaces:**
- Produces:
  - `export const LEADS_PROFILE = "leads" as const`
  - `export const LEADS_TOOL_ALLOWLIST: readonly string[]`
  - `export const LEADS_TOKEN_TTL_DEFAULT = 900`
  - `export const LEADS_TOKEN_TTL_MAX = 3600`
  - `export function clampLeadsTtl(seconds: number | undefined): number`
  - `export function assertLeadsProfile(profile: string): void` — throws `Error` with message `forbidden_profile` if not `leads`

- [ ] **Step 1: Write the failing test**

```ts
// ads-agent/lib/agent/leads-tools.test.ts
import { describe, expect, it } from "vitest";
import {
  LEADS_PROFILE,
  LEADS_TOOL_ALLOWLIST,
  clampLeadsTtl,
  assertLeadsProfile,
  LEADS_TOKEN_TTL_DEFAULT,
  LEADS_TOKEN_TTL_MAX,
} from "./leads-tools";

describe("leads-tools", () => {
  it("exports profile leads", () => {
    expect(LEADS_PROFILE).toBe("leads");
  });

  it("allowlist includes enquiry + proposal tools and omits campaign performance", () => {
    expect(LEADS_TOOL_ALLOWLIST).toEqual(
      expect.arrayContaining([
        "list_enquiries",
        "get_enquiry",
        "get_context_pack",
        "search_spaces",
        "get_space",
        "list_proposals",
        "graph_query",
        "create_proposal",
      ]),
    );
    expect(LEADS_TOOL_ALLOWLIST).not.toContain("get_campaign_performance");
    expect(LEADS_TOOL_ALLOWLIST.length).toBe(8);
  });

  it("clamps ttl", () => {
    expect(clampLeadsTtl(undefined)).toBe(LEADS_TOKEN_TTL_DEFAULT);
    expect(clampLeadsTtl(60)).toBe(60);
    expect(clampLeadsTtl(99999)).toBe(LEADS_TOKEN_TTL_MAX);
    expect(clampLeadsTtl(0)).toBe(LEADS_TOKEN_TTL_DEFAULT);
    expect(clampLeadsTtl(-1)).toBe(LEADS_TOKEN_TTL_DEFAULT);
  });

  it("assertLeadsProfile rejects others", () => {
    expect(() => assertLeadsProfile("leads")).not.toThrow();
    expect(() => assertLeadsProfile("campaign")).toThrow(/forbidden_profile/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ads-agent && npx vitest run lib/agent/leads-tools.test.ts`

Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```ts
// ads-agent/lib/agent/leads-tools.ts
export const LEADS_PROFILE = "leads" as const;

export const LEADS_TOOL_ALLOWLIST = [
  "list_enquiries",
  "get_enquiry",
  "get_context_pack",
  "search_spaces",
  "get_space",
  "list_proposals",
  "graph_query",
  "create_proposal",
] as const satisfies readonly string[];

export const LEADS_TOKEN_TTL_DEFAULT = 900;
export const LEADS_TOKEN_TTL_MAX = 3600;

export function clampLeadsTtl(seconds: number | undefined): number {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) {
    return LEADS_TOKEN_TTL_DEFAULT;
  }
  return Math.min(Math.floor(seconds), LEADS_TOKEN_TTL_MAX);
}

export function assertLeadsProfile(profile: string): void {
  if (profile !== LEADS_PROFILE) throw new Error("forbidden_profile");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ads-agent && npx vitest run lib/agent/leads-tools.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add ads-agent/lib/agent/leads-tools.ts ads-agent/lib/agent/leads-tools.test.ts
git commit -m "feat(agent): leads tool allowlist and TTL helpers for S10"
```

---

### Task 2: Mint task-token API route

**Files:**
- Create: `ads-agent/app/api/internal/agent/task-token/route.ts`
- Create: `ads-agent/app/api/internal/agent/task-token/route.test.ts`

**Interfaces:**
- Consumes: `LEADS_TOOL_ALLOWLIST`, `clampLeadsTtl`, `assertLeadsProfile`, `LEADS_PROFILE` from `@/lib/agent/leads-tools`; `mintTaskToken` from `@/mcp/context-server/task-token`
- Produces: `POST` handler returning `{ token: string }` on 200

Auth: header `x-agent-internal-key` must equal `process.env.AGENT_INTERNAL_API_KEY` using `crypto.timingSafeEqual` on equal-length buffers. If env unset or lengths differ → 401.

Body JSON fields: `orgId` (uuid regex), `taskId` (non-empty string ≤ 200 chars), `profile` (must be leads), optional `ttlSeconds` (number).

- [ ] **Step 1: Write the failing tests**

```ts
// ads-agent/app/api/internal/agent/task-token/route.test.ts
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const { mintTaskToken } = vi.hoisted(() => ({
  mintTaskToken: vi.fn(),
}));

vi.mock("@/mcp/context-server/task-token", () => ({ mintTaskToken }));

import { POST } from "./route";
import { LEADS_TOOL_ALLOWLIST } from "@/lib/agent/leads-tools";

const ORG = "00000000-0000-4000-8000-0000000000aa";
const KEY = "test-agent-internal-key";

function post(body: unknown, headers: Record<string, string> = {}) {
  return POST(
    new Request("http://localhost/api/internal/agent/task-token", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/internal/agent/task-token", () => {
  beforeEach(() => {
    process.env.AGENT_INTERNAL_API_KEY = KEY;
    mintTaskToken.mockReset();
    mintTaskToken.mockResolvedValue({ token: "ab".repeat(32) });
  });
  afterEach(() => {
    delete process.env.AGENT_INTERNAL_API_KEY;
  });

  it("returns 401 without key", async () => {
    const res = await post({ orgId: ORG, taskId: "t1", profile: "leads" });
    expect(res.status).toBe(401);
    expect(mintTaskToken).not.toHaveBeenCalled();
  });

  it("returns 401 with wrong key", async () => {
    const res = await post(
      { orgId: ORG, taskId: "t1", profile: "leads" },
      { "x-agent-internal-key": "nope" },
    );
    expect(res.status).toBe(401);
  });

  it("returns 403 for non-leads profile", async () => {
    const res = await post(
      { orgId: ORG, taskId: "t1", profile: "campaign" },
      { "x-agent-internal-key": KEY },
    );
    expect(res.status).toBe(403);
    expect(mintTaskToken).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid orgId", async () => {
    const res = await post(
      { orgId: "not-a-uuid", taskId: "t1", profile: "leads" },
      { "x-agent-internal-key": KEY },
    );
    expect(res.status).toBe(400);
  });

  it("mints with server-owned allowlist", async () => {
    const res = await post(
      { orgId: ORG, taskId: "task-42", profile: "leads", ttlSeconds: 120 },
      { "x-agent-internal-key": KEY },
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ token: "ab".repeat(32) });
    expect(mintTaskToken).toHaveBeenCalledWith({
      orgId: ORG,
      taskId: "task-42",
      profile: "leads",
      toolAllowlist: [...LEADS_TOOL_ALLOWLIST],
      ttlSeconds: 120,
    });
  });

  it("ignores client toolAllowlist if somehow present", async () => {
    await post(
      {
        orgId: ORG,
        taskId: "t1",
        profile: "leads",
        toolAllowlist: ["get_campaign_performance"],
      },
      { "x-agent-internal-key": KEY },
    );
    expect(mintTaskToken.mock.calls[0][0].toolAllowlist).toEqual([...LEADS_TOOL_ALLOWLIST]);
    expect(mintTaskToken.mock.calls[0][0].toolAllowlist).not.toContain("get_campaign_performance");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ads-agent && npx vitest run app/api/internal/agent/task-token/route.test.ts`

Expected: FAIL — route not found

- [ ] **Step 3: Write minimal implementation**

```ts
// ads-agent/app/api/internal/agent/task-token/route.ts
import { timingSafeEqual } from "node:crypto";
import { mintTaskToken } from "@/mcp/context-server/task-token";
import {
  LEADS_PROFILE,
  LEADS_TOOL_ALLOWLIST,
  assertLeadsProfile,
  clampLeadsTtl,
} from "@/lib/agent/leads-tools";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function authorized(req: Request): boolean {
  const expected = process.env.AGENT_INTERNAL_API_KEY;
  const got = req.headers.get("x-agent-internal-key");
  if (!expected || !got) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(got);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export async function POST(req: Request): Promise<Response> {
  if (!authorized(req)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }
  const { orgId, taskId, profile, ttlSeconds } = body as Record<string, unknown>;

  if (typeof orgId !== "string" || !UUID_RE.test(orgId)) {
    return Response.json({ error: "invalid_org_id" }, { status: 400 });
  }
  if (typeof taskId !== "string" || taskId.length < 1 || taskId.length > 200) {
    return Response.json({ error: "invalid_task_id" }, { status: 400 });
  }
  if (typeof profile !== "string") {
    return Response.json({ error: "invalid_profile" }, { status: 400 });
  }
  try {
    assertLeadsProfile(profile);
  } catch {
    return Response.json({ error: "forbidden_profile" }, { status: 403 });
  }

  const ttl =
    ttlSeconds === undefined
      ? clampLeadsTtl(undefined)
      : typeof ttlSeconds === "number"
        ? clampLeadsTtl(ttlSeconds)
        : null;
  if (ttl === null) {
    return Response.json({ error: "invalid_ttl" }, { status: 400 });
  }

  try {
    const { token } = await mintTaskToken({
      orgId,
      taskId,
      profile: LEADS_PROFILE,
      toolAllowlist: [...LEADS_TOOL_ALLOWLIST],
      ttlSeconds: ttl,
    });
    return Response.json({ token });
  } catch {
    return Response.json({ error: "mint_failed" }, { status: 500 });
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ads-agent && npx vitest run app/api/internal/agent/task-token/route.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add ads-agent/app/api/internal/agent/task-token/route.ts \
  ads-agent/app/api/internal/agent/task-token/route.test.ts
git commit -m "feat(agent): HTTP mint endpoint for leads task tokens"
```

---

### Task 3: Hermes `leads-enquiry-triage` skill

**Files:**
- Create: `docs/superpowers/hermes-skills/ads-agent/leads-enquiry-triage/SKILL.md`

**Interfaces:**
- Consumes: mint API contract + context-MCP tool names from the design spec
- Produces: installable Hermes skill (markdown only; no TypeScript)

- [ ] **Step 1: Write the skill file**

Create `docs/superpowers/hermes-skills/ads-agent/leads-enquiry-triage/SKILL.md` with frontmatter matching sibling skills (`name`, `description`, `version: 1.0.0`, `metadata.hermes.tags` including `CRM`, `Proposals`, `MCP`, `related_skills: [verification-before-proposing]`).

Body must require this procedure:

1. Mint: `POST {ADS_AGENT_BASE_URL}/api/internal/agent/task-token` with headers `Content-Type: application/json` and `x-agent-internal-key: $AGENT_INTERNAL_API_KEY`, body `{ "orgId": "$LEADS_ORG_ID", "taskId": "<new-uuid>", "profile": "leads" }`. Keep the returned `token` only in working memory for this turn — never paste it into chat.
2. Call context-MCP tools with `task_token` set to that value: `list_enquiries` → `get_enquiry` → `get_context_pack` with `entity: "enquiry"`.
3. Optionally `search_spaces` / `get_space` / `graph_query` / `list_proposals` if needed for the proposal.
4. Run verification-before-proposing spirit: every claim traces to a tool result this turn.
5. `create_proposal` with `kind` only `enquiry.requirement_update` or `message.draft`, non-empty `evidence` of pack IDs, broker-readable `rationale`.
6. Tell the user the `proposalId` and that a human must approve at `/proposals`. Never send email/WhatsApp.

Pitfalls section: no inventing facts; no `get_campaign_performance`; no Google Ads `propose_change` from this skill; empty evidence is rejected by the server.

- [ ] **Step 2: Sanity check**

Run: `test -f docs/superpowers/hermes-skills/ads-agent/leads-enquiry-triage/SKILL.md && rg -n 'task-token|enquiry.requirement_update|message.draft|get_campaign_performance' docs/superpowers/hermes-skills/ads-agent/leads-enquiry-triage/SKILL.md`

Expected: file exists; mint + both kinds mentioned; `get_campaign_performance` only in a “do not use” pitfall line.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/hermes-skills/ads-agent/leads-enquiry-triage/SKILL.md
git commit -m "docs(hermes): leads enquiry triage skill for S10"
```

---

### Task 4: Wake-leads stub script

**Files:**
- Create: `ads-agent/scripts/wake-leads-agent.ts`
- Create: `ads-agent/scripts/wake-leads-agent.test.ts`

**Interfaces:**
- Produces: `export function parseWakeArgs(argv: string[]): { orgId: string; enquiryId?: string }`
- Produces: `export async function main(env: NodeJS.ProcessEnv, argv: string[]): Promise<number>` exit code

Behaviour:

- Parse `--org-id=<uuid>` (required) and optional `--enquiry-id=<uuid>` from argv.
- If `env.HERMES_WAKE !== "1"`: print `wake-leads-agent: not scheduled (set HERMES_WAKE=1 to enable)` to stdout, return `0`.
- If enabled: print a single line describing that Hermes wake is not fully wired yet (include orgId / enquiryId), return `0`. Do **not** call network APIs in S10 (stub only).

- [ ] **Step 1: Write the failing test**

```ts
// ads-agent/scripts/wake-leads-agent.test.ts
import { describe, expect, it } from "vitest";
import { parseWakeArgs, main } from "./wake-leads-agent";

const ORG = "00000000-0000-4000-8000-0000000000aa";

describe("wake-leads-agent", () => {
  it("parses org and enquiry", () => {
    expect(parseWakeArgs([`--org-id=${ORG}`, "--enquiry-id=00000000-0000-4000-8000-0000000000bb"])).toEqual({
      orgId: ORG,
      enquiryId: "00000000-0000-4000-8000-0000000000bb",
    });
  });

  it("requires org-id", () => {
    expect(() => parseWakeArgs([])).toThrow(/org-id/);
  });

  it("no-ops without HERMES_WAKE", async () => {
    const code = await main({}, [`--org-id=${ORG}`]);
    expect(code).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ads-agent && npx vitest run scripts/wake-leads-agent.test.ts`

Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```ts
// ads-agent/scripts/wake-leads-agent.ts
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseWakeArgs(argv: string[]): { orgId: string; enquiryId?: string } {
  let orgId: string | undefined;
  let enquiryId: string | undefined;
  for (const a of argv) {
    if (a.startsWith("--org-id=")) orgId = a.slice("--org-id=".length);
    if (a.startsWith("--enquiry-id=")) enquiryId = a.slice("--enquiry-id=".length);
  }
  if (!orgId || !UUID_RE.test(orgId)) throw new Error("wake-leads-agent: --org-id=<uuid> required");
  if (enquiryId !== undefined && !UUID_RE.test(enquiryId)) {
    throw new Error("wake-leads-agent: --enquiry-id must be uuid");
  }
  return enquiryId ? { orgId, enquiryId } : { orgId };
}

export async function main(env: NodeJS.ProcessEnv, argv: string[]): Promise<number> {
  const args = parseWakeArgs(argv);
  if (env.HERMES_WAKE !== "1") {
    console.log("wake-leads-agent: not scheduled (set HERMES_WAKE=1 to enable)");
    return 0;
  }
  console.log(
    `wake-leads-agent: stub wake org=${args.orgId}` +
      (args.enquiryId ? ` enquiry=${args.enquiryId}` : "") +
      " (Hermes API invoke deferred)",
  );
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.env, process.argv.slice(2)).then((code) => process.exit(code));
}
```

Note: if `import.meta.url` CLI guard is awkward under vitest/tsx, omit the auto-run block and document `npx tsx scripts/wake-leads-agent.ts --org-id=...` calling `main` via a tiny bottom:

```ts
const isDirect =
  process.argv[1]?.endsWith("wake-leads-agent.ts") ||
  process.argv[1]?.endsWith("wake-leads-agent.js");
if (isDirect) {
  main(process.env, process.argv.slice(2)).then((c) => process.exit(c));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ads-agent && npx vitest run scripts/wake-leads-agent.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add ads-agent/scripts/wake-leads-agent.ts ads-agent/scripts/wake-leads-agent.test.ts
git commit -m "feat(agent): wake-leads stub script for S10"
```

---

### Task 5: Env stubs, runbook, openmemory

**Files:**
- Modify: `ads-agent/.env.example` (append AGENT_INTERNAL / LEADS / context-mcp notes)
- Create: `docs/superpowers/specs/2026-08-13-s10-leads-agent-runbook.md`
- Modify: `openmemory.md` Components row for S10 (mark design+plan; implementation status as this plan lands)

- [ ] **Step 1: Append to `.env.example`**

After the Hermes chat block, add:

```bash
# S10 — Hermes leads agent → context-MCP
# AGENT_INTERNAL_API_KEY=  # shared secret for POST /api/internal/agent/task-token (Hermes header x-agent-internal-key)
# LEADS_ORG_ID=            # uuid Hermes uses when minting (platform/internal org)
# Context MCP: docker compose up -d context-mcp  → http://localhost:8768/mcp
# Hermes MCP URL: http://host.docker.internal:8768/mcp
# AGENT_RO_DATABASE_URL=postgres://agent_ro:...@localhost:5433/gentle_space_listings
```

- [ ] **Step 2: Write runbook**

`docs/superpowers/specs/2026-08-13-s10-leads-agent-runbook.md` covering:

1. Start `context-mcp` (`cd ads-agent && docker compose up -d context-mcp`) with `AGENT_RO_DATABASE_URL` set (never owner `DATABASE_URL` on that service).
2. Set `AGENT_INTERNAL_API_KEY` in ads-agent `.env.local` and the same value in Hermes env.
3. Set `LEADS_ORG_ID` to a real org uuid.
4. Add Hermes MCP server `context-mcp` → `http://host.docker.internal:8768/mcp`.
5. Install skill: copy/link `docs/superpowers/hermes-skills/ads-agent/leads-enquiry-triage` into Hermes skills path; `/reload` as needed.
6. Manual gate checklist from the design spec (mint → tools → pending proposal).
7. Optional: `npx tsx scripts/wake-leads-agent.ts --org-id=...` (expect not-scheduled unless `HERMES_WAKE=1`).

- [ ] **Step 3: Update `openmemory.md`**

In Components, ensure S9 row stays; add or adjust:

`| S10 leads agent | Spec \`2026-08-13-s10-leads-agent-design.md\` + plan \`2026-08-13-s10-leads-agent.md\`; mint \`POST /api/internal/agent/task-token\`; Hermes skill \`leads-enquiry-triage\`; wake stub. |`

In Implementation plans table, add a row for the S10 plan as in progress / landing.

- [ ] **Step 4: Commit**

```bash
git add ads-agent/.env.example \
  docs/superpowers/specs/2026-08-13-s10-leads-agent-runbook.md \
  openmemory.md
git commit -m "docs(s10): env stubs, leads runbook, openmemory"
```

---

## Manual gate (after Tasks 1–5)

Not a subagent task — operator runs:

1. Migrations already include `100`–`106`.
2. `docker compose up -d context-mcp` in `ads-agent`.
3. ads-agent `npm run dev` on `:3030` with `AGENT_INTERNAL_API_KEY` set.
4. Hermes chat as `leads` with skill loaded.
5. Confirm pending proposal in DB / `/proposals`.

---

## Spec coverage self-review

| Spec requirement | Task |
|---|---|
| Mint HTTP API + auth header | Task 2 |
| Server-owned leads allowlist / TTL | Task 1 + 2 |
| Hermes skill workflow | Task 3 |
| Manual gate documented | Task 5 runbook |
| Cron/wake stub | Task 4 |
| Env stubs | Task 5 |
| No Kanban / no app-data expansion | Global constraints |
| Both proposal kinds | Task 3 skill |

Placeholder scan: none intentional.

Type consistency: `LEADS_TOOL_ALLOWLIST` name shared Task 1 → Task 2; header `x-agent-internal-key`; env `AGENT_INTERNAL_API_KEY`.
