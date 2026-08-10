# Hermes agent bridge (ads-agent Phase 1) — design

Date: 2026-08-10
Status: approved (pending user review of this written spec)
Related: extends [`docs/superpowers/specs/2026-08-07-google-ads-mcp-integration-design.md`](2026-08-07-google-ads-mcp-integration-design.md)
(implemented — Google Ads MCP server, read/write tool split, human-approval gate) and
[`docs/superpowers/specs/2026-08-03-ads-automation-agent-design.md`](2026-08-03-ads-automation-agent-design.md)
(implemented — proposals/executor/decision-engine pipeline). Prepares the ground for a future
Hermes agent deployment (self-improving, persistent-memory AI agent — open source, skill-learning
loop) discussed and approved in-session; this spec covers only the part that is code in this repo.

## Problem

Hermes is designed to run as an always-on, separate service with its own skill-authoring loop,
social-listening tools (Semrush, Composio → LinkedIn/Meta), and advanced multi-step workflows. None
of that is code in `GentleSpace_Web` — it is a service we would deploy and configure independently.
What *is* missing from this repo is the bridge that lets such an external agent safely affect
`ads-agent` without bypassing the existing human-approval pipeline, and two related gaps this design
surfaces along the way:

1. **No safe write surface for an external agent.** `ads-agent`'s only two write paths into
   `proposals` today are the decision-engine cron (`cycle.ts`) and the campaign-draft-chat UI
   (`create-proposal/route.ts`) — both internal. There is no MCP tool an external caller (Hermes) can
   invoke to create a proposal; giving it one of the existing Google Ads MCP write tools
   (`create_campaign`, `pause_campaign`, ...) would let it mutate the ad platform directly, bypassing
   approval entirely — unacceptable per every existing non-goal about unsupervised spend.
2. **No proposal shape for a narrative recommendation.** `ProposalKind` is
   `"create_campaign" | "pause" | "budget_change" | "add_negative_keyword"` — four atomic, single-action
   mutations. A Hermes-style "campaign strategy" suggestion (a written analysis plus several
   recommended next steps, not one mutation) has no `kind` to be created under.
3. **Executor silent-failure gap** (found by reading, not hypothetical): `executeProposal`'s
   `switch (proposal.kind)` in `ads-agent/lib/executor/execute.ts:99-112` has **no `default` case**.
   Approving a proposal whose `kind` isn't one of the four handled today falls through the switch,
   then unconditionally hits `markProposalExecuted(proposalId)` — the proposal is recorded as
   successfully executed having done *nothing*. Adding a fifth kind without also fixing this makes
   the bug live immediately.
4. **The Google Ads MCP server can't be reached from another container.** It runs only as a local
   `tsx` process (`npm run mcp:google-ads`) bound to `localhost` — a future Hermes container (or any
   other containerized MCP client) cannot reach `localhost:8766` inside a different container's
   network namespace.
5. **Production gap found by reading `deploy/docker-compose.prod.yml`**: the `ads-agent` service's
   `environment:` block sets all 5 Google Ads *credential* vars but never sets `GOOGLE_ADS_MCP_URL`.
   `lib/bifrost/google-ads-mcp-tools.ts` falls back to `http://localhost:8766/mcp` when the env var is
   unset — inside the `ads-agent` container today, nothing listens on that address, so every
   `callGoogleAdsTool()` call in production silently fails (soft-fail paths swallow it: `cycle.ts`
   skips the snapshot, the executor marks the proposal failed) with no server ever having been reachable
   in the first place.

## Goals

1. Containerize the Google Ads MCP server as its own Compose service (`google-ads-mcp`), reachable by
   other containers on the same Compose network by service name — the seam any future MCP client
   (Hermes, or otherwise) plugs into. `npm run mcp:google-ads` (tsx-on-host) keeps working unchanged
   for local development without Docker.
2. Fix the production gap: `deploy/docker-compose.prod.yml`'s `ads-agent` service gets
   `GOOGLE_ADS_MCP_URL=http://google-ads-mcp:8766/mcp`, and depends on the new service starting first.
