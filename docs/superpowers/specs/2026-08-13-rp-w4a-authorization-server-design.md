# RP-W4a — OAuth 2.1 authorization server in `auth-service`

Date: 2026-08-13  
Status: approved (added 2026-08-13 — split out of W4 during review)  
Program: [`2026-08-13-rp-program-design.md`](2026-08-13-rp-program-design.md)  
Blocks: W4 ([`2026-08-13-rp-w4-public-api-design.md`](2026-08-13-rp-w4-public-api-design.md))  
Migration range: `auth-service` own schema and own migration sequence  
Owned paths: `auth-service/`

## Problem

W4 needs an OAuth 2.1 authorization server. Its original draft delegated this in a single sentence — "`auth-service` becomes the authorization server" — which understated the work and left it unowned: no workstream claimed `auth-service/`, and the program's migration ranges cover the `adsagent` schema only.

`auth-service` today is a NextAuth relying party that issues session cookies. Its entire route surface is `/api/auth/[...nextauth]`, `/api/jwks`, `/api/refresh`, `/api/session/signout`, `/bridge`, `/login` and `/internal/org-members`. There is no `/authorize`, no `/token`, no client store, no consent screen, no PKCE, no authorization-code storage and no grant records. The RS256 signing and JWKS publication it already has are genuinely reusable; nothing else about an authorization server exists.

## Goals

1. An OAuth 2.1 authorization server with the authorization-code flow and PKCE.
2. Client identity by **Client ID Metadata Documents** (the current SHOULD), with pre-registered clients supported and Dynamic Client Registration explicitly deferred.
3. Audience-bound access tokens honouring the `resource` parameter, so W4 can enforce its audience MUST.
4. A consent screen and a grant-management surface an org admin can audit and revoke.
5. Discovery metadata so MCP clients can find all of this without configuration.

## Non-goals

- Replacing the existing NextAuth session flow for the admin UI. The session cookie path stays exactly as it is; this adds a parallel OAuth surface for API clients.
- Dynamic Client Registration as initial scope. It is **MAY** and **deprecated** in the current MCP revision, retained only for backwards compatibility; add it later only if a target client cannot use a metadata document.
- Issuing tokens for anything other than the W4 canonical resource in this workstream.

## Standards basis

Current MCP revision: **[2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)**.

