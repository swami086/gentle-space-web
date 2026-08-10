# Install Hermes Agent as a container + wire it to the ads-agent bridge — design

Date: 2026-08-10
Status: approved (pending user review of this written spec)
Related: completes the deferred "Rollout runbook" section of
[`docs/superpowers/specs/2026-08-10-hermes-agent-ads-ops-design.md`](2026-08-10-hermes-agent-ads-ops-design.md)
(implemented — `propose_change` MCP tool, `campaign_strategy` proposal kind, containerized Google
Ads MCP server). That spec explicitly listed "deploying Hermes itself" as a non-goal, deferred until
Hermes exists as a running service. This spec is that deployment.

## Problem

The Google Ads MCP bridge (`propose_change`) is implemented and smoke-tested, but there is no agent
on the other end of it yet. Hermes Agent (NousResearch/hermes-agent — a self-improving, MCP-capable
AI agent, open source) needs to actually run as a container, reach `ads-agent`'s Google Ads MCP
server, and know when to call `propose_change`.

## Goals

1. Run Hermes as a Docker container on the local Mac, using its own upstream `docker-compose.yml`
   (cloned from `github.com/NousResearch/hermes-agent`), reachable via CLI (`hermes chat`) and its
   local web dashboard (`http://localhost:9119`, loopback-only).
2. Configure Hermes to use Google AI Studio / Gemini as its model provider, with a high reasoning
   effort setting for detailed analysis.
3. Wire Hermes' MCP client to `ads-agent`'s already-running Google Ads MCP server
   (`http://localhost:8766/mcp`), exposing only the 3 read tools
   (`list_campaign_performance`, `search_terms_report`, `list_accessible_customers`) plus
   `propose_change` — never the 4 direct write tools (`create_campaign`, `pause_campaign`,
   `update_campaign_budget`, `add_negative_keyword`).
4. Enable Firecrawl-backed web search/extract (`web_search`, `web_extract`) so Hermes can research
   context beyond the ad account itself.
5. Author a Hermes skill file describing when/how to call `propose_change` with
   `kind: "campaign_strategy"`, matching the payload contract from the approved bridge design.
6. Verify end-to-end: ask Hermes (via `hermes chat`) to review Google Ads performance and propose a
   strategy → confirm a new `pending` `campaign_strategy` proposal appears at
   `http://localhost:3030/proposals`.

## Non-goals

- **Committing the Hermes source tree into `GentleSpace_Web`.** Hermes is a large (21k+ commit),
  independently-released open-source project — it is cloned to a sibling directory
  (`~/hermes-agent`, outside this repo) and run from its own `docker-compose.yml`. Nothing about the
  clone touches this repo's git history.
- **Any change to `ads-agent` code or Compose files.** The phase-1 bridge spec already published the
  MCP server on `8766:8766` with `GOOGLE_ADS_MCP_ALLOWED_HOSTS=localhost,127.0.0.1,google-ads-mcp` —
  that's sufficient for a host-network container to reach it. Nothing here modifies `ads-agent`.