3. Replace the hardcoded `localhostHostValidation()` / `localhostOriginValidation()` guards in
   `mcp/google-ads-server/index.ts` with the SDK's configurable `hostHeaderValidation(allowlist)`,
   driven by a new `GOOGLE_ADS_MCP_ALLOWED_HOSTS` env var — so the server accepts requests whose
   `Host` header names the Compose service (`google-ads-mcp`) as well as `localhost`/`127.0.0.1`,
   without opening it to arbitrary hosts. (Origin validation needs no change — non-browser MCP
   clients send no `Origin` header at all, and the SDK already passes those through.)
4. Add `ProposalKind = "campaign_strategy"` for narrative, multi-recommendation proposals:
   `payload: { summary: string; recommendations: { title: string; rationale: string; suggestedAction?: string }[] }`.
   Widen the `proposals.kind` CHECK constraint in the database to match.
5. Close the executor gap: `executeProposal`'s switch gets an explicit `case "campaign_strategy":
   break;` (nothing to execute against an ad platform — it's advisory) and a `default: throw new
   Error(...)` so any future unhandled kind fails loudly instead of being marked executed.
6. Add one new MCP tool, `propose_change`, to the existing Google Ads MCP server — the *only* surface
   a future external agent (Hermes or otherwise) will ever call to affect `ads-agent`. It does nothing
   but validate its input and call `createProposal()`; it never touches the Google Ads or Meta APIs.
   Approval, rejection, and execution flow through the exact same `/approve` / `/reject` routes and
   `executeProposal` as every other proposal today.

## Non-goals

- **Deploying Hermes itself**, writing its skill files, or configuring its Semrush / Composio (LinkedIn,
  Meta) / Google Ads MCP client connections. Hermes is not code in this repo. Once it exists as a
  running service, pointing it at `propose_change` is a configuration step (its MCP client config +
  its own skill file telling it when to call the tool), documented as a rollout runbook at the end of
  this spec — not a plan task.
- **A dedicated `campaign_strategy` proposal-detail UI** (recommendation cards, etc.). The existing
  proposal detail page (`app/(admin)/proposals/[id]/page.tsx:40-45`) already renders `proposal.payload`
  as formatted JSON — sufficient for a human approver to read a narrative proposal today. A nicer
  rendering is a fast follow, not blocking.
- **Weakening the human-approval gate in any way.** `propose_change` creates a `pending` row and
  nothing else; every non-goal from the original ads-automation-agent-design and the Google Ads MCP
  integration design about unsupervised spend holds unchanged.
- **Exposing the Google Ads MCP server (including the new `propose_change` tool) outside the Compose
  network.** Production: no `ports:` publish, `expose:` only (matches the existing `bifrost` service
  pattern). Local dev: `ports:` publish is for host-process convenience only (matches the existing
  `twenty-mcp-gateway` pattern), not a security boundary change.
- **Meta Ads / Composio / Semrush tool wiring.** Unaffected, unchanged, out of scope for this spec.

## Approaches considered

### How an external agent (Hermes) gets write access

| # | Approach | Trade-off |
|---|----------|-----------|
| A (chosen) | New `propose_change` MCP tool that wraps `createProposal()` only — never calls a connector | Matches the existing human-gate precedent exactly (the 4 existing write tools are already never advertised to *internal* chat; this one is designed to be called by an *external* agent, but still never mutates an ad platform itself) |
| B | Give Hermes one of the existing write tools (`create_campaign`, etc.) directly | Rejected — an external, self-directed agent calling `pause_campaign` directly has zero approval gate; contradicts every non-goal in every prior ads-agent spec about unsupervised spend |

**Decision:** A.

### Where the strategy narrative lives

| # | Approach | Trade-off |
|---|----------|-----------|
| A (chosen) | New `ProposalKind = "campaign_strategy"`, reuses the existing `proposals` table (already `payload JSONB`) | Zero new tables, zero new API routes/UI — `listProposals`/`getProposalById`/approve/reject/the admin list page all work unchanged, since none of them switch on `kind` except the executor and the one `create_campaign`-specific edit form |
| B | Separate `strategy_proposals` table + its own API routes and list UI | Rejected — duplicates the entire approve/reject/list surface for a shape that fits the existing `payload JSONB` column fine |

**Decision:** A.

### Host/Origin validation once the server is containerized

| # | Approach | Trade-off |
|---|----------|-----------|
| A (chosen) | Swap `localhostHostValidation()` → `hostHeaderValidation(allowlistFromEnv())`; leave Origin validation as-is | `@modelcontextprotocol/node` ships this exact configurable variant (`hostHeaderValidation(allowedHostnames)`, confirmed in its README and dist source) for precisely this case; Origin validation already passes requests with no `Origin` header, which is what non-browser MCP clients send, so it needs no change under containerization |
| B | Keep `localhostHostValidation()`, front the container with a reverse proxy that rewrites `Host` to `localhost` | Rejected — adds a whole proxy process to route around a guard that already has a first-class configurable API |

**Decision:** A.

### How the container is built

| # | Approach | Trade-off |
|---|----------|-----------|
| A (chosen) | New Compose service reusing the existing `ads-agent` image (`build: ../ads-agent` / `build: .`), `command:` override to run `npx tsx scripts/run-google-ads-mcp.ts` instead of the default `next start` | `ads-agent/Dockerfile` already does a full (non-`--production`) `npm install` + `COPY . .`, so `tsx`, `scripts/`, and `mcp/` are already present in that image — zero new Dockerfile |
| B | Dedicated `Dockerfile.mcp` with a slimmer dependency set | Rejected — duplicates the entire install/copy layer to shave a script this small; YAGNI until the image size actually matters |

**Decision:** A.

## Architecture

```text
ads-agent/
  lib/
    types.ts                          MODIFIED — ProposalKind gains "campaign_strategy";
                                       new CampaignStrategyPayload type
    db/
      schema.sql                      MODIFIED — proposals.kind CHECK constraint widened
                                       (idempotent ALTER, since migrate.ts just re-runs this
                                       whole file — CREATE TABLE IF NOT EXISTS is a no-op on
                                       an already-existing table)
    executor/
      execute.ts                      MODIFIED — switch gains `case "campaign_strategy": break;`
                                       and `default: throw`
      execute.test.ts                 MODIFIED — new cases for both

  mcp/google-ads-server/
    index.ts                          MODIFIED — 8th tool `propose_change`; swaps
                                       localhostHostValidation()/localhostOriginValidation()
                                       for hostHeaderValidation(allowlist)/unchanged origin guard
    index.test.ts                     MODIFIED — new tool test + allowlist test
    tools.ts                          MODIFIED — new `proposeChange()` wrapping createProposal()
    tools.test.ts                     MODIFIED — new test

  lib/bifrost/
    google-ads-mcp-tools.ts           MODIFIED — GOOGLE_ADS_MCP_TOOLS.proposeChange constant
                                       (deliberately not added to GOOGLE_ADS_MCP_READ_TOOL_NAMES —
                                       stays invisible to internal Copilot/Reports chat, same as
                                       the other 4 write tools, by the existing allowlist pattern)

  .env.example                        MODIFIED — + GOOGLE_ADS_MCP_ALLOWED_HOSTS
  docker-compose.yml                  MODIFIED — new `google-ads-mcp` service (local dev)

