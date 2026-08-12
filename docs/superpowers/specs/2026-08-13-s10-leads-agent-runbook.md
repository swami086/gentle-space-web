# Runbook: S10 Hermes `leads` profile + context-MCP

Operator steps to run the first autonomous enquiry-triage agent locally. Hermes stays in
`~/hermes-agent` (out of repo); this runbook wires it to ads-agent's context-MCP and mint API.

**Related:** [`2026-08-13-s10-leads-agent-design.md`](2026-08-13-s10-leads-agent-design.md),
[`2026-08-13-s10-leads-agent.md`](../plans/2026-08-13-s10-leads-agent.md),
skill [`docs/superpowers/hermes-skills/ads-agent/leads-enquiry-triage/SKILL.md`](../hermes-skills/ads-agent/leads-enquiry-triage/SKILL.md).

## Prerequisites

- S9 migrations `100`–`106` applied on the consolidated Postgres instance.
- `ads-agent/.env.local` with owner `DATABASE_URL` and normal dev secrets.
- Hermes container running with API server enabled (`HERMES_API_SERVER_ENABLED=true` in
  `~/.hermes/.env`).

## 1. Start context-MCP

From `ads-agent/`:

```bash
docker compose up -d context-mcp
```

The `context-mcp` service uses **`AGENT_RO_DATABASE_URL` only** — never owner `DATABASE_URL`.
Compose sets `postgres://agent_ro:agent_ro_local_dev@db:5432/ads_agent` against the local `db`
service. Do not point context-MCP at the owner pool; `agent_ro` has no INSERT on proposals and
cannot mint task tokens.

Verify: `curl -s -o /dev/null -w "%{http_code}" http://localhost:8768/mcp` should not connection-refuse.

## 2. Set mint API secret (ads-agent + Hermes)

Generate a random shared secret (e.g. `openssl rand -hex 32`).

**ads-agent** — add to `.env.local`:

```bash
AGENT_INTERNAL_API_KEY=<same-secret>
```

**Hermes** — add the same value to `~/.hermes/.env` (or the profile env block Hermes reads).

This key is distinct from auth-service `AUTH_SERVICE_INTERNAL_API_KEY` / `x-internal-api-key`.
The mint route expects header **`x-agent-internal-key`**.

## 3. Set `LEADS_ORG_ID`

Pick a real org UUID Hermes should act as when minting tokens. For local dev, the platform/internal
seed (`00000000-0000-0000-0000-000000000001`) or any org with enquiry data works.

**Hermes env:**

```bash
LEADS_ORG_ID=<uuid>
ADS_AGENT_BASE_URL=http://host.docker.internal:3030
```

(`ADS_AGENT_BASE_URL` is read by the skill; Docker Desktop Mac uses `host.docker.internal` to reach
the host-published ads-agent port.)

## 4. Register context-MCP in Hermes

In `~/.hermes/config.yaml`, add an MCP server entry:

```yaml
context-mcp:
  url: http://host.docker.internal:8768/mcp
```

`CONTEXT_MCP_ALLOWED_HOSTS` in compose already includes `host.docker.internal`. Reload MCP in Hermes
(`/reload-mcp` or restart) until tools such as `list_enquiries` and `create_proposal` appear.

## 5. Install the leads skill

Copy or symlink the in-repo skill into Hermes's skills directory:

```bash
# Example — adjust target to your Hermes skills path
ln -sf "$(pwd)/docs/superpowers/hermes-skills/ads-agent/leads-enquiry-triage" \
  ~/.hermes/skills/leads-enquiry-triage
```

Reload skills in Hermes as needed. Chat as profile **`leads`** with `leads-enquiry-triage` loaded.

## 6. Start ads-agent

```bash
cd ads-agent && npm run dev
```

Default dev port **3030**. Mint endpoint:
`POST http://localhost:3030/api/internal/agent/task-token`.

## 7. Manual acceptance gate

Run through this checklist before marking S10 done:

| # | Check |
|---|--------|
| 1 | `context-mcp` listening on `:8768` with `AGENT_RO_DATABASE_URL` (no owner URL on that service) |
| 2 | Hermes mints a token (`POST …/task-token` with `x-agent-internal-key`) and calls context-MCP tools |
| 3 | One row in `adsagent.proposals`: `status = pending`, `proposed_by = 'leads'`, kind ∈ `{enquiry.requirement_update, message.draft}`, non-empty `evidence`, `executed_at` null |
| 4 | Proposal visible in admin **`/proposals`** |
| 5 | No send/execute occurred from the agent path |

Suggested Hermes prompt: triage a waiting enquiry, call `get_context_pack`, propose a requirement
update or message draft with evidence IDs from the pack only.

## 8. Optional: wake stub

Future cron path (not scheduled in S10):

```bash
cd ads-agent
npx tsx scripts/wake-leads-agent.ts --org-id=<uuid>
# prints "not scheduled" and exits 0

HERMES_WAKE=1 npx tsx scripts/wake-leads-agent.ts --org-id=<uuid>
# stub only — Hermes API invoke deferred
```

Optional `--enquiry-id=<uuid>`. Do not register node-cron until S12 Kanban wiring exists.

## Troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| Mint 401 | `AGENT_INTERNAL_API_KEY` mismatch between ads-agent and Hermes, or missing `x-agent-internal-key` header |
| MCP connection refused from Hermes | context-MCP not up, or wrong URL (use `host.docker.internal:8768` from Docker Desktop) |
| `token_*` / tool denied | Expired token, wrong allowlist, or profile not `leads` |
| `evidence_empty` | Skill proposed without IDs from `get_context_pack` |
| Empty enquiry list | Wrong `LEADS_ORG_ID` or no enquiries for that tenant |

Never log or commit raw task tokens.
