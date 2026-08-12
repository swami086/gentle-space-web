# ads-agent

Human-gated Meta Ads + Google Ads automation agent for Gentle Space. See
[`docs/superpowers/specs/2026-08-03-ads-automation-agent-design.md`](../docs/superpowers/specs/2026-08-03-ads-automation-agent-design.md)
for the full design.

Product/audience context for this service lives in [`.agents/product-marketing.md`](.agents/product-marketing.md).
The rationale LLM call (`lib/decision-engine/rationale.ts`) grounds its explanation of each proposal
in rule-specific performance-marketing principles (`lib/decision-engine/playbook-context.ts`),
distilled from [coreyhaines31/marketingskills](https://github.com/coreyhaines31/marketingskills)'
`ads` skill.

The admin UI (`/`, `/campaigns`, `/proposals`, `/settings`) is a Tailwind v4 +
shadcn-style dashboard behind a persistent sidebar; see
[`docs/superpowers/specs/2026-08-03-ads-agent-admin-dashboard-design.md`](../docs/superpowers/specs/2026-08-03-ads-agent-admin-dashboard-design.md)
for the design.

### Conversational campaign creation

From **Campaigns → New Campaign**, describe the ad in chat; the assistant fills a
draft setup card. When the draft is ready, click **Create Proposal**, review/edit on
the proposal page, then approve. Requires Bifrost (`BIFROST_BASE_URL`) for the chat
assistant and for proposal rationale generation (`lib/decision-engine/rationale.ts`)
— both route through the Bifrost gateway to Vertex (`gemini-2.5-flash-lite`), not
OpenAI.

## Local setup

1. `npm install`
2. From the **repo root**, start consolidated Postgres: `docker compose -f docker-compose.listings.yml up -d` (PG18 + AGE on host port **5433**). The `docker compose up -d` in this folder still starts Bifrost/MCP services but its `:5434` Postgres is **legacy** — do not point `DATABASE_URL` at it after S1–S3 consolidation.
3. `cp .env.example .env.local` and fill in Bifrost vars (chat + rationale — see Bifrost below), plus credentials below. `DATABASE_URL` defaults to `gentle_space_listings` on `:5433`.
4. `npm run migrate` (applies numbered migrations under `lib/db/migrations/`)
5. `npm run dev` (admin UI at http://localhost:3030)
6. In a second terminal: `npm run worker` (cron worker; starts with `cron_settings.enabled = false`, flip it on in `/settings`)

## Credentials

### Meta Marketing API

1. Create an app at https://developers.facebook.com/apps
2. Add the Marketing API product, request the `ads_management` permission
3. Managing your own ad account only needs Standard/Limited Access — no app
   review required
4. Generate a long-lived access token for the app, set `META_ACCESS_TOKEN`
5. Find your ad account ID (without the `act_` prefix) in Business Manager,
   set `META_AD_ACCOUNT_ID`

### Google Ads API

1. Apply for a developer token: https://ads.google.com/aw/apicenter (Basic
   Access — 15,000 ops/day, ~5 business day review)
2. Create OAuth client credentials in Google Cloud Console, set
   `GOOGLE_ADS_CLIENT_ID` / `GOOGLE_ADS_CLIENT_SECRET`
3. Generate a refresh token via the OAuth playground or `google-ads-api`'s
   own helper, set `GOOGLE_ADS_REFRESH_TOKEN`
4. Set `GOOGLE_ADS_CUSTOMER_ID` to your Ads account ID (digits only, no
   dashes)

### Future: MCP-based Meta/Google Ads integration

`lib/connectors/meta.ts` and `lib/connectors/google-ads.ts` are unconfigured today (no credentials
in `.env.local`) — there is nothing live to migrate. When real ad-account credentials are added, the
target end state (matching the Twenty CRM MCP integration — see `bifrost/README.md`'s "Twenty MCP"
section) is the same shape: connect with the official `@modelcontextprotocol/client` SDK directly,
not through Bifrost's MCP Gateway feature.

- **Meta Ads**: Meta's official hosted MCP endpoint, `mcp.facebook.com/ads` (OAuth, 29 tools,
  launched April 2026 as part of Meta's "Ads AI Connectors"). Use `StreamableHTTPClientTransport`
  with the SDK's OAuth client helpers — no self-hosting needed, unlike Twenty.

### Google Ads MCP server

`lib/connectors/google-ads.ts` calls Google Ads exclusively through an in-repo custom TypeScript
MCP server (`mcp/google-ads-server/`) — the same "AI copilots integrate to external tools via MCP
only on the backend" convention as the Twenty CRM integration below. See
[`docs/superpowers/specs/2026-08-07-google-ads-mcp-integration-design.md`](../docs/superpowers/specs/2026-08-07-google-ads-mcp-integration-design.md)
for the full design.

1. Fill in the 5 Google Ads credential env vars above (start with a **test account** — see the
   spec's rollout runbook for how to create one with zero real-spend risk)
2. Add `GOOGLE_ADS_MCP_URL=http://localhost:8766/mcp` to `.env.local` (already in `.env.example`)
3. `npm run mcp:google-ads` (starts the MCP server; leave running in its own terminal)
4. `npm run dev` / `npm run worker` as usual — `cycle.ts`, `execute.ts`, and Copilot/Reports chat
   all reach Google Ads through this server now

The server exposes 3 read tools (advertised to chat) and 4 write tools (never advertised — writes
only ever happen through the existing approve-button → executor path).

Meta Ads MCP integration remains a documented, not-yet-implemented target — see Meta's official
hosted MCP endpoint (`mcp.facebook.com/ads`) noted below.

Until credentials exist, `lib/connectors/meta.ts` keeps its current (direct API, unconfigured)
code path unchanged. `lib/connectors/google-ads.ts` is MCP-backed as of this integration (see
above) even before real credentials are set — it will simply fail soft (cycle.ts skips the
snapshot; the executor marks the proposal failed) until the MCP server is running and configured.

### Twenty CRM

Local dev uses the shared instance at `infra/twenty` (`TWENTY_BASE_URL=http://localhost:3020`).
Per-org instances are registered in `context.twenty_connections` and reached only via
`getTwentyClient(orgId)` (see `lib/crm/twenty-client.ts`).

**Required in `.env.local` for coverage check + interim guard:**

- `SHARED_TWENTY_BASE_URL` — local: `http://localhost:3020`; production shared: `https://crm.gentlespacesolutions.com`
- `PLATFORM_ORG_ID` — internal org uuid from `public.orgs` (seed: `00000000-0000-0000-0000-000000000001`)

**Provisioning a dedicated org instance (Coolify):** copy `COOLIFY_*` and `TWENTY_*` from
`.env.example`. The Coolify MCP token maps to `COOLIFY_API_TOKEN` (or `COOLIFY_ACCESS_TOKEN`).

```bash
npx tsx --env-file=.env.local scripts/check-twenty-coverage.ts
npx tsx --env-file=.env.local scripts/provision-twenty-instance.ts --org-id <uuid> --slug gentle-space
```

### Bifrost (chat + rationale)

Bifrost is the local AI gateway between ads-agent and Vertex. See
[`bifrost/README.md`](bifrost/README.md) for full setup (service-account export,
Compose env, smoke test).

1. Start the gateway: `docker compose up -d bifrost`
2. Set `BIFROST_BASE_URL` (default `http://localhost:8080`), `VERTEX_PROJECT_ID`
   (`propane-galaxy-498403-n8`), and `VERTEX_AUTH_CREDENTIALS` (base64-encoded
   service-account JSON in `.env.local`; export decoded for Compose — see
   `bifrost/README.md`)
3. Optionally override `BIFROST_CHAT_MODEL` (default `vertex/gemini-2.5-flash-lite`)
