# Bifrost AI gateway (local)

Bifrost sits between ads-agent and Vertex AI. It handles model routing (complexity-based), retries, and a single OpenAI-compatible API.

## Setup

1. **Service-account key** (from repo root). Bifrost's Vertex provider expects the
   **raw** service-account JSON string in `VERTEX_AUTH_CREDENTIALS` (not base64).

   If you keep a base64 blob in `.env.local` for convenience, decode when exporting
   for Compose:

   ```bash
   # Prefer exporting only the needed lines (zsh chokes on CRON_SCHEDULE=0 */6 ...):
   export VERTEX_PROJECT_ID="$(grep '^VERTEX_PROJECT_ID=' .env.local | cut -d= -f2-)"
   export VERTEX_AUTH_CREDENTIALS="$(grep '^VERTEX_AUTH_CREDENTIALS=' .env.local | cut -d= -f2- | base64 -d | tr -d '\n')"
   ```

   Or set `VERTEX_AUTH_CREDENTIALS` to the one-line JSON directly (no base64).

2. **Required env vars** (also in `.env.example`):

   | Variable | Value |
   |----------|-------|
   | `VERTEX_PROJECT_ID` | `propane-galaxy-498403-n8` |
   | `VERTEX_AUTH_CREDENTIALS` | **raw** SA JSON string (Compose / Bifrost) |
   | `BIFROST_BASE_URL` | `http://localhost:8080` |
   | `BIFROST_CHAT_MODEL` | `vertex/gemini-2.5-flash-lite` |

3. **Start Bifrost** from `ads-agent/`:

   Docker Compose does **not** auto-read `.env.local`. Export vars (step 1), then:

   ```bash
   docker compose up -d bifrost
   ```

   `config.json` is bind-mounted to `/app/data/config.json` (Bifrost's app-dir).

4. **Smoke test:**

   ```bash
   npx tsx scripts/smoke-bifrost.ts
   ```

## Routing (CEL)

Three global rules in `config.json` map complexity tiers to models:

| Tier | Model |
|------|-------|
| REASONING | gemini-2.5-pro |
| COMPLEX | gemini-2.5-flash |
| SIMPLE / MEDIUM / empty | gemini-2.5-flash-lite |

The third rule includes `complexity_tier == ""` so unclassified traffic falls through to the cheap model. If Bifrost rejects that clause at startup, drop the third rule and rely on the default alias `cheap` (`vertex/gemini-2.5-flash-lite`) for unclassified traffic.

## Deployment note

Bifrost is **internal-only** on the VM — do not expose via Caddy.

## Twenty MCP (self-hosted CRM tools)

`twenty-mcp-gateway` bridges the community `mhenry3164/twenty-crm-mcp-server` (stdio-only) to
Streamable HTTP via `supergateway`. **Bifrost's own config is not involved** — `lib/bifrost/mcp-client.ts`
connects to this sidecar directly with the official `@modelcontextprotocol/client` SDK; Bifrost is
only used for the actual chat completion (`lib/openui/resolve-tools-then-generate.ts` builds an
explicit `tools` param from this server's live schema and passes it to Bifrost like any other
OpenAI-compatible tool-calling request).

1. Export the same `TWENTY_API_KEY`/`TWENTY_BASE_URL` used elsewhere (see step 1 above):
   ```bash
   export TWENTY_API_KEY="$(grep '^TWENTY_API_KEY=' .env.local | cut -d= -f2-)"
   export TWENTY_BASE_URL="$(grep '^TWENTY_BASE_URL=' .env.local | cut -d= -f2-)"
   ```
2. `docker compose up -d twenty-mcp-gateway`
3. Verify: `docker compose logs twenty-mcp-gateway` shows it listening on `:8765`.

Reports Chat, Campaign Chat, and Phase 2 of Copilot/CRM Assistant never call `listTools()` or pass a
`tools` param to Bifrost, so they never see a Twenty tool — there is no allowlist/denylist to keep in
sync, because those code paths simply never mention Twenty at all.
