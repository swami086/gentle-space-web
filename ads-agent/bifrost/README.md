# Bifrost AI gateway (local)

Bifrost sits between ads-agent and Vertex AI. It handles model routing (complexity-based), retries, and a single OpenAI-compatible API.

## Setup

1. **Encode the service-account key** (from repo root):

   ```bash
   base64 -i .secrets/gentle-space-vertex-stackgen.json | tr -d '\n'
   ```

   Set the output as `VERTEX_AUTH_CREDENTIALS` in `ads-agent/.env.local`.

2. **Required env vars** (also in `.env.example`):

   | Variable | Value |
   |----------|-------|
   | `VERTEX_PROJECT_ID` | `propane-galaxy-498403-n8` |
   | `VERTEX_AUTH_CREDENTIALS` | base64-encoded SA JSON |
   | `BIFROST_BASE_URL` | `http://localhost:8080` |
   | `BIFROST_CHAT_MODEL` | `vertex/gemini-2.5-flash-lite` |

3. **Start Bifrost** from `ads-agent/`:

   ```bash
   docker compose up -d bifrost
   ```

4. **Smoke test** — use the Task 3 script, or manually:

   ```bash
   curl http://localhost:8080/
   curl http://localhost:8080/v1/chat/completions ...
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
