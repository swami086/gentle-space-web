# RP-W4 — Public MCP gateway and REST API

Date: 2026-08-13  
Status: approved (revised 2026-08-13 after review — see §Revision notes)  
Program: [`2026-08-13-rp-program-design.md`](2026-08-13-rp-program-design.md)  
Depends on: W0 (`lib/channels/` tool registry with `effect`/`scope`/`internalToolName`, `lib/autonomy/`), **W4a** ([`2026-08-13-rp-w4a-authorization-server-design.md`](2026-08-13-rp-w4a-authorization-server-design.md)) for the authorization server  
Migration range: **160–169**  
Owned paths: `ads-agent/app/api/public/`, `ads-agent/app/.well-known/`, `ads-agent/lib/publicapi/`, `ads-agent/mcp/public-gateway/`

## Problem

Ryze's headline developer claim is "API to let AI manage your ads — 150+ tools, one endpoint, OAuth once", usable from Claude, ChatGPT and Cursor. We have three internal MCP servers and no external client story: no OAuth, no published catalogue, no rate limiting, no per-client audit.

The existing internal posture is weaker than it looks, and W4 must not inherit it:

- **Only `mcp/context-server` authenticates callers.** It funnels every tool through a `registerGuardedTool` helper that verifies a short-lived task token against a per-profile allowlist (`lib/agent/profiles.ts`).
- **`mcp/google-ads-server` and `mcp/app-data-mcp-server` have no token auth at all** — only `hostHeaderValidation` plus `localhostOriginValidation`, with the tenant taken from environment variables.
- **`mcp/google-ads-server` registers four tools that mutate Google Ads directly** (`create_campaign`, `pause_campaign`, `update_campaign_budget`, `add_negative_keyword`), calling the connector functions in-process with no proposal, no autonomy evaluation and no `ai_action_log` entry. Its own comment asserts `propose_change` is "the only write path Hermes can reach", which is true only by network placement and Hermes configuration, not by code. This is a **pre-existing GC1 violation**, tracked in the program spec's risk table and fixed in W1/W2 — W4 must not expose these tools, and must not treat their existence as precedent.

## Goals

1. A single externally reachable MCP endpoint exposing an explicit publish allowlist of tools.
2. OAuth 2.1 resource-server behaviour conforming to the current MCP authorization specification, with per-tenant scopes and audience validation.
3. A documented REST surface sharing one dispatcher with the MCP path.
4. Architectural enforcement — not merely a test — that no externally reachable write can bypass `evaluateAutonomy`.

## Non-goals

- The authorization server itself: client registration, `/authorize`, `/token`, PKCE, consent UI, grant storage and AS metadata are **W4a**.
- Publishing SEO/GEO/CMS tools (those workstreams register descriptors later through the same registry).
- Self-serve signup, plan management or invoicing.
- Fixing the four ungated Google Ads MCP tools (W1/W2 own that).

## Standards basis

Revision checked: **[2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)** (current; `2025-06-18` and `2025-11-25` are superseded).

