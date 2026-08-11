# Install Hermes Agent as a Container + Wire the ads-agent Bridge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clone and run NousResearch/hermes-agent as a local Docker container, configure it with Google AI Studio (Gemini) as its model provider with high reasoning effort, Firecrawl-backed web search, and an MCP client connection to `ads-agent`'s already-running Google Ads MCP server (read tools + `propose_change` only), plus a Hermes skill file describing when to call `propose_change`.

**Architecture:** Hermes is cloned to `~/hermes-agent` (sibling to this repo, not tracked in its git history) and run via its own upstream `docker-compose.yml`, which uses `network_mode: host` — so it reaches `ads-agent`'s Google Ads MCP server at the published `localhost:8766` with zero networking changes to this repo. All Hermes configuration lives at `~/.hermes/` (`.env` for secrets, `config.yaml` for model/MCP/reasoning settings, `skills/` for the new campaign-strategy skill) — the same path a native (non-Docker) Hermes install would use.

**Tech Stack:** Docker Compose, YAML config, Markdown (Hermes skill format), no changes to any file inside `GentleSpace_Web`'s git repo.

**Related:** [`docs/superpowers/specs/2026-08-10-hermes-agent-container-install-design.md`](../specs/2026-08-10-hermes-agent-container-install-design.md) (approved design spec — read this first). Extends the already-implemented [`docs/superpowers/specs/2026-08-10-hermes-agent-ads-ops-design.md`](../specs/2026-08-10-hermes-agent-ads-ops-design.md) (Google Ads MCP `propose_change` tool, `campaign_strategy` proposal kind — both live and smoke-tested).

## Global Constraints

- Nothing in this plan modifies any file already tracked in `GentleSpace_Web`'s git repo — every file created or modified lives at `~/hermes-agent/` (a fresh git clone, its own history) or `~/.hermes/` (Hermes' data directory). Do not `git add` anything from this plan into `GentleSpace_Web`.
- Hermes' MCP client must only ever be configured to see 4 tools from the Google Ads MCP server: `list_campaign_performance`, `search_terms_report`, `list_accessible_customers`, `propose_change`. Never add the 4 write tools (`create_campaign`, `pause_campaign`, `update_campaign_budget`, `add_negative_keyword`) to the `tools.include` allowlist — this is the human-approval gate from the bridge design; do not weaken it.
- Reuse `ads-agent`'s existing, already-working Google Ads MCP server unchanged (`ads-agent/docker-compose.yml`'s `google-ads-mcp` service, already publishing `8766:8766` with `GOOGLE_ADS_MCP_ALLOWED_HOSTS=localhost,127.0.0.1,google-ads-mcp`). Do not edit `ads-agent/` files.
- Secrets (`GOOGLE_API_KEY`, `FIRECRAWL_API_KEY`) go only in `~/.hermes/.env` (create with `chmod 600`), never in `~/.hermes/config.yaml` or committed anywhere.
- Prefer Torbit MCP (`run_sql`/`get_graph_schema` against the local DuckDB graph) over `grep` when a subagent needs to understand either repo's structure. `GentleSpace_Web` is already indexed at `project_id = 1672773718350201492`, branch `main`. `~/hermes-agent` must be indexed (Torbit's `index` tool, `path: "/Users/swami/hermes-agent"`) as the last step of Task 1, before any later task queries it.
- This is host-machine service installation, not application code — there is no Vitest/pytest suite to run. Verification is via `docker compose`, `curl`/`nc`, and `hermes` CLI commands with concrete expected output, exactly as specified in each task below.

---

## Parallel Execution Waves