deploy/
  docker-compose.prod.yml             MODIFIED — new `google-ads-mcp` service; `ads-agent`
                                       service gains GOOGLE_ADS_MCP_URL + depends_on
```

### `propose_change` tool contract

```typescript
inputSchema: z.object({
  kind: z.enum(["create_campaign", "pause", "budget_change", "add_negative_keyword", "campaign_strategy"]),
  campaignId: z.string().nullable(),
  payload: z.record(z.string(), z.unknown()),
  triggeredRule: z.string(),
  rationale: z.string().optional(),
})
// returns: { proposalId: string }
```

`triggeredRule` is free text identifying the caller (e.g. `"hermes:campaign_strategy"`) — reuses the
existing column every other proposal already populates (`kill_rule`, etc.) rather than adding a new
"source" column.

### Data flow: an external agent creates a proposal

```
(future) Hermes container
  → google-ads-mcp:8766/mcp  (Compose service name, not localhost)
    → index.ts "propose_change" tool
      → tools.ts proposeChange(input)
        → lib/db/proposals.ts createProposal(input)   [status: "pending"]
  ← { proposalId }

  ... human reviews in /proposals/[id] (existing page, payload renders as formatted JSON) ...

  → POST /api/proposals/[id]/approve  (existing route, unchanged)
    → decideProposal(id, "approved")
    → executeProposal(id)
      → switch (proposal.kind) {
          case "campaign_strategy": break;   // NEW — advisory only, nothing to execute
          default: throw ...                  // NEW — closes the silent-failure gap
        }
      → markProposalExecuted(id)
