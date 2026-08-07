# Google Ads MCP integration — design

Date: 2026-08-07
Status: approved (pending user review of this written spec)
Related: activates [`docs/superpowers/specs/2026-08-03-ads-automation-agent-design.md`](2026-08-03-ads-automation-agent-design.md)
(implemented — decision engine, executor, admin UI; `lib/connectors/google-ads.ts` already existed
but was unconfigured, no credentials). Extends the MCP boundary established in
[`docs/superpowers/specs/2026-08-05-mcp-backend-tool-integration-design.md`](2026-08-05-mcp-backend-tool-integration-design.md)
(implemented for Twenty CRM) to Google Ads, resolving that spec's Google Ads non-goal
("no credentials exist today... documented, not implemented").

## Problem

`ads-agent`'s entire decision-engine/executor/admin-dashboard pipeline for Google Ads is already
built and tested (`lib/decision-engine/*`, `lib/executor/execute.ts`, the Marketing Automation
Kanban board), but has never run against real data: `GOOGLE_ADS_DEVELOPER_TOKEN` /
`GOOGLE_ADS_CLIENT_ID` / `GOOGLE_ADS_CLIENT_SECRET` / `GOOGLE_ADS_REFRESH_TOKEN` /
`GOOGLE_ADS_CUSTOMER_ID` are all unset, so `env-status.ts` reports `googleAds: false` and nothing
has ever called the real Google Ads API. Separately, the existing Twenty CRM integration
established a repo-wide convention — "AI copilots integrate to external tools via MCP only on the
backend" — that Google Ads has not yet adopted; `lib/connectors/google-ads.ts` still calls the
`google-ads-api` npm SDK directly.

