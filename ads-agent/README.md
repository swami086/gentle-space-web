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
2. `docker compose up -d` (starts this service's own Postgres on host port 5434)
3. `cp .env.example .env.local` and fill in `DATABASE_URL` (already correct for the compose default), Bifrost vars (chat + rationale — see Bifrost below), plus credentials below
4. `npm run migrate` (applies `lib/db/schema.sql`)
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

### Twenty CRM

Reuse the main app's already-live instance — no new setup. `TWENTY_BASE_URL`
and `TWENTY_API_KEY` match the root repo's `.env.local`.

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