| Requirement | Level | Owner |
|---|---|---|
| MCP server acts as an OAuth 2.1 resource server | — | W4 |
| Implement OAuth 2.0 Protected Resource Metadata ([RFC 9728](https://datatracker.ietf.org/doc/html/rfc9728)) | **MUST** | W4 |
| Validate that access tokens were issued for this server as intended audience ([RFC 8707](https://datatracker.ietf.org/doc/html/rfc8707) §2) | **MUST** | W4 |
| Account for scope hierarchies (broader implies narrower) | **MUST** | W0 `SCOPE_IMPLIES` + W4 |
| Never accept or transit tokens other than those from its own authorization server | **MUST** | W4 |
| Clients send `resource` on authorization **and** token requests | **MUST** (client) | W4a contract |
| Authorization server publishes [RFC 8414](https://datatracker.ietf.org/doc/html/rfc8414) or OIDC Discovery metadata | **MUST** | W4a |
| Support OAuth Client ID Metadata Documents | **SHOULD** | W4a |
| Dynamic Client Registration | **MAY**, and **deprecated** — retained only for backwards compatibility | W4a (optional, last) |

The earlier draft of this spec cited the `2025-06-18` revision and described Dynamic Client Registration as SHOULD. Both were wrong: DCR was demoted to MAY and then deprecated, with Client ID Metadata Documents taking its place as the SHOULD. Do not build toward DCR first.

## Architecture

```text
Claude / ChatGPT / Cursor / curl
        │  OAuth 2.1 + PKCE, token audience-bound to the canonical resource URI
        ▼
GET /.well-known/oauth-protected-resource/mcp   (RFC 9728 → points at W4a)
        │
        ▼
mcp/public-gateway  ──► token validation ──► scope check (SCOPE_IMPLIES)
        │                                        ▼
        │                                  publish allowlist
        │                                        ▼
        │                          ┌── effect 'read'    → internal read servers
        │                          ├── effect 'propose' → proposal only, no execution
        │                          └── effect 'execute' → executor → evaluateAutonomy → adapter
        ▼
shared-counter rate limit + upstream write budget + api_call_log
```

**Canonical resource URI:** `https://ads.gentlespacesolutions.com/api/public/mcp`. Per RFC 9728 the metadata document therefore lives at `/.well-known/oauth-protected-resource/mcp` (path-derived, not the bare well-known path), which is why `ads-agent/app/.well-known/` is in this workstream's owned paths — it is served from the origin root, outside `app/api/public/`.

Metadata contents: `resource`, `authorization_servers`, `scopes_supported`, `bearer_methods_supported: ["header"]`, `resource_documentation`. `offline_access` is not advertised in `scopes_supported`.

**Transport and protocol version:** Streamable HTTP. The gateway supports the current revision plus the handshake-based back-compatibility path for `2025-11-25` and earlier, since shipping clients will send those for some time. It replaces `localhostOriginValidation()` — which the three internal servers use and which would reject every real client — with an explicit CORS/allowlist policy.

## Publish allowlist (replaces the earlier "subset of internal tools" invariant)

The earlier draft asserted the public catalogue must be a subset of internal tools, verified by a containment test. That invariant is wrong in two ways. It is *satisfied* by exactly the four ungated Google Ads mutation tools, so a passing test would permit publishing a tool that pauses a live campaign with no gate. And the two namespaces are disjoint — registry descriptors are channel-qualified (`google.update_campaign_budget`) while internal servers use bare names — so a set comparison is either vacuous or fails on day one.

Instead:

1. **`lib/publicapi/catalogue.ts` holds a literal allowlist** of descriptor names that may be published. Exposure is an addition someone writes and reviews, never a subtraction someone must remember.
2. **The real invariant:** every allowlisted `effect: 'execute'` descriptor's only execution route is the executor. Enforced architecturally (below), not by a namespace comparison.
3. Where a cross-check against internal servers is useful, it uses the declared `internalToolName` mapping from W0's descriptor — not a set operation.

## Enforcing no-bypass

A test cannot quantify over code paths that do not exist yet, so three mechanisms combine:

- **Import boundary (CI).** `lib/publicapi/` and `mcp/public-gateway/` may not import `getAdapter` from `lib/channels` at all; public writes reach platforms only through the executor, which W0 commits to re-evaluating autonomy immediately before the adapter call. Enforced with `no-restricted-imports` in the lint config.
- **Exhaustive registry sweep (test).** Stub `evaluateAutonomy` to throw, then drive **every** allowlisted `effect: 'execute'` descriptor through `dispatchPublicTool` and assert each throws. Table-driven over the catalogue, so a descriptor added next month is covered without anyone remembering.
- **Single call-site assertion (test).** Assert `adapter.execute` appears exactly once under `lib/publicapi/`, copying the idiom `mcp/context-server/index.test.ts` already uses to assert `server.registerTool` appears exactly once.

## Scope model

Scopes come from W0's descriptors (`scope` field), and the hierarchy is declared once in W0's `SCOPE_IMPLIES`:

| Scope | Grants | Implies |
|---|---|---|
| `ads:read` | Performance, search terms, campaign structure | — |
| `ads:propose` | Create proposals; never executes | `ads:read` |
| `ads:write` | Execute through the autonomy path | `ads:propose` |
| `crm:read` | The six read tools of `mcp/app-data-mcp-server` | — |
| `context:read` | Context-graph and spaces reads | — |

`crm:read` and `context:read` tools do not come from the channel registry — those servers are not channel adapters. They are registered into the public catalogue explicitly, with `internalToolName` set and `effect: 'read'`, which is why the catalogue is a literal allowlist rather than a projection of one registry.

## Data model (migrations 160–163)

```sql
-- 160
CREATE TABLE adsagent.api_clients (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             uuid NOT NULL REFERENCES adsagent.orgs(id),
  oauth_client_id    text NOT NULL UNIQUE,       -- issued by W4a, not this row's PK
  name               text NOT NULL,
  rate_limit_per_min integer NOT NULL DEFAULT 60 CHECK (rate_limit_per_min > 0),
  daily_write_budget integer NOT NULL DEFAULT 50 CHECK (daily_write_budget >= 0),
  state              text NOT NULL DEFAULT 'active'
                     CHECK (state IN ('active','suspended','revoked')),
  last_used_at       timestamptz,
  revoked_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, name)
);

-- 161
CREATE TABLE adsagent.api_call_log (
  id          bigserial PRIMARY KEY,
  org_id      uuid NOT NULL REFERENCES adsagent.orgs(id),
  client_id   uuid NOT NULL REFERENCES adsagent.api_clients(id),
  request_id  text NOT NULL,              -- joins to existing OTLP/Langfuse spans
  tool_name   text NOT NULL,
  effect      text NOT NULL CHECK (effect IN ('read','propose','execute')),
  proposal_id uuid,
  decision    text,
  status_code integer NOT NULL,
  latency_ms  integer NOT NULL,           -- time-to-response, never time-to-effect
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- 162
CREATE TABLE adsagent.api_idempotency (
  org_id       uuid NOT NULL,
  client_id    uuid NOT NULL,
  key          text NOT NULL,
  request_hash text NOT NULL,
  response     jsonb NOT NULL,
  status_code  integer NOT NULL,
  expires_at   timestamptz NOT NULL,
  PRIMARY KEY (org_id, client_id, key)
);
```

Migration **163** makes external usage recordable: `usage_ledger.user_id` becomes nullable, gains `client_id uuid REFERENCES adsagent.api_clients(id)`, and a `CHECK (user_id IS NOT NULL OR client_id IS NOT NULL)`. Without this, metering an API call is impossible — the column is `NOT NULL` with a foreign key to `adsagent.users(id)` and an API client has no user, so the first metered public call would raise a not-null violation.

All tables carry `org_id`, RLS `FORCE` and a leading-edge tenant index (GC6). **The tenant is derived from the validated token and the client row, never from a request parameter** — the same reasoning the task-token implementation documents: a caller who cannot name the tenant cannot cross tenants.

`api_clients` holds rate limit, budget, state and metering linkage only. **Scopes live in the token** (W4a is authoritative); duplicating them here would create two sources of truth that silently drift. Secrets live in W4a; nothing in this schema stores a credential.

`state = 'revoked'` is distinct from `'suspended'` so a compromised key is distinguishable from a paused one, with `revoked_at` recorded for forensics.

## Token validation

Local JWT validation against `auth-service` JWKS — not introspection:

```ts
await jwtVerify(token, jwks, { issuer: AUTH_ISSUER, audience: CANONICAL_RESOURCE_URI });
```

The audience option is mandatory. The existing `lib/auth/dal.ts` pattern verifies `issuer` only and reads a `gs_session` **cookie**, so copying it verbatim would produce exactly the audience-confusion failure the MUST exists to prevent. Additional rules: `exp`/`nbf` with a bounded clock skew; scope claim format fixed by W4a and validated here; JWKS cached with a TTL, one refetch on unknown `kid`, then `401` with no retry loop; and the public endpoint **rejects both the `gs_session` cookie and the internal task token** — two other credential types are in flight in this codebase and a permissive middleware would accept them.

## REST surface

Shares the dispatcher with the MCP path.

```
GET  /api/public/v1/tools
GET  /api/public/v1/campaigns                       (cursor paginated)
GET  /api/public/v1/performance?channel=&from=&to=  (cursor paginated, max 90-day window)
GET  /api/public/v1/search-terms                    (cursor paginated)
GET  /api/public/v1/proposals                       (collection, cursor paginated)
GET  /api/public/v1/proposals/{id}
POST /api/public/v1/proposals                       → 201 | 202 | 422
POST /api/public/v1/proposals/{id}/execute          → 202 | 409 | 422
POST /api/public/v1/webhooks                        (register endpoint for state transitions)
```

Pagination caps are no laxer than the internal tools they wrap (`list_enquiries` caps at 100; `get_campaign_performance` caps at 90 days).

**Status semantics, matched to the real lifecycle** (`pending` → approve → `scheduled` with `undo_until` → worker → `executing` → `executed`; `lib/executor/execute.ts` refuses anything not already `executing`):

| Situation | Response |
|---|---|
| Write accepted, gated pending approval | `202` + `Location: /api/public/v1/proposals/{id}` |
| Write accepted, autonomy returned `auto` | `202` + `Location`; **execution is asynchronous and honours the undo window** |
| Execute requested while `scheduled` | `202` (already in flight) |
| Execute requested while `pending`/`rejected`/`executed`/`failed` | `409` |
| Guardrail or preflight failure | `422` with the preflight payload, matching the existing approve route |
| Missing scope | `403` + `WWW-Authenticate: Bearer error="insufficient_scope", scope="…", resource_metadata="…"` |
| Absent/invalid/wrong-audience token | `401` + `WWW-Authenticate` with `resource_metadata` and `scope` |
| Malformed authorization request | `400` |

The auto path is deliberately asynchronous. A synchronous "executes and returns the result" would discard the undo window that the program's risk table names as a primary overspend mitigation, making the API a weaker control surface than the admin UI.

**There is no public approve/reject endpoint, by design** — approval is a human act performed in the admin UI, so an API client's gated proposal is resolved there. Clients learn the outcome from a registered webhook (HMAC-signed, hung off the existing outbox) rather than indefinite polling.

`Idempotency-Key` is required on both `POST /proposals` and `POST /proposals/{id}/execute`, scoped per `(org, client)`, stored in `api_idempotency` with a TTL. A replay with the same key and same body returns the stored response; same key with a different body returns `409`. The key propagates into W0's `ExecuteContext.idempotencyKey`. The existing `lib/events/idempotency.ts` is not reusable — it keys on `(org_id, consumer, event_id)` for outbox delivery.

One error envelope for every failure: `{ error: { code, message, details? } }`, with a documented mapping from `ExecutionResult.error.class` to HTTP status and JSON-RPC error code.

## Rate limiting and quota

**Inbound** uses a shared counter (Postgres row with a window), not an in-process one. `lib/portal/rate-limit.ts` is in-process and its own comment names the ceiling — limits multiply by instance count. That tradeoff was acceptable for portal ingest; for an endpoint that spends money on ad platforms it is not.

**Upstream quota** is the larger risk and the earlier draft ignored it. Google Ads enforces daily operation quotas per developer token and returns `RESOURCE_EXHAUSTED`; Meta reports headroom in `X-Business-Use-Case-Usage`. Critically, **the platform credentials are shared** between the app and the MCP servers, so an external client at full allowance can exhaust the daily mutate quota and starve the internal decision engine — presenting as an unrelated cron failure. Therefore: a per-org daily **write** budget (`api_clients.daily_write_budget`) separate from the per-minute request limit; a global upstream write budget that prioritises internal automation over external callers; `Retry-After` derived from the upstream signal; and per-tool cost weighting so `create_campaign` and `tools/list` do not draw equally. Quota exhaustion surfaces as W0's `quota` error class with `retryAfterMs`, never as `transient`.

Every call writes to `api_call_log`; metered calls also write to `usage_ledger` via the migration-163 columns.

## Interfaces

**Consumes:** `listToolDescriptors`, `SCOPE_IMPLIES`, `scopeSatisfies` (W0), `evaluateAutonomy` and the executor (W0/W1), W4a's token contract and AS metadata, `lib/db/audit-log`'s `writeAudit` for scope/state changes.

**Produces:**

```ts
export function dispatchPublicTool(ctx: PublicCallContext, name: string, args: unknown): Promise<ToolResult>;
export function publishedCatalogue(): ToolDescriptor[];
export function buildOpenApiDocument(): unknown;      // OpenAPI 3.1, validated in tests
export function checkPublicRateLimit(clientId: string, weight: number): Promise<RateDecision>;
export function protectedResourceMetadata(): ProtectedResourceMetadata;
```

Named `dispatchPublicTool` because `dispatchTool` already exists in `mcp/context-server/tool-context.ts` with an unrelated signature.

## Testing

- `catalogue.test.ts` — every published name exists in the allowlist; every `effect: 'execute'` descriptor carries `actionKind` and a write scope; the four ungated Google Ads mutation tools are absent.
- `scopes.test.ts` — required scope resolution honours `SCOPE_IMPLIES`; propose-only tokens cannot execute.
- `no-bypass.test.ts` — the exhaustive registry sweep and the single-call-site assertion described above.
- `token.test.ts` — wrong audience, wrong issuer, expired, unknown `kid`, `gs_session` cookie and internal task token are each rejected.
- `rest-semantics.test.ts` — the full status table above, including `Location` headers and idempotency replay.
- `ratelimit.test.ts` — shared counter survives two simulated instances; write budget separate from request limit; `Retry-After` present on `quota`.
- `openapi.test.ts` — validates against OpenAPI 3.1 and covers every documented endpoint.
- `w4-gate.test.ts` — full external call path with a signed audience-bound token: metadata discovery, validation, scope check, dispatch, `api_call_log` row, `usage_ledger` row with `client_id`.

## Revision notes (2026-08-13)

Review found the original draft cited a stale MCP revision and misstated the DCR requirement level; asserted a containment invariant that would have permitted publishing ungated mutation tools; assigned the entire authorization-server build to `auth-service` in one sentence, with no owner, path allocation or migration budget (now W4a); pointed at a token-validation pattern that performs no audience check; claimed metering that the existing `usage_ledger` schema forbids; and ignored upstream platform quota entirely. All are addressed above. Two W0 interface changes were required and have been made before W0 freezes: `effect`/`scope`/`internalToolName` on `ToolDescriptor`, and a `quota` error class with `retryAfterMs`.