Google publishes an official Google Ads MCP server (`googleads/google-ads-mcp`, Apache-2.0, Python,
verified live against its GitHub README and Google's developer docs on 2026-08-07), but it is
**strictly read-only** — `list_accessible_customers`, `search` (GAQL), `get_resource_metadata`;
it "cannot modify bids, pause campaigns, or create new assets." It cannot replace the write side of
`google-ads.ts`, and as a separate Python/stdio process it would add a second language runtime to a
TypeScript-only repo. This spec builds a custom, in-repo TypeScript MCP server instead, using
Google's official server as a reference for tool shape, wrapping the existing `google-ads-api` SDK
usage the repo already has tested — covering both read and write, with the write path never exposed
to an LLM's tool-calling loop.

## Goals

1. Real Google Ads credentials, obtained against a **test account first**, flow into
   `ads-agent/.env.local` and `env-status.ts` reports `googleAds: true`.
2. A new custom TypeScript MCP server (`ads-agent/mcp/google-ads-server/`) becomes the single
   implementation surface for all Google Ads API access — mirroring exactly how the Twenty MCP
   integration made the (third-party) Twenty MCP server the single implementation surface for CRM
   access. `lib/connectors/google-ads.ts` keeps its exact 6 exported function signatures but its
   bodies become thin MCP-client calls, so `cycle.ts`, `execute.ts`, and `rules.ts` require zero
   changes.
3. Copilot and Reports chat can answer real Google Ads questions ("how's my Whitefield campaign
   doing?") via the same two-phase resolve-then-generate pattern already used for Twenty — the LLM
   is only ever given the 3 read tool schemas; the 4 write tool schemas are structurally never sent
   to it.
4. The decision-engine's human-approval gate is unchanged and fully preserved: every write
   (`create_campaign`/`pause`/`budget_change`/`add_negative_keyword`) still requires an explicit
   `proposals` row approval before the executor calls the connector — the connector's write path now
   happens to go over MCP, but nothing about *when* a write happens changes.
5. A documented, safe rollout runbook: test account → verify the whole pipeline end-to-end with
   zero real-money risk → apply for production developer-token access → switch to the real account.

## Non-goals

- Meta Ads MCP integration — out of scope, `lib/connectors/meta.ts` is untouched (still a
  documented-target non-goal from the prior MCP spec; no credentials exist for it either).
- Any new Marketing Automation dashboard UI/pages — `app/(admin)/campaigns/page.tsx`'s Kanban board
  already sources from `listCampaignsWithLatestCpl`, which reads `campaigns`/`performance_snapshots`
  already populated by `cycle.ts`; once real credentials + MCP flow data in, the existing page shows
  it with zero page-code changes.
- Removing or weakening the human-approval gate — explicitly a non-goal; write tool schemas are
  never given to the LLM, full stop, in this phase or any phase discussed here.
- Autonomous execution of any Google Ads write without a human clicking Approve — unchanged from the
  original ads-automation-agent-design's non-goals.
- Deploying the new MCP server to the production VM / Docker Compose prod stack — local-only for
  this phase, same stance as the original ads-automation-agent-design spec.
- Making the new MCP server's write tools reachable by external MCP clients (Cursor/Claude Desktop)
  in this phase — it binds to `localhost` only; opening it up externally is a distinct decision with
  its own auth requirements, deferred.

## Approaches considered

### How much of the Google Ads integration routes through MCP

| # | Approach | Trade-off |
|---|----------|-----------|
| A | Chat-only MCP boundary: new MCP server exists only for Copilot/Reports; `lib/connectors/google-ads.ts` keeps calling the SDK directly for the decision-engine cron and executor | Zero new process dependency on the unattended, spend-adjacent cron path; but two separate implementations of "how do I call Google Ads" exist in the codebase |
| B (chosen) | Full MCP boundary, matching the Twenty precedent exactly: the real `google-ads-api` SDK calls move into the new MCP server; `google-ads.ts` becomes a thin MCP-client wrapper called by cycle.ts/executor/chat alike | One single implementation surface (matches the explicit repo-wide MCP-only directive completely, not just for chat); cron/executor now depend on the MCP server process being up — mitigated by soft-fail handling in `cycle.ts` (already the pattern for Meta/CRM gaps) and by the fact this server is our own in-repo TypeScript code (no new language/runtime, easy to keep running) |

**Decision:** B. Confirmed with user.

### Read/write tool safety model

| # | Approach | Trade-off |
|---|----------|-----------|
| A (chosen) | Human-gated only — the MCP server exposes both read and write tools (satisfying "build a read/write MCP server"), but only the 3 read tool schemas are ever included in what's sent to the LLM via `resolveToolsThenGenerate()`; writes still only ever happen through the existing approve-button → executor path | Exactly matches the existing Twenty precedent (`update_opportunity`'s schema is never advertised either) and every non-goal in the original decision-engine spec about unsupervised spend |
| B | Let the LLM call narrow write tools (e.g. `pause_campaign`) directly as a new autonomous capability | Rejected — contradicts the explicit, repeated "no autonomous execution without approval" non-goal across every prior ads-agent spec |

**Decision:** A. Confirmed with user.

### Server implementation

| # | Approach | Trade-off |
|---|----------|-----------|
| A (chosen) | TypeScript MCP server inside `ads-agent`, using the already-installed `@modelcontextprotocol/server`/`@modelcontextprotocol/core` package family (same major version as the existing `@modelcontextprotocol/client` v2.0.0 dependency), thin handlers wrapping the existing tested `google-ads-api` SDK usage | No new language/runtime; reuses 100% of the already-written, already-tested connector logic; native Streamable HTTP support means no `supergateway` bridge needed (unlike Twenty's third-party stdio-only server) |
| B | Fork/extend Google's official Python `google-ads-mcp` server to add write tools | Rejected — adds a second language runtime (Python + `pipx`) to a TypeScript-only repo for logic we'd have to reimplement anyway (the official server's `search`/GAQL tool doesn't map 1:1 onto our typed `fetchGoogleAdsPerformance`/`fetchGoogleSearchTerms` shapes without extra translation code either way) |

**Decision:** A. Confirmed with user.

## Architecture

```text
ads-agent/
  mcp/
    google-ads-server/
      index.ts                     NEW — @modelcontextprotocol/server Server +
                                    StreamableHTTPServerTransport bootstrap, binds
                                    to localhost:8766/mcp
      tools.ts                     NEW — real google-ads-api SDK calls (moved verbatim from
                                    the old lib/connectors/google-ads.ts body); one handler
                                    per tool; same GAQL queries/mutateResources shapes as today
      tools.test.ts                NEW — same test shape as today's google-ads.test.ts
                                    (mocks google-ads-api), just relocated

  lib/
    connectors/
      google-ads.ts                 REWRITTEN — same 6 exported functions
                                    (fetchGoogleAdsPerformance, fetchGoogleSearchTerms,
                                    createFullGoogleCampaign, pauseGoogleCampaign,
                                    updateGoogleCampaignBudget, addGoogleNegativeKeyword),
                                    bodies now call google-ads-mcp-client.ts's callTool()
      google-ads.test.ts             REWRITTEN — mocks the MCP client, asserts each function
                                    calls the right tool name + args (mirrors
                                    twenty-pipeline.test.ts's rewrite shape)
    bifrost/
      google-ads-mcp-client.ts       NEW — mirrors mcp-client.ts exactly: Client +
                                    StreamableHTTPClientTransport, pointed at
                                    GOOGLE_ADS_MCP_URL
    openui/
      resolve-tools-then-generate.ts   MODIFIED — extended to also resolve Google Ads read
                                    tools for Copilot/Reports; the 4 write tool schemas are
                                    filtered out before ever being sent to Bifrost, exactly
                                    like update_opportunity's exclusion today
    decision-engine/
      cycle.ts                      UNCHANGED — still imports google-ads.ts's functions by
                                    name; soft-fail wrapper already catches per-platform
                                    fetch failures (extends naturally to MCP-unreachable)
    executor/
      execute.ts                    UNCHANGED — still "switches on kind → calls the matching
                                    connector write method"

  scripts/
    run-google-ads-mcp.ts            NEW — tsx entrypoint starting the MCP server, same
                                    "standalone worker" convention as run-decision-cycle.ts
                                    (not a new Docker service — ads-agent's own TypeScript
                                    doesn't run containerized today)

  package.json                       + "@modelcontextprotocol/server": "^2.0.0"
                                    + "mcp:google-ads": "tsx --env-file=.env.local scripts/run-google-ads-mcp.ts"

  .env.example                       + GOOGLE_ADS_MCP_URL=http://localhost:8766/mcp
```

### Tools exposed by the new MCP server

| Tool | Kind | Wraps | Advertised to LLM? |
|---|---|---|---|
| `list_campaign_performance` | read | `fetchGoogleAdsPerformance()` (existing GAQL query) | Yes |
| `search_terms_report` | read | `fetchGoogleSearchTerms()` (existing GAQL query) | Yes |
| `list_accessible_customers` | read | NEW thin wrapper — `google-ads-api`'s `client.listAccessibleCustomers(refreshToken)` (dedicated non-GAQL RPC, matching the official server's tool of the same name) | Yes |
| `create_campaign` | write | `createFullGoogleCampaign()` (existing atomic mutate) | **No** |
| `pause_campaign` | write | `pauseGoogleCampaign()` | **No** |
| `update_campaign_budget` | write | `updateGoogleCampaignBudget()` | **No** |
| `add_negative_keyword` | write | `addGoogleNegativeKeyword()` | **No** |

### Data flow: one decision-engine cycle (MCP-backed)

```
cycle.ts
  → google-ads.ts.fetchGoogleAdsPerformance()
    → google-ads-mcp-client.ts (@modelcontextprotocol/client, StreamableHTTPClientTransport)
      → google-ads-mcp-server:8766/mcp → tools.ts.listCampaignPerformance()
        → google-ads-api SDK → Google Ads API
      ← rows
    ← same GoogleAdsPerformanceRow[] shape as today
  ← writes performance_snapshots row, unchanged
```

### Data flow: Copilot asks a Google Ads question

```
Copilot backend → google-ads-mcp-client.ts.listTools()
                 → filter to [list_campaign_performance, search_terms_report,
                              list_accessible_customers] — the 4 write tools are dropped here,
                   before Bifrost ever sees them
                 → Bifrost POST /v1/chat/completions (tools: [...3 read tools], stream=false)
                 ← tool_calls: [{ name: "list_campaign_performance" }]
                 → google-ads-mcp-client.ts.callTool({ name: "list_campaign_performance" })
                 ← real performance rows
                 → Bifrost POST /v1/chat/completions (stream=true, tool result appended)
                 ← streams OpenUI-lang built from real data
```

## Error handling

- **MCP server unreachable during a cron tick**: `cycle.ts`'s existing per-platform soft-fail
  wrapper (already used when Meta/CRM signal fetches fail) catches the connection error, skips
  writing a Google Ads `performance_snapshots` row for that tick, logs it, and the cycle continues
  with whatever other signals are available — no crash, no proposal generated from missing data.
- **MCP server unreachable when an approved proposal executes**: identical to any other execution
  failure today — `proposals.status = 'failed'`, `error` populated with the connection error, never
  auto-retried, sits for manual re-approval once the server is back up.
- **Model requests a write tool anyway**: two independent gates, matching the Twenty precedent
  exactly — (1) the `tools` array built from `listTools()` and filtered before being sent to Bifrost
  structurally never includes the 4 write schemas, so the model cannot be told they exist; (2)
  `resolveToolsThenGenerate()` additionally rejects any returned tool-call name outside the
  advertised 3, in case of a hallucinated name.
- **Google Ads API itself errors** (e.g. `INVALID_CUSTOMER_ID`, rate limit, policy violation): the
  MCP tool handler in `tools.ts` surfaces the Google Ads API's own error message back through the
  MCP `callTool()` response as an error result — unchanged from how `google-ads-api` errors
  propagate today, just one layer further out.

## Testing

- `mcp/google-ads-server/tools.test.ts` — same mocked-`google-ads-api` shape as today's
  `google-ads.test.ts` (relocated, not reinvented): GAQL row mapping, atomic campaign creation
  mutate-operation ordering, budget/pause/negative-keyword mutate calls.
- `lib/connectors/google-ads.test.ts` — rewritten to mock `google-ads-mcp-client.ts`, asserting each
  of the 6 exported functions calls the correct tool name with the correct arguments and maps the
  tool result back to the same typed shape callers expect (mirrors `twenty-pipeline.test.ts`'s
  rewrite from the prior MCP spec).
- `resolve-tools-then-generate.test.ts` — extended with Google Ads cases: a read tool call executes
  via `callTool()` and its result is appended as a `tool` message; a tool-call name outside the
  advertised 3 read names is rejected before reaching `callTool()`.
- Live smoke (manual, once test-account credentials exist): `npm run mcp:google-ads` locally, a
  small ad-hoc script (or extend `openui-live-smoke.test.ts`) calls `listTools()` and asserts exactly
  7 tools are returned; a real `search_terms_report` call against the test account returns rows (or
  an empty array, not an error, if the test account has no traffic yet).
- End-to-end (manual): flip `cron_settings.enabled` on, confirm one cycle writes a
  `performance_snapshots` row sourced via MCP; manually trigger and approve a `create_campaign`
  proposal against the test account, confirm a real (test) campaign exists and `campaigns.external_id`
  is populated.

## Credentials & rollout runbook

1. **Create a Google Ads test manager account** — separate signup flow from a production account
   (`ads.google.com` → sign up for a manager account, select "I'm a professional" → test account
   option during setup, or convert immediately after creation per Google's test-account docs).
2. **Developer token** — Google Ads UI → Tools & Settings → Setup → API Center → apply. New tokens
   default to **Test access**, which works immediately against test accounts — no review wait for
   this phase.
3. **OAuth Client ID + Secret** — Google Cloud Console → APIs & Services → Credentials → Create
   OAuth client ID → Desktop app type. Can reuse the existing Vertex AI Google Cloud project or a
   new one; enable the Google Ads API on whichever project is used.
4. **Refresh token** — run Google's documented installed-app OAuth flow once locally with the
   Client ID/Secret (`google-ads-api`'s own `GenerateRefreshToken` helper or the equivalent script
   from Google's Python client library docs) to mint a long-lived refresh token.
5. **Customer ID** — the 10-digit test account ID, visible top-right in the Google Ads UI once the
   test account exists.
6. Set all 5 in `ads-agent/.env.local` + `GOOGLE_ADS_MCP_URL=http://localhost:8766/mcp`.
7. `npm run mcp:google-ads`, verify `listTools()` returns 7 tools.
8. `npm run dev` + flip `cron_settings.enabled` in `/settings`, confirm a clean cycle (zero
   proposals, since the test account starts with zero campaigns).
9. Manually create + approve one `create_campaign` proposal against the test account; confirm it
   appears in the Google Ads UI for that test account.
10. Only once 6-9 are clean: apply for **Basic/Standard access** on the developer token (~5 business
    days) before ever setting `GOOGLE_ADS_CUSTOMER_ID` to the real Gentle Space account.

## Success criteria

- [ ] `npm run mcp:google-ads` starts the new server locally; `listTools()` returns exactly 7 tools
      (3 read + 4 write).
- [ ] `env-status.ts` reports `googleAds: true` once the 5 credential env vars are set.
- [ ] A full decision-engine cycle against the test account writes a real `performance_snapshots`
      row sourced via the MCP path (verified by log/DB inspection, not just unit tests).
- [ ] Copilot/Reports chat answers a real Google Ads question using only the 3 read tools; a
      live-smoke assertion confirms the 4 write tool names never appear in the `tools` param sent to
      Bifrost.
- [ ] An approved `create_campaign`/`pause`/`budget_change`/`add_negative_keyword` proposal against
      the test account succeeds end-to-end through the MCP path, and `campaigns.external_id` /
      `status` update correctly on success.
- [ ] Stopping the `google-ads-mcp` process mid-cycle causes that tick to skip the Google Ads
      snapshot cleanly (soft-fail, verified by test), not a crash.
- [ ] A rejected proposal never triggers any MCP `callTool()` for a write tool.
- [ ] `npm run build && npm run lint && npm test` pass with zero new warnings.

## Implementation order (high level — informs task breakdown in the writing-plans doc)

1. `mcp/google-ads-server/tools.ts` + `tools.test.ts` — move the existing `google-ads-api` SDK logic
   verbatim from `lib/connectors/google-ads.ts`, add the 3 new/wrapped read tools' MCP tool
   definitions (schema + handler), add the 4 write tools' definitions.
2. `mcp/google-ads-server/index.ts` + `scripts/run-google-ads-mcp.ts` — server bootstrap, Streamable
   HTTP transport, port 8766.
3. `lib/bifrost/google-ads-mcp-client.ts` — thin client wrapper, mirrors `mcp-client.ts`.
4. `lib/connectors/google-ads.ts` + `.test.ts` rewrite — same 6 exported signatures, MCP-backed
   bodies; verify `cycle.ts`/`executor/execute.ts`/`rules.ts` compile and their existing tests pass
   unchanged (no call-site edits expected).
5. `lib/openui/resolve-tools-then-generate.ts` extension + its test — Google Ads read-tool
   resolution, write-tool exclusion assertion.
6. `.env.example` / `package.json` / README updates documenting the credential runbook above.
7. Manual credential acquisition (test account) — can run in parallel with steps 1-6, same
   "start early" guidance as the original ads-automation-agent-design spec.
8. Live smoke + end-to-end manual verification per the Testing section, against the test account.
9. Document the production-access application step; do not flip `GOOGLE_ADS_CUSTOMER_ID` to the real
   account until 1-8 are clean.

Detailed task breakdown follows in a writing-plans doc after this spec is reviewed.
