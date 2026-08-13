# S14 — `performance` and `campaign` agents runbook

Date: 2026-08-13  
Status: operational (CI gate + docs; **live Hermes E2E operator-run**)  
Build step: **S14** ([`2026-08-12-build-sequence.md`](2026-08-12-build-sequence.md))  
Plan: [`2026-08-13-s14-performance-campaign-agents.md`](../plans/2026-08-13-s14-performance-campaign-agents.md)  
Design: [`2026-08-13-s14-performance-campaign-agents-design.md`](2026-08-13-s14-performance-campaign-agents-design.md)

Deterministic CI covers allowlists, Ads read-only inventory, proposal-kind matrix, and ClickHouse
replica invariants (`ads-agent/lib/agent/s14-gate.test.ts` when present; unit tests in
`performance-tools`, `campaign-tools`, `read-performance.test.ts`).

Full **two-profile Hermes E2E** against local Docker ClickHouse remains **manual** (same posture as
S10/S12). **Never log raw task tokens or SHA-256 digests.**

## Prerequisites

| Component | Requirement |
|---|---|
| **Docker ClickHouse** | `docker compose -f docker-compose.clickhouse.yml up -d` from repo root; apply migrations: `npx tsx --env-file=ads-agent/.env.local scripts/clickhouse/migrate.ts` |
| **context-mcp** | `docker compose up -d context-mcp` from `ads-agent/`; must have `AGENT_CLICKHOUSE_URL`, `AGENT_CLICKHOUSE_USER`, `AGENT_CLICKHOUSE_PASSWORD` (see below). Uses **`AGENT_RO_DATABASE_URL` only** — never owner `DATABASE_URL`. |
| **ads-agent** | Dev server on `:3030` with `AGENT_INTERNAL_API_KEY` set |
| **Hermes** | Container with API server enabled (`HERMES_API_SERVER_ENABLED=true` in `~/.hermes/.env`) |
| **Google Ads MCP** (optional) | `docker compose up -d google-ads-mcp` from `ads-agent/` when exercising option‑3 read enrichment; **not required** for replica gate items 1–5 |

Verify context-mcp: `curl -s -o /dev/null -w "%{http_code}" http://localhost:8768/mcp` should not connection-refuse.

## ClickHouse seed — `campaign_performance_daily`

The S14 gate requires `get_campaign_performance` to return rows for the test tenant from
**ClickHouse** (`campaign_performance_daily`), not Postgres `adsagent.performance_snapshots`.

### Preferred: existing CDC replicate

When the org already has Postgres campaign snapshot data and performance CDC is wired, run the
existing replicator (same pattern as enquiries):

```bash
# From repo root — today replicates enquiries; extend/wire performance CDC when available
npx tsx --env-file=ads-agent/.env.local scripts/clickhouse/replicate.ts
```

Use a tenant (`PERFORMANCE_ORG_ID` / `CAMPAIGN_ORG_ID`) that has rows in
`adsagent.performance_snapshots` and a populated ClickHouse mirror. Do **not** add a second seed
framework — reuse `lib/clickhouse/replicate.ts` / `scripts/clickhouse/replicate.ts`.

### Fallback: minimal table + INSERT (local empty mirror)

`campaign_performance_daily` may not exist in CH yet (see
[`2026-08-12-pg-clickhouse-fdw-design.md`](2026-08-12-pg-clickhouse-fdw-design.md)). If
`get_campaign_performance` returns empty or `clickhouse_unavailable`, create the table once (DDL
aligned with `read-performance.ts`) and insert one row for the test org:

```sql
-- Run as etl_writer against http://127.0.0.1:8123 (after CH migrations)
CREATE TABLE IF NOT EXISTS campaign_performance_daily
(
  org_id          UUID,
  campaign_id     UUID,
  campaign_name   String,
  corridor        Nullable(String),
  day             Date,
  spend           Float64,
  clicks          UInt64,
  impressions     UInt64,
  conversions     Float64
)
ENGINE = MergeTree()
ORDER BY (org_id, day, campaign_id);

CREATE ROW POLICY IF NOT EXISTS campaign_performance_daily_tenant ON campaign_performance_daily
  USING org_id = toUUIDOrZero(getSetting('SQL_current_tenant_id'))
  TO ALL EXCEPT etl_writer;

INSERT INTO campaign_performance_daily
  (org_id, campaign_id, campaign_name, corridor, day, spend, clicks, impressions, conversions)
VALUES
  ('<PERFORMANCE_ORG_ID>', '<campaign-uuid>', 'E2E Test Campaign', 'Whitefield', today(), 1200.5, 40, 900, 3);
```