| Requirement | Level |
|---|---|
| Implement OAuth 2.1 with appropriate security measures | **MUST** |
| Publish [RFC 8414](https://datatracker.ietf.org/doc/html/rfc8414) authorization-server metadata or OIDC Discovery | **MUST** |
| Bind the requested `resource` ([RFC 8707](https://datatracker.ietf.org/doc/html/rfc8707)) into the token audience | **MUST** |
| Return `iss` in authorization responses ([RFC 9207](https://datatracker.ietf.org/doc/html/rfc9207)) | **MUST** |
| Support OAuth Client ID Metadata Documents | **SHOULD** |
| Support Dynamic Client Registration | **MAY**, deprecated |

## Architecture

```text
MCP client
  │ 1. GET  /.well-known/oauth-protected-resource/mcp        (ads-agent, W4)
  │ 2. GET  /.well-known/oauth-authorization-server          (auth-service, here)
  │ 3. GET  /authorize?client_id=…&resource=…&code_challenge=…&scope=…
  │         → existing NextAuth login if no session → consent screen → code (+ iss)
  │ 4. POST /token   (code + PKCE verifier + resource)
  │         → access token with aud = resource, scope = granted subset
  ▼
ads-agent public gateway validates aud/iss/scope locally against /api/jwks
```

Steps 1 and the validation belong to W4; everything else is this workstream.

## Endpoints added

| Route | Purpose |
|---|---|
| `GET /.well-known/oauth-authorization-server` | RFC 8414 metadata: issuer, `authorization_endpoint`, `token_endpoint`, `jwks_uri`, `scopes_supported`, `response_types_supported`, `code_challenge_methods_supported: ["S256"]`, `grant_types_supported` |
| `GET /authorize` | Authorization-code flow, PKCE required (`S256` only), `resource` required, `iss` in the response |
| `POST /token` | Code exchange and refresh-token grant; binds `aud` from `resource` |
| `POST /revoke` | Token revocation |
| `GET /consent` | Consent screen (server-rendered) |
| `GET|POST /admin/grants` | Org-admin listing and revocation of client grants |

## Data model (`auth_service` schema, own sequence)

```sql
CREATE TABLE oauth_clients (
  client_id            text PRIMARY KEY,
  org_id               uuid,                  -- null for clients usable by any org
  name                 text NOT NULL,
  client_id_metadata_url text,                -- Client ID Metadata Document (preferred)
  client_secret_hash   text,                  -- confidential clients only
  secret_created_at    timestamptz,
  secret_rotates_at    timestamptz,           -- two live secrets permitted during rollover
  redirect_uris        text[] NOT NULL,
  grant_types          text[] NOT NULL DEFAULT ARRAY['authorization_code','refresh_token'],
  token_auth_method    text NOT NULL DEFAULT 'none',
  scopes_allowed       text[] NOT NULL,
  state                text NOT NULL DEFAULT 'active'
                       CHECK (state IN ('active','suspended','revoked')),
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE oauth_authorization_codes (
  code_hash       text PRIMARY KEY,
  client_id       text NOT NULL REFERENCES oauth_clients(client_id),
  user_id         uuid NOT NULL,
  org_id          uuid NOT NULL,
  resource        text NOT NULL,
  scope           text NOT NULL,
  code_challenge  text NOT NULL,
  redirect_uri    text NOT NULL,
  expires_at      timestamptz NOT NULL,
  consumed_at     timestamptz
);

CREATE TABLE oauth_grants (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     text NOT NULL REFERENCES oauth_clients(client_id),
  org_id        uuid NOT NULL,
  user_id       uuid NOT NULL,
  resource      text NOT NULL,
  scope         text NOT NULL,
  granted_at    timestamptz NOT NULL DEFAULT now(),
  revoked_at    timestamptz,
  UNIQUE (client_id, org_id, resource)
);

CREATE TABLE oauth_refresh_tokens (
  token_hash  text PRIMARY KEY,
  grant_id    uuid NOT NULL REFERENCES oauth_grants(id),
  expires_at  timestamptz NOT NULL,
  rotated_to  text,                            -- rotation chain, for reuse detection
  revoked_at  timestamptz
);
```

Codes and tokens are stored hashed, never in plaintext. Authorization codes are single-use: `consumed_at` is set inside the same transaction that issues tokens, so a replayed code fails rather than minting a second token. Refresh-token reuse after rotation revokes the whole grant, which is the standard detection response to a stolen token.

## Token claims contract (frozen — W4 validates exactly these)

```json
{
  "iss": "https://auth.gentlespacesolutions.com",
  "aud": "https://ads.gentlespacesolutions.com/api/public/mcp",
  "sub": "<user id>",
  "org_id": "<uuid>",
  "client_id": "<oauth client id>",
  "scope": "ads:read ads:propose",
  "exp": 0,
  "nbf": 0
}
```

`scope` is a space-delimited string (not an array). `org_id` is authoritative for tenancy — W4 derives the tenant from this claim and the client row, never from a request parameter. Publishing this contract here is what lets W4 and W4a be built in parallel: both code against it, and only W4's final integration task needs the running server.

## Consent

The consent screen names the client, the org, and each requested scope in language a human can act on — `ads:write` renders as "change your live ad campaigns, subject to your approval rules", not as a raw scope string. Consent is recorded per `(client, org, resource)` in `oauth_grants` and remembered; a request for a scope beyond the existing grant re-prompts for the delta only. Org admins list and revoke grants at `/admin/grants`, and every grant or revocation writes an audit entry.

## Error handling

`invalid_request`, `invalid_client`, `invalid_grant`, `unauthorized_client`, `unsupported_grant_type`, `invalid_scope` per OAuth 2.1, returned as `400`/`401` with the standard JSON error body. A missing or unrecognised `resource` is `invalid_target`. Signing-key rotation publishes both keys in JWKS through the overlap window so in-flight tokens keep validating.

## Testing

- `authorize.test.ts` — PKCE required and `S256` only; plain challenge rejected; unregistered `redirect_uri` rejected; `iss` present in the response; missing `resource` rejected.
- `token.test.ts` — code single-use (replay fails); wrong verifier fails; `aud` equals the requested `resource`; scope granted is never broader than `scopes_allowed` or the consent record.
- `refresh.test.ts` — rotation issues a new token and invalidates the old; reuse of a rotated token revokes the grant.
- `metadata.test.ts` — RFC 8414 document contains every required field and advertises only supported grants; `offline_access` handling stated explicitly.
- `consent.test.ts` — remembered grants skip re-prompt; a scope escalation re-prompts for the delta and writes an audit entry.
- `w4a-gate.test.ts` — an end-to-end authorization-code + PKCE flow produces a token that W4's validator accepts, and a token minted for a different `resource` is rejected by that same validator.