7 tasks total. Tasks 1–4 touch **disjoint locations** (a fresh clone directory, `~/.hermes/config.yaml`, `~/.hermes/skills/ads-agent-campaign-strategy/`, and `ads-agent/`'s already-existing Compose stack respectively) and share no state — dispatch all 4 as separate subagents in the same message per `superpowers:dispatching-parallel-agents`. Tasks 5–7 are sequential and are **not** subagents: Task 5 needs an interactive prompt to the user for two secret API keys (subagents cannot ask the user questions), Task 6 needs Tasks 1 and 5 both done first (the clone to build from, the `.env` to run with), and Task 7 is the final integration check that must observe the fully running system.

| Wave | Tasks | Depends on | Executor |
|---|---|---|---|
| 1 | Task 1 (clone + index Hermes), Task 2 (`config.yaml`), Task 3 (skill file), Task 4 (verify `ads-agent`'s MCP server) | — (nothing, start immediately) | 4 parallel subagents |
| 2 | Task 5 (collect secrets, write `.env`) | — (independent of Wave 1, but interactive) | Orchestrator (you), not a subagent |
| 3 | Task 6 (`docker compose up`, `hermes doctor`, MCP tool count) | Task 1 (clone must exist) + Task 5 (`.env` must exist) | 1 subagent |
| 4 | Task 7 (end-to-end verification, spec checkoff) | Task 6 | Orchestrator (you), not a subagent |

Peak parallel width is 4, well within the 8-subagent cap — there are exactly 4 genuinely independent deliverables here (a git clone, one YAML file, one Markdown file, one existing-service health check); forcing more parallelism would mean slicing one of these four coherent deliverables into pieces a reviewer couldn't meaningfully approve/reject independently, against the Task Right-Sizing guidance in `superpowers:writing-plans`.

## Execution Notes (deviations from the plan as written)

All 7 tasks completed and were verified end-to-end (real `propose_change` call, proposal confirmed `pending` in `ads-agent`'s `proposals` table). Three things changed from what's written above, discovered live during execution:

1. **Model provider: Vertex AI, not Google AI Studio.** Mid-execution, asked whether AI Studio's free-tier quota (small, per Hermes' own docs: *"too small for long-running agent sessions"*) was really the right call for a skill that does 3+ tool calls per turn. Switched to Google Vertex AI instead — same `google/gemini-2.5-pro` model, but OAuth2/service-account auth against GCP billing instead of a static `GOOGLE_API_KEY`. Reused an already-provisioned key at `.secrets/gentle-space-vertex-stackgen.json` (service account `gentle-space-vertex@propane-galaxy-498403-n8.iam.gserviceaccount.com`, already scoped `roles/aiplatform.user` on that project) rather than minting a new one. `config.yaml`'s `model:`/`vertex:` blocks and `.env`'s secret line differ from Task 2/5's written steps as a result — see the actual files at `~/.hermes/config.yaml` / `~/.hermes/.env` for the real shape.
2. **`VERTEX_CREDENTIALS_PATH` must be the container-side path, not the host path.** First attempt wrote the host path (`/Users/swami/.hermes/vertex-service-account.json`) into `.env`, which fails at chat time (`Vertex AI credentials could not be resolved`) — Hermes' container only sees that directory bind-mounted at `/opt/data`. Fixed to `/opt/data/vertex-service-account.json`.
3. **The Compose service is `gateway`, not `hermes`.** The container name is `hermes` (matches the plan), but `docker compose exec` addresses services, and the service is named `gateway` in upstream `docker-compose.yml`. Use `docker compose exec gateway ...` everywhere the plan says `docker compose exec hermes ...`.

`hermes doctor`'s "vendor-prefixed model slug with vertex provider" warning is a false positive — Hermes' own Vertex AI guide requires the `google/` prefix for Vertex model IDs; the generic doctor heuristic just doesn't know about that provider-specific exception.

Recommended skill per subagent (announce `Using engineering-skills2 → <skill>` for those; the other two are standalone skills, not part of the `engineering-skills2` bundle):

| Task | Deliverable | Recommended skill(s) |
|---|---|---|
| 1 | Clone + Torbit-index `~/hermes-agent` | `engineering-skills2 → senior-devops` (git/Docker-image source management) |
| 2 | `~/.hermes/config.yaml` | `~/.cursor/skills/anthropic-agent-skills/mcp-builder/SKILL.md` (MCP client config correctness) + `engineering-skills2 → senior-devops` (the model/reasoning config framing) |
| 3 | `~/.hermes/skills/ads-agent-campaign-strategy/SKILL.md` | `~/.cursor/skills/anthropic-agent-skills/skill-creator/SKILL.md` (skill-authoring structure/triggering) |
| 4 | Verify `ads-agent`'s `google-ads-mcp` container | `engineering-skills2 → senior-devops` (Docker Compose health verification) |
| 6 | `docker compose up` + `hermes doctor` | `engineering-skills2 → senior-devops` |

---

### Task 1: Clone Hermes Agent and index it with Torbit

**Files:**
- Create: `~/hermes-agent/` (fresh `git clone`, own history — not part of `GentleSpace_Web`)

**Interfaces:**
- Produces: a local clone at `/Users/swami/hermes-agent` containing the upstream `docker-compose.yml` and `Dockerfile` that Task 6 builds/runs; a Torbit-indexed graph of that repo other tasks may query instead of grepping.
- No dependency on any other task.

- [x] **Step 1: Clone the repository**

Run:
```bash
git clone https://github.com/NousResearch/hermes-agent.git /Users/swami/hermes-agent
```
Expected: clone completes with no error; `ls /Users/swami/hermes-agent/docker-compose.yml /Users/swami/hermes-agent/Dockerfile` both print the file paths (they exist).

- [x] **Step 2: Index the clone with Torbit**

Call the `user-torbit` MCP server's `index` tool with `{"path": "/Users/swami/hermes-agent"}`.

Expected: the tool returns graph statistics with no error (indexing a repo this size may take up to a couple of minutes — this is expected per the tool's own description, "seconds to minutes").

- [x] **Step 3: Verify the index**

Call the `user-torbit` MCP server's `run_sql` tool with:
```sql
SELECT repo_path, status, last_indexed_at FROM _orbit_manifest WHERE repo_path = '/Users/swami/hermes-agent'
```
Expected: one row, `status = 'indexed'`.

- [x] **Step 4: Confirm the compose file matches what this plan expects**

Run:
```bash
grep -c "network_mode: host" /Users/swami/hermes-agent/docker-compose.yml
```
Expected: `2` (the `gateway` and `dashboard` services both set it). If this returns `0`, the upstream compose file has changed since this plan was written — stop and report back before Task 6 runs, since Task 6's networking assumption (`localhost:8766` reachable with no extra config) depends on this.

**Return to the orchestrator:** confirmation that the clone exists, its indexed status, and the result of Step 4's grep count.

---

### Task 2: Write `~/.hermes/config.yaml`

**Files:**
- Create: `~/.hermes/config.yaml`

**Interfaces:**
- Produces: `model.default`, `agent.reasoning_effort`, and `mcp_servers.ads_agent` keys that Task 6's `hermes doctor`/`hermes mcp list` and Task 7's end-to-end chat test both depend on.
- No dependency on any other task (this file lives entirely outside both the `hermes-agent` clone and `GentleSpace_Web`).

- [x] **Step 1: Create the directory and file**

Run:
```bash
mkdir -p ~/.hermes
cat > ~/.hermes/config.yaml << 'EOF'
model:
  default: "google/gemini-2.5-pro"

agent:
  max_turns: 90
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
EOF
```

- [x] **Step 2: Verify it's well-formed YAML with the expected keys**

Run:
```bash
python3 -c "
import sys
try:
    import yaml
except ImportError:
    sys.exit('PyYAML not installed — run: pip3 install --user pyyaml, then re-run this check')
d = yaml.safe_load(open('/Users/swami/.hermes/config.yaml'))
assert d['model']['default'] == 'google/gemini-2.5-pro'
assert d['agent']['reasoning_effort'] == 'high'
tools = d['mcp_servers']['ads_agent']['tools']['include']
assert set(tools) == {'list_campaign_performance', 'search_terms_report', 'list_accessible_customers', 'propose_change'}, tools
print('OK:', d['model']['default'], d['agent']['reasoning_effort'], tools)
"
```
Expected: prints `OK: google/gemini-2.5-pro high [...]` with no `AssertionError`/`ImportError`. If `pyyaml` is missing, run `pip3 install --user pyyaml` once and re-run — this is a one-off local verification dependency, not a project dependency, so it is fine to install directly.

**Return to the orchestrator:** the verification script's output line.

---

### Task 3: Author the `ads-agent-campaign-strategy` Hermes skill

**Files:**
- Create: `~/.hermes/skills/ads-agent-campaign-strategy/SKILL.md`

**Interfaces:**
- Produces: a skill file Hermes auto-discovers from `~/.hermes/skills/` at startup, describing exactly when/how to call the `mcp_ads_agent_propose_change` tool (registered name once Task 2's MCP config connects — Hermes prefixes MCP tools `mcp_<server>_<tool>`, so `ads_agent`'s `propose_change` becomes `mcp_ads_agent_propose_change`, confirmed by reading Hermes' MCP docs).
- Consumes: the exact tool names Task 2 allowlists (`list_campaign_performance`, `search_terms_report`, `list_accessible_customers`, `propose_change`) and the `propose_change` payload contract from `docs/superpowers/specs/2026-08-10-hermes-agent-ads-ops-design.md` (`{kind, campaignId, payload: {summary, recommendations}, triggeredRule, rationale}`).
- No dependency on any other task's output existing yet — this is pure content authoring against a contract that's already fully specified.

- [x] **Step 1: Create the directory and file**

Run `mkdir -p ~/.hermes/skills/ads-agent-campaign-strategy`, then create `~/.hermes/skills/ads-agent-campaign-strategy/SKILL.md` with exactly this content (this follows the real frontmatter/section format used by Hermes' own shipped skills, e.g. `skills/research/grounded-citations/SKILL.md` in the cloned repo):

```markdown
---
name: ads-agent-campaign-strategy
description: "Review Google Ads performance and submit campaign strategy recommendations to ads-agent for human approval."
version: 1.0.0
author: Hermes Agent + GentleSpace
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [Google Ads, Marketing, Proposals, MCP]
    category: marketing
    related_skills: []
---

# Ads Agent Campaign Strategy

`ads-agent` (a separate service at GentleSpace Solutions) exposes a Google Ads MCP server with 3
read tools and exactly one write tool, `propose_change`. This skill is the *only* way you may affect
`ads-agent` — you never have access to its 4 direct write tools (`create_campaign`, `pause_campaign`,
`update_campaign_budget`, `add_negative_keyword`); they are not registered to you at all. Every
change you propose becomes a `pending` row a human must approve before anything real happens.

## When to Use

Use when asked to review Google Ads performance, investigate search terms, or suggest a campaign
strategy for the ads-agent account.

## Prerequisites

The `ads_agent` MCP server must be connected (`mcp_ads_agent_*` tools visible). If it isn't, tell the
user to run `docker compose up -d google-ads-mcp` from the `ads-agent` directory and then `/reload-mcp`.

## Procedure

① **Gather data** with the read tools — never guess:
- `mcp_ads_agent_list_campaign_performance` — cost, clicks, impressions, conversions per campaign
- `mcp_ads_agent_search_terms_report` — search terms driving traffic/spend
- `mcp_ads_agent_list_accessible_customers` — confirm which account you're looking at

② **Form a recommendation.** Write a short narrative summary plus a numbered list of concrete
recommendations, each with a rationale grounded in the data you just pulled.

③ **Submit it — never execute it yourself.** Call:

```json
mcp_ads_agent_propose_change({
  "kind": "campaign_strategy",
  "campaignId": null,
  "payload": {
    "summary": "<one-paragraph narrative>",
    "recommendations": [
      { "title": "<short title>", "rationale": "<why, citing the data>", "suggestedAction": "<optional concrete next step>" }
    ]
  },
  "triggeredRule": "hermes:campaign_strategy",
  "rationale": "<why now — e.g. what changed in the data>"
})
```

④ **Tell the user what happened.** Report the returned `proposalId` and that a human must approve it
at ads-agent's `/proposals` page before anything changes.

## Pitfalls

- **Never invent Google Ads data.** Every number in your summary must come from a tool call this
  turn — no citing figures from memory or a previous session.
- **Never attempt a write action other than `propose_change`.** You have no other write tool
  available; if a user asks you to "just pause that campaign," explain that you can only propose the
  change for human approval, then call `propose_change` with `kind: "pause"` instead of refusing
  outright.
- **`campaignId` is nullable** — leave it `null` for account-level strategy proposals; only set it
  when a recommendation is scoped to one specific campaign whose id you have from
  `list_campaign_performance`.

## Verification

After calling `propose_change`, confirm the tool returned a `proposalId` (a UUID) — if it returned an
error instead, read the message (invalid `kind`, DB unreachable) and fix the input rather than
retrying blindly.
```

- [x] **Step 2: Verify the frontmatter parses**

Run:
```bash
python3 -c "
import yaml
text = open('/Users/swami/.hermes/skills/ads-agent-campaign-strategy/SKILL.md').read()
frontmatter = text.split('---')[1]
d = yaml.safe_load(frontmatter)
assert d['name'] == 'ads-agent-campaign-strategy'
assert 'propose_change' in text
assert 'create_campaign' in text and 'pause_campaign' in text  # named only as tools it must NOT call
print('OK:', d['name'], d['description'])
"
```
Expected: prints `OK: ads-agent-campaign-strategy Review Google Ads performance...` with no error.

**Return to the orchestrator:** the verification script's output line.

---

### Task 4: Verify `ads-agent`'s Google Ads MCP server is up and reachable

**Files:** none created or modified — this is a read-only health check of an already-implemented, already-tested service (`ads-agent/docker-compose.yml`'s `google-ads-mcp`, from the already-shipped Hermes bridge design).

**Interfaces:**
- Produces: confirmation that `http://localhost:8766/mcp` is listening, which Task 6/7's Hermes MCP connection depends on.
- No dependency on any other task.

- [x] **Step 1: Start the dependency chain**

Run:
```bash
cd /Users/swami/Documents/GentleSpace_Web/ads-agent
docker compose up -d db
```
Expected: `db` reports healthy within ~10s (`docker compose ps db` shows `running (healthy)`).

- [x] **Step 2: Start the Google Ads MCP server**

Run:
```bash
docker compose up -d google-ads-mcp
docker compose logs google-ads-mcp --tail 20
```
Expected: logs include a line indicating it's listening on `http://localhost:8766/mcp` (or `0.0.0.0:8766`), with no crash/stack trace.

- [x] **Step 3: Confirm the published port is reachable from the host**

Run:
```bash
nc -z -G 2 localhost 8766 && echo "REACHABLE" || echo "UNREACHABLE"
```
Expected: `REACHABLE`. If `UNREACHABLE`, run `docker compose ps google-ads-mcp` and `docker compose logs google-ads-mcp` to diagnose before reporting back — do not proceed to Task 6 until this passes, since Hermes' `network_mode: host` container will hit exactly this same `localhost:8766` address.

**Return to the orchestrator:** the `docker compose ps` output for `db` and `google-ads-mcp`, and the reachability result.

---

### Task 5: Collect API keys and write `~/.hermes/.env` (orchestrator — not a subagent)

Do this yourself, interactively, after dispatching Wave 1. This cannot be a subagent because it requires asking the user for two secret values.

- [x] **Step 1: Ask the user for both keys**

Ask the user (via `AskQuestion` or a direct message) for:
1. A Google AI Studio API key from `https://aistudio.google.com/app/apikey`
2. A Firecrawl API key from `https://firecrawl.dev` (free tier: 500 credits/month)

- [x] **Step 2: Write them to `~/.hermes/.env` with restrictive permissions**

Once both are provided, run (substituting the real values — never print them back in chat):
```bash
mkdir -p ~/.hermes
umask 177
cat > ~/.hermes/.env << 'EOF'
GOOGLE_API_KEY=<value the user gave you>
FIRECRAWL_API_KEY=<value the user gave you>
EOF
chmod 600 ~/.hermes/.env
```

- [x] **Step 3: Verify without exposing the values**

Run:
```bash
grep -c "^GOOGLE_API_KEY=" ~/.hermes/.env
grep -c "^FIRECRAWL_API_KEY=" ~/.hermes/.env
stat -f "%OLp" ~/.hermes/.env   # macOS; expect 600
```
Expected: both `grep -c` calls print `1`; `stat` prints `600`.

**Return to the orchestrator (yourself):** confirmation both keys are present and the file is `600` — do not log or echo the key values themselves anywhere in the session transcript.

---

### Task 6: `docker compose up` for Hermes and verify it's healthy

**Files:**
- No new files — runs the already-cloned (Task 1) `~/hermes-agent/docker-compose.yml` unmodified, reading `~/.hermes/.env` (Task 5) and `~/.hermes/config.yaml` (Task 2) via the existing `~/.hermes:/opt/data` bind mount.

**Interfaces:**
- Consumes: Task 1's clone at `/Users/swami/hermes-agent`; Task 5's `~/.hermes/.env`.
- Produces: running `hermes` and `hermes-dashboard` containers that Task 7's end-to-end test drives.

- [x] **Step 1: Build and start the containers**

Run:
```bash
cd /Users/swami/hermes-agent
HERMES_UID=$(id -u) HERMES_GID=$(id -g) docker compose up -d --build
```
Expected: both `hermes` and `hermes-dashboard` build and start with no error (first build may take a few minutes — the upstream `Dockerfile` installs `uv`, Python 3.11, Node.js, and Hermes' own dependency set).

- [x] **Step 2: Confirm both containers are running**

Run:
```bash
docker compose ps
```
Expected: both `hermes` (container name `hermes`) and `hermes-dashboard` show state `Up`/`running`.

- [x] **Step 3: Run Hermes' own doctor check**

Run:
```bash
docker compose exec hermes hermes doctor
```
Expected: output reports `GOOGLE_API_KEY` and `FIRECRAWL_API_KEY` present, no critical errors. (Warnings about unrelated unconfigured integrations — Telegram, Teams, etc. — are expected and fine; this install intentionally only configures model + web search + the `ads_agent` MCP server.)

- [x] **Step 4: Confirm the `ads_agent` MCP server connected with exactly 4 tools**

Run:
```bash
docker compose exec hermes hermes mcp list
```
Expected: `ads_agent` listed as connected, with 4 tools (`list_campaign_performance`, `search_terms_report`, `list_accessible_customers`, `propose_change`) — not 8. If it shows 0 tools or a connection error, re-run Task 4's Step 3 reachability check from inside the `hermes` container (`docker compose exec hermes curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8766/mcp`) before proceeding — `network_mode: host` means the container should see the same `localhost:8766` the host does, but confirm rather than assume.

**Return to the orchestrator:** the `hermes doctor` and `hermes mcp list` output.

---

### Task 7: End-to-end verification and spec sign-off (orchestrator — not a subagent, sequential after Task 6)

- [x] **Step 1: Ask Hermes to use the bridge**

Run:
```bash
docker compose -f /Users/swami/hermes-agent/docker-compose.yml exec hermes hermes chat
```
In the chat session, send: `Review our Google Ads performance for the last 7 days and propose a campaign strategy.`

Expected: Hermes calls `mcp_ads_agent_list_campaign_performance`/`mcp_ads_agent_search_terms_report`, then `mcp_ads_agent_propose_change`, and reports back a `proposalId`.

- [x] **Step 2: Confirm the proposal landed in `ads-agent`**

Open `http://localhost:3030/proposals` (start `ads-agent`'s own dev server first if it isn't already running — `npm run dev` from `ads-agent/`, per its own README) and confirm a new `pending` proposal with `kind: campaign_strategy` and `triggered_rule: hermes:campaign_strategy` appears, matching the `proposalId` Hermes reported.

- [x] **Step 3: Confirm web search works**

In the same or a new `hermes chat` session, ask a question requiring current information (e.g. "What's today's date and one recent AI news headline?"). Expected: Hermes' response indicates it used `web_search`, and does not claim it has no internet access.

- [x] **Step 4: Confirm reasoning effort is active**

In `hermes chat`, run `/reasoning`. Expected: reports `high` as the current effort level.

- [x] **Step 5: Check off this spec's success criteria**

Open `docs/superpowers/specs/2026-08-10-hermes-agent-container-install-design.md` and check off (`- [x]`) every box in its "Success criteria" section that Steps 1–4 above verified.

- [x] **Step 6: Commit the spec checkoff**

```bash
cd /Users/swami/Documents/GentleSpace_Web
git add docs/superpowers/specs/2026-08-10-hermes-agent-container-install-design.md
git commit -m "docs: check off Hermes container install success criteria"
```

This is the only commit in this entire plan that touches `GentleSpace_Web` — everything else lives at `~/hermes-agent/` (its own separate git history) or `~/.hermes/` (not a git repo).