Confirm reads with tenant setting (same path context-mcp uses):

```bash
curl -s -u "agent_ro:<password>" \
  "http://127.0.0.1:8123/?readonly=1&default_format=JSONEachRow&SQL_current_tenant_id=<PERFORMANCE_ORG_ID>&param_window_days=7&param_corridor=" \
  --data-binary "SELECT campaign_id, any(campaign_name) AS campaign_name FROM campaign_performance_daily WHERE day >= today() - {window_days:UInt16} GROUP BY campaign_id LIMIT 5"
```

## ads-agent / context-mcp env (see `ads-agent/.env.example`)

```bash
# Context-mcp → ClickHouse replica (required for S14 gate)
AGENT_CLICKHOUSE_URL=http://127.0.0.1:8123          # host: docker compose uses http://clickhouse:8123
AGENT_CLICKHOUSE_USER=agent_ro
AGENT_CLICKHOUSE_PASSWORD=<local-dev-password>       # no secrets in git

# Mint API (Hermes → ads-agent)
AGENT_INTERNAL_API_KEY=<secret>

# Hermes profile org ids (may equal LEADS_ORG_ID locally)
PERFORMANCE_ORG_ID=<org-uuid>
CAMPAIGN_ORG_ID=<org-uuid>

ADS_AGENT_BASE_URL=http://host.docker.internal:3030  # Hermes → POST /api/internal/agent/task-token
```

Compose `context-mcp` sets `AGENT_CLICKHOUSE_URL: http://clickhouse:8123` when ClickHouse runs on
the Compose network; Hermes on Docker Desktop Mac reaches MCP via `http://host.docker.internal:8768/mcp`.

## Hermes profiles

Create two Hermes profiles on the gateway host:

| Profile | context-mcp tools (mint allowlist) | Proposal kinds |
|---|---|---|
| `performance` | `get_campaign_performance`, `get_context_pack`, `list_proposals`, `graph_query`, `create_proposal` | `campaign.pause` only |
| `campaign` | above + `search_spaces`, `get_space` | `campaign.create`, `campaign.budget_change` only |

Skills:

- [`performance-review`](../../hermes-skills/ads-agent/performance-review/SKILL.md)
- [`campaign-draft`](../../hermes-skills/ads-agent/campaign-draft/SKILL.md)
- Related: [`verification-before-proposing`](../../hermes-skills/ads-agent/verification-before-proposing/SKILL.md)

### `tools.include` — context-mcp + Ads read-only only

In `~/.hermes/config.yaml`, each profile's MCP toolsets must **include only** context-mcp tools
needed for the skill **plus** the three Google Ads MCP read tools. **Ban all write tools.**

**Allowed Google Ads MCP reads** (`GOOGLE_ADS_MCP_READ_TOOLS`):

- `list_campaign_performance`
- `search_terms_report`
- `list_accessible_customers`

**Forbidden on S14 profiles** (`GOOGLE_ADS_MCP_WRITE_TOOLS` — never in `tools.include`):

- `create_campaign`
- `pause_campaign`
- `update_campaign_budget`
- `add_negative_keyword`
- `propose_change`

Example (option‑3 enrichment — adjust server names to your Hermes config):

```yaml
mcp_servers:
  context-mcp:
    url: http://host.docker.internal:8768/mcp
  google-ads-mcp:
    url: http://host.docker.internal:8766/mcp
    tools:
      include:
        - list_campaign_performance
        - search_terms_report
        - list_accessible_customers
      # Do NOT include create_campaign, pause_campaign, update_campaign_budget,
      # add_negative_keyword, or propose_change — domain writes = context-mcp create_proposal only.
```

Domain mutations go **only** through context-mcp `create_proposal` → pending row in
`adsagent.proposals` → human approval at `/proposals`.

## Manual E2E gate

**Goal:** both profiles mint tokens, read ClickHouse analytics, queue **pending** spend proposals;
admin UI shows them; no execute/send from the agent path.

### 1. Performance → `campaign.pause`

```bash
cd ads-agent
HERMES_WAKE=1 npx tsx scripts/wake-performance-agent.ts --org-id=<PERFORMANCE_ORG_ID>
# optional: --corridor=Whitefield
```

In Hermes as profile **`performance`** with `performance-review` loaded:

1. Mint token (`profile: "performance"`, `orgId: PERFORMANCE_ORG_ID`).
2. **Required:** `get_campaign_performance` (must return CH rows for tenant).
3. Optional: one Ads MCP read tool when `:8766` is up.
4. `get_context_pack` for target campaign.
5. `create_proposal` with `kind: campaign.pause` and evidence = context-pack IDs only.

### 2. Campaign → `campaign.create` or `campaign.budget_change`

```bash
HERMES_WAKE=1 npx tsx scripts/wake-campaign-agent.ts --org-id=<CAMPAIGN_ORG_ID>
```

In Hermes as profile **`campaign`** with `campaign-draft` loaded:

1. Mint token (`profile: "campaign"`, `orgId: CAMPAIGN_ORG_ID`).
2. **Required:** `get_campaign_performance` before propose.
3. Optional Ads MCP reads; `search_spaces` / `get_space` for corridor drafting.
4. `create_proposal` with `kind: campaign.create` **or** `campaign.budget_change`.
5. If tool returns `stale_data_refusal`, stop and report — do not invent numbers.

### 3. Verify admin UI

Open ads-agent **`/proposals`**: at least one **pending** row with:

- `proposed_by ∈ {performance, campaign}`
- `kind ∈ {campaign.pause, campaign.create, campaign.budget_change}`
- non-empty `evidence`
- `executed_at` null
- no auto-approve / no platform execute from agent path

## PASS criteria (design §Acceptance gate)

| # | Check |
|---|--------|
| 1 | ClickHouse reachable from context-mcp (`AGENT_CLICKHOUSE_URL`); `get_campaign_performance` returns rows for test tenant |
| 2 | Hermes profiles `performance` and `campaign` mint tokens and call context-mcp |
| 3 | Performance metrics path uses **ClickHouse HTTP**, not Postgres `performance_snapshots` / OLTP (unit tests + E2E observation) |
| 4 | ≥1 pending proposal from `performance` or `campaign` with allowed kind and evidence |
| 5 | Proposal visible in `/proposals`; human approval unchanged; no agent execute |
| 6 | **Option‑3:** when Google Ads MCP is up, profile calls a read tool without platform writes. **When Ads is down, skip step 6 — CH-only still satisfies gate items 1–5** |

## Live E2E notes (2026-08-13 local)

Automated smoke (no interactive Hermes chat):

```bash
cd ads-agent
# Requires seeded CH table + AGENT_CLICKHOUSE_* + AGENT_RO_DATABASE_URL + DATABASE_URL
npx tsx scripts/s14-live-e2e.ts
```

Observed on this machine:

1. **CH seed:** created `campaign_performance_daily` + tenant row policy; inserted one row for platform org.
2. **CH client fixes** (required for live CH 25.8): use `readonly=2` (not `1`) so `SQL_current_tenant_id` can be set; rename param to `corridor_filter` and alias `corridor_label` to avoid `ILLEGAL_AGGREGATION`.
3. **agent_ro grants:** re-applied `GRANT SELECT ON context.v_agent_graph_manifest` (and related) — missing on consolidated `:5433` despite migration 105.
4. **Result:** `get_campaign_performance` returned CH rows; pending `campaign.pause` from `proposed_by=performance`; `campaign.budget_change` correctly hit `stale_data_refusal` (CDC lag).
5. **Hermes chat profiles:** gateway currently only lists `default` — create Hermes profiles `performance` / `campaign` + MCP wiring before interactive two-profile chat. Wake stubs log only until Hermes API invoke is wired.
6. **Google Ads MCP** `:8766` up (HTTP 405 on bare `/mcp` is expected for non-MCP clients); option‑3 read smoke deferred until Hermes profiles exist.

## Deterministic CI (no Hermes)


```bash
cd ads-agent
npx vitest run lib/agent/s14-gate.test.ts
npx vitest run lib/agent/performance-tools.test.ts lib/agent/campaign-tools.test.ts
npx vitest run mcp/context-server/read-performance.test.ts
```

## Abort criteria

Stop and fix before retrying if:

- `AGENT_CLICKHOUSE_URL` unset on context-mcp (agents must **not** fall back to Postgres analytics).
- Mint returns `403 forbidden_profile` or `401` (bad internal key).
- `create_proposal` with empty evidence (`evidence_empty`).
- Google Ads write tool invoked from Hermes profile (security violation).
- `stale_data_refusal` on create/budget — report lag; do not bypass.

## Out of scope

- Enabling Ads write tools on S14 Hermes profiles.
- Meta Ads MCP.
- Production VM Hermes rollout.
- Server-side profile→kind lock in `create_proposal` (deferred; skills + gate tests enforce).