```

### Docker Compose additions

`ads-agent/docker-compose.yml` (local dev — host processes still run via `npm run dev`/`worker`,
reach this container via the published port, exactly like `twenty-mcp-gateway` today):

```yaml
  google-ads-mcp:
    build: .
    command: ["npx", "tsx", "scripts/run-google-ads-mcp.ts"]
    env_file:
      - .env.local
    environment:
      GOOGLE_ADS_MCP_ALLOWED_HOSTS: localhost,127.0.0.1,google-ads-mcp
    ports:
      - "8766:8766"
    restart: unless-stopped
```

`deploy/docker-compose.prod.yml` (internal-only, matches the existing `bifrost` service — `expose:`,
never `ports:`):

```yaml
  google-ads-mcp:
    build: ../ads-agent
    command: ["npx", "tsx", "scripts/run-google-ads-mcp.ts"]
    networks:
      - default
    environment:
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

...and the existing `ads-agent` service in the same file gains:

```yaml
      GOOGLE_ADS_MCP_URL: http://google-ads-mcp:8766/mcp
```

plus `depends_on: google-ads-mcp: condition: service_started` alongside its existing `ads-db`/`bifrost`
dependencies.

## Error handling

- **`propose_change` called with an invalid `kind`**: rejected by the Zod `inputSchema` at the MCP
  layer before `tools.ts` ever runs — same mechanism as every other tool's `inputSchema`.
- **`createProposal()` throws (e.g. DB unreachable)**: the MCP tool handler returns an error result
  (`isError: true`) through the existing `callTool()` contract — identical to how Google Ads API
  errors already propagate from the 4 existing write tools.
- **A proposal with an unrecognized `kind` reaches the executor** (e.g. a future kind added without an
  executor case): `default: throw` — `executeProposal` catches it in its existing `try/catch` and
  calls `markProposalFailed`, exactly like a connector error today. It is never silently marked
  executed again.
- **Host header from an unlisted caller**: `hostHeaderValidation` answers `403` with a JSON-RPC error
  body — identical behavior to today's `localhostHostValidation()`, just against a wider (still
  explicit) allowlist.

## Testing

- `mcp/google-ads-server/tools.test.ts` — `proposeChange()` calls `createProposal()` with the mapped
  input and returns `{ proposalId }`.
- `mcp/google-ads-server/index.test.ts` — registers 8 tools total; `propose_change` calls
  `proposeChange()` with parsed input; a request with an unlisted `Host` header is rejected (403) when
  `GOOGLE_ADS_MCP_ALLOWED_HOSTS` doesn't include it, and accepted when it does.
- `lib/executor/execute.test.ts` — `campaign_strategy` proposals execute as a no-op and are marked
  executed; an unrecognized `kind` is marked failed (via the new `default: throw`), not executed.
- `lib/db/proposals.test.ts` (if one exists) / a new integration-style check — `createProposal({kind:
  "campaign_strategy", ...})` succeeds against the widened CHECK constraint.