- **Production VM deployment.** Local-machine install only, per user decision. Prod rollout (joining
  Hermes to `deploy/docker-compose.prod.yml`'s network, or running it on the VM) is a explicit later
  follow-up, not part of this spec.
- **Messaging platforms** (Telegram, Discord, Slack, etc.). CLI + dashboard only for this install.
- **Nous Portal / Tool Gateway.** User chose direct provider keys (Google AI Studio, Firecrawl)
  instead of the bundled subscription.
- **Semrush / Composio (LinkedIn, Meta) integration.** Explicitly out of scope per the original bridge
  design; unaffected by this spec.

## Approaches considered

### Where Hermes' source lives

| # | Approach | Trade-off |
|---|----------|-----------|
| A (chosen) | Clone `hermes-agent` to `~/hermes-agent`, a sibling directory outside `GentleSpace_Web` | Matches the explicit non-goal in the bridge design ("Hermes is not code in this repo"); zero risk of vendoring a 21k-commit foreign history into this repo |
| B | Clone inside `GentleSpace_Web` (e.g. `third_party/hermes-agent/`, gitignored) | Rejected — no benefit over a sibling directory, and increases the chance of accidentally `git add -A`-ing thousands of foreign files |

**Decision:** A.

### How Hermes reaches the Google Ads MCP server

| # | Approach | Trade-off |
|---|----------|-----------|
| A (chosen) | Use Hermes' upstream `docker-compose.yml` unmodified — it already runs with `network_mode: host`, so it sees `localhost:8766` (the port `ads-agent/docker-compose.yml` already publishes) directly | Zero networking changes anywhere; confirmed by reading both compose files |
| B | Put Hermes on the same custom bridge network as the `ads-agent` Compose stack, reach `google-ads-mcp` by Compose service name | Rejected — `ads-agent/docker-compose.yml` has no named external network for other stacks to join, and `network_mode: host` already solves this with no config; adding one would be unnecessary surface area |

**Decision:** A.

### Which MCP tools Hermes is allowed to see

| # | Approach | Trade-off |
|---|----------|-----------|
| A (chosen) | `tools.include` allowlist of exactly 4 tools: 3 reads + `propose_change` | Matches the bridge design's non-negotiable ("the only tool an external agent may ever call to affect ads-agent is `propose_change`") while still letting Hermes see real performance data to reason from |
| B | Expose all 8 tools, rely on the skill file's instructions alone to keep Hermes from calling write tools | Rejected — prompt-level instructions are not a security boundary; an allowlist enforced by Hermes' own MCP client config is one line of YAML and categorically prevents the write tools from ever being callable |

**Decision:** A.

### Web search backend

| # | Approach | Trade-off |
|---|----------|-----------|
| A (chosen) | `FIRECRAWL_API_KEY` in `~/.hermes/.env` — Hermes auto-detects Firecrawl as the `web_search`/`web_extract` backend, no `config.yaml` edit | Zero config, matches Hermes' documented default-provider behavior |
| B | Reuse the Cursor Firecrawl CLI's stored credential | Rejected — that credential file (`~/Library/Application Support/firecrawl-cli/credentials.json`, mode 0600) is a session/OAuth artifact scoped to the CLI tool itself, not a portable `fc-...` API key; extracting and repurposing it risks misuse of a credential outside its intended scope |

**Decision:** A. User supplies a fresh key from `firecrawl.dev` (free tier: 500 credits/mo).

## Architecture

```text
~/hermes-agent/                          Cloned from github.com/NousResearch/hermes-agent (not in
                                          this repo's git history)
  docker-compose.yml                     UNMODIFIED upstream file — network_mode: host, volumes
                                          ~/.hermes:/opt/data

~/.hermes/                               Hermes' data dir (host path — same one a native install
                                          would use)
  .env                                   NEW — GOOGLE_API_KEY, FIRECRAWL_API_KEY (secrets only)
  config.yaml                            NEW/MODIFIED — model.default, agent.reasoning_effort,
                                          mcp_servers.ads_agent (non-secret config)
  skills/
    ads-agent-campaign-strategy/
      SKILL.md                           NEW — when/how to call propose_change

ads-agent/ (already running, unmodified) — docker compose up -d google-ads-mcp
  → publishes localhost:8766 (Compose ports:, phase-1 bridge spec)

Hermes container (network_mode: host)
  → http://localhost:8766/mcp   (list_campaign_performance, search_terms_report,
                                  list_accessible_customers, propose_change only)
  → Google AI Studio API         (model calls)
  → Firecrawl API                (web_search / web_extract)
```

### `~/.hermes/config.yaml` additions

```yaml
model:
  default: "google/gemini-2.5-pro"

agent:
  reasoning_effort: "high"        # none | low | minimal | medium | high | xhigh

mcp_servers:
  ads_agent:
    url: "http://localhost:8766/mcp"
    tools:
      include:
        - list_campaign_performance
        - search_terms_report
        - list_accessible_customers
        - propose_change
```

### `~/.hermes/.env` additions (secrets — user-supplied)

```bash
GOOGLE_API_KEY=<from aistudio.google.com/app/apikey>
FIRECRAWL_API_KEY=<from firecrawl.dev>
```

### `~/.hermes/skills/ads-agent-campaign-strategy/SKILL.md`

Describes: when asked to review Google Ads performance or suggest a campaign strategy, call the 3
`mcp_ads_agent_*` read tools to gather real data, then call `mcp_ads_agent_propose_change` with:

```json
{
  "kind": "campaign_strategy",
  "campaignId": null,
  "payload": {
    "summary": "<one-paragraph narrative>",
    "recommendations": [
      { "title": "...", "rationale": "...", "suggestedAction": "..." }
    ]
  },
  "triggeredRule": "hermes:campaign_strategy",
  "rationale": "<why now>"
}
```

Explicitly states Hermes must never attempt to call a Google Ads write action directly — the skill
only ever calls `propose_change`, matching the bridge design's approval-gate guarantee. (This is also
structurally enforced by the `tools.include` allowlist above, which never registers the 4 write
tools with Hermes in the first place — the skill file is documentation of intent, not the security
boundary.)