- Manual (Compose): `docker compose up -d google-ads-mcp` in `ads-agent/`, confirm
  `docker compose logs google-ads-mcp` shows it listening, and that a host-side `npm run mcp:google-ads`
  invocation of the *same* code path still works unchanged (regression check for the tsx-on-host flow).

## Rollout runbook (manual — not a plan task)

Deferred until Hermes itself is deployed:

1. Deploy Hermes as its own container on the same Docker network as `ads-agent`/`google-ads-mcp`
   (either join the existing Compose network or run it in its own Compose file with `networks:
   external: true` pointed at this one).
2. Configure Hermes' own MCP client to reach `http://google-ads-mcp:8766/mcp` and call only
   `propose_change` (never the 4 ad-platform write tools).
3. Author Hermes' Google Ads skill file(s) describing when/how to call `propose_change` with
   `kind: "campaign_strategy"`.
4. Configure Hermes' own Semrush API key / Composio connections for LinkedIn and Meta — unrelated to
   this repo's code; those are Hermes-side MCP client configurations.
5. Verify end-to-end: Hermes calls `propose_change` → a `pending` proposal appears in
   `/proposals` → a human approves → `executeProposal` no-ops cleanly for `campaign_strategy`.

## Success criteria

- [x] `docker compose up -d google-ads-mcp` (from `ads-agent/`) starts the server; `listTools()`
      against `http://localhost:8766/mcp` (published port) returns 8 tools.
      (Verified 2026-08-10 after adding `GOOGLE_ADS_MCP_BIND=0.0.0.0` — localhost-only bind
      inside the container was unreachable via Docker publish/Compose DNS.)
- [x] `npm run mcp:google-ads` (tsx-on-host, unchanged) still works — regression check.
      (`resolveGoogleAdsMcpBind()` defaults to `localhost` when unset; Compose sets `0.0.0.0`.)
- [x] `deploy/docker-compose.prod.yml`'s `ads-agent` service has `GOOGLE_ADS_MCP_URL` pointed at the
      new service's Compose DNS name.
- [x] A request to the MCP server with a `Host` header outside `GOOGLE_ADS_MCP_ALLOWED_HOSTS` gets
      403; one matching an entry in the allowlist succeeds.
      (Covered by `hostHeaderValidation(resolveGoogleAdsMcpAllowedHosts())` + unit tests for the
      allowlist resolver; live HTTP 403 not re-exercised beyond unit coverage.)
- [x] `createProposal({ kind: "campaign_strategy", ... })` succeeds against the live (migrated)
      schema. (`npm run migrate` applied the idempotent `ALTER TABLE` on 2026-08-10; unit test
      covers the createProposal call path.)
- [x] Approving a `campaign_strategy` proposal marks it `executed` without calling any connector.
- [x] Approving a proposal with a `kind` unknown to the executor's switch marks it `failed` (not
      silently `executed`).
- [x] `npm run build && npm run lint && npm test` pass with zero new warnings.
      (`npm test` 573/7 skip; `npm run build` OK; scoped eslint on changed TS files clean.
      Repo-wide `tsc`/`eslint` still carry pre-existing OpenUI-test noise unrelated to this branch.)

## Implementation order (high level — informs task breakdown in the writing-plans doc)

1. `lib/types.ts` + `lib/db/schema.sql` — new `ProposalKind`/`CampaignStrategyPayload` type, widened
   CHECK constraint.
2. `lib/executor/execute.ts` + test — `campaign_strategy` no-op case, `default: throw`.
3. `mcp/google-ads-server/tools.ts` + `index.ts` + tests — `propose_change` tool, host-validation
   allowlist swap.
4. `.env.example` + `ads-agent/docker-compose.yml` + `deploy/docker-compose.prod.yml` — the new
   `google-ads-mcp` service, prod `ads-agent` env/depends_on fix.

Detailed task breakdown follows in a writing-plans doc after this spec is reviewed.