## Data flow: end-to-end verification

```
docker compose exec hermes hermes chat
  > "Review our Google Ads performance for the last 7 days and propose a campaign strategy."
    → mcp_ads_agent_list_campaign_performance()
    → mcp_ads_agent_search_terms_report()
    → (Hermes reasons over the data, drafts a recommendation)
    → mcp_ads_agent_propose_change({ kind: "campaign_strategy", ... })
  ← "I've submitted a campaign_strategy proposal (id: ...) for your review."

  ... human opens http://localhost:3030/proposals/[id] (existing ads-agent page) ...
```

## Error handling

- **Google Ads MCP server unreachable** (`google-ads-mcp` container not running): Hermes' MCP client
  logs a connection failure at startup for the `ads_agent` server and simply doesn't register its
  tools — Hermes still starts and works for everything else. Fix: `cd ads-agent && docker compose up
  -d google-ads-mcp` before starting Hermes, or after (Hermes retries/`/reload-mcp`).
- **Missing `GOOGLE_API_KEY` / `FIRECRAWL_API_KEY`**: `hermes doctor` reports the missing credential;
  the affected capability (model calls / web search) is unavailable until supplied, everything else
  still runs.
- **Host header rejected by the Google Ads MCP server**: won't happen here — `GOOGLE_ADS_MCP_ALLOWED_HOSTS`
  already includes `localhost,127.0.0.1` (set during the phase-1 bridge work), and Hermes reaches the
  server via `network_mode: host` as `localhost:8766`.
- **Hermes calls `propose_change` with a malformed payload**: rejected by the tool's Zod
  `inputSchema` at the MCP layer (existing behavior, unchanged) — Hermes sees the validation error
  and can retry with a corrected payload.

## Testing

- `docker compose up -d` (from `~/hermes-agent`) → `docker compose ps` shows `hermes` and
  `hermes-dashboard` running.
- `docker compose exec hermes hermes doctor` → reports `GOOGLE_API_KEY` and `FIRECRAWL_API_KEY`
  present, no critical errors.
- `docker compose exec hermes hermes mcp list` (or equivalent) → `ads_agent` server connected, 4
  tools registered (not 8).
- Manual end-to-end: the "Data flow" scenario above — a `campaign_strategy` proposal appears at
  `http://localhost:3030/proposals` after asking Hermes to analyze performance.
- No automated test suite applies — this is host-machine service installation and YAML/Markdown
  configuration, not code in this repo.

## Success criteria

- [ ] `docker compose up -d` (from `~/hermes-agent`) starts `hermes` + `hermes-dashboard` with no
      crash; dashboard reachable at `http://localhost:9119`.
- [ ] `hermes doctor` (inside the container) reports both API keys present and no critical errors.
- [ ] Hermes' MCP client shows the `ads_agent` server connected with exactly 4 tools registered.
- [ ] Asking Hermes (via `hermes chat`) to review performance and propose a strategy results in a new
      `pending` `campaign_strategy` proposal visible at `http://localhost:3030/proposals`.
- [ ] Hermes successfully performs a `web_search` (Firecrawl-backed) when asked a question requiring
      current information.
- [ ] `agent.reasoning_effort: "high"` is active (verify via `/reasoning` in a `hermes chat` session).

## Rollout runbook (manual — this spec's execution)

1. Clone `github.com/NousResearch/hermes-agent` to `~/hermes-agent`.
2. Obtain `GOOGLE_API_KEY` (aistudio.google.com/app/apikey) and `FIRECRAWL_API_KEY` (firecrawl.dev)
   from the user; write both to `~/.hermes/.env` (0600).
3. Write `~/.hermes/config.yaml` with the `model`, `agent.reasoning_effort`, and `mcp_servers.ads_agent`
   blocks above.
4. Author `~/.hermes/skills/ads-agent-campaign-strategy/SKILL.md`.
5. Ensure `ads-agent`'s `google-ads-mcp` container is running (`docker compose up -d google-ads-mcp`
   from `ads-agent/`).
6. `HERMES_UID=$(id -u) HERMES_GID=$(id -g) docker compose up -d` from `~/hermes-agent`.
7. Run the verification steps in "Testing" above.
8. Check off this spec's success criteria as each is verified.
