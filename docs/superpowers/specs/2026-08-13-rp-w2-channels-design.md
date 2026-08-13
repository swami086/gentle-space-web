# RP-W2 — LinkedIn adapter and channel depth

Date: 2026-08-13  
Status: approved  
Program: [`2026-08-13-rp-program-design.md`](2026-08-13-rp-program-design.md)  
Depends on: W0 (`lib/channels/`)  
Migration range: **140–149**  
Owned paths: `ads-agent/lib/connectors/`, `ads-agent/mcp/linkedin-ads-server/`

## Problem

Ryze advertises Google, Meta, TikTok, LinkedIn, Microsoft and Pinterest. `ads-agent` has Google and Meta, and each is shallow: Google can create a full campaign, update budget, pause and add negatives; Meta can create, update budget and pause. Neither exposes audiences, geo targeting or ad-level assets. For CRE tenant-side demand, LinkedIn is the channel that matters most after Google and Meta — TikTok is unavailable in India and Pinterest is negligible for commercial leasing.

## Goals

1. A LinkedIn Ads adapter implementing the full `ChannelAdapter` interface, reached through an in-repo MCP server, matching the `mcp/google-ads-server/` convention.
2. Depth parity on Google and Meta: audiences, geo/demographic targeting, exclusion lists, and ad-level asset writes.
3. A per-tenant channel-connection model so each org supplies its own credentials (today's env-var credentials are single-tenant).

## Non-goals

- TikTok, Microsoft, Pinterest adapters and ads-in-ChatGPT (wave 2; the interface accommodates them).
- Creative generation (W3) — this workstream writes assets it is given.
- Autonomy policy definitions (W1 owns ad action kinds).

## Architecture

```text
lib/channels/linkedin-adapter.ts ──► mcp/linkedin-ads-server (StreamableHTTP, internal)
                                          └─► LinkedIn Marketing API

lib/channels/{google,meta}-adapter.ts ──► existing connectors (extended)
                                          └─► mcp/google-ads-server (existing) / Meta SDK
```

The MCP-only backend rule from the Google Ads and Twenty integrations holds: adapters never call a platform REST API directly from application code where an in-repo MCP server exists.

## Per-tenant channel connections (migration 140)

```sql
CREATE TABLE adsagent.channel_connections (
  org_id        uuid        NOT NULL,
  channel       text        NOT NULL CHECK (channel IN ('google','meta','linkedin')),
  external_account_id text  NOT NULL,
  credential_ref text       NOT NULL,          -- 'env://NAME' or secret-manager URI, never a raw secret
  state         text        NOT NULL DEFAULT 'active'
                CHECK (state IN ('active','suspended','pending')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, channel, external_account_id)
);
ALTER TABLE adsagent.channel_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE adsagent.channel_connections FORCE ROW LEVEL SECURITY;
```

`credential_ref` follows the `env://` scheme already used by `lib/crm/twenty-secrets.ts`. No secret value is ever stored in this table. Resolution is centralised in `lib/connectors/credentials.ts`, and an `auth`-class adapter error flips `state` to `suspended` for that one connection without affecting other tenants.

## Capability matrix delivered

| Capability | Google | Meta | LinkedIn |
|---|---|---|---|
| Read performance | existing | existing | new |
| Read search terms / placements | existing | new (placement breakdown) | new |
| Create campaign | existing | existing | new |
| Update budget | existing | existing | new |
| Pause / resume | pause exists, resume new | pause exists, resume new | new |
| Negative keywords / exclusions | existing | new (audience exclusion) | new (audience exclusion) |
| Audience create / attach | new | new | new |
| Geo + demographic targeting | new | new | new |
| Ad asset write (headlines, descriptions, images) | new | new | new |

## Interfaces

**Consumes (W0):** `ChannelAdapter`, `registerAdapter`, `ToolDescriptor`, `ExecutionResult`, `getTenantConfig`.

**Produces:**

```ts
export const linkedInAdapter: ChannelAdapter;   // lib/channels/linkedin-adapter.ts
export function getConnection(orgId: string, channel: ChannelId): Promise<ChannelConnection>;
export function resolveCredential(ref: string): Promise<string>;   // never logs the value

// extended connector surface, per channel
export function createAudience(scope: OrgScope, input: AudienceInput): Promise<{ audienceId: string }>;
export function attachTargeting(scope: OrgScope, input: TargetingInput): Promise<void>;
export function writeAdAssets(scope: OrgScope, input: AdAssetInput): Promise<{ adIds: string[] }>;
export function resumeCampaign(scope: OrgScope, campaignId: string): Promise<void>;
```

`AdAssetInput` is the contract W3 produces against: `{ campaignId, adGroupId?, headlines: string[], descriptions: string[], imageArtifactKeys: string[], finalUrl: string }`.

## Error handling

Every adapter maps platform errors into the W0 taxonomy: transient 5xx and short-window rate limits are `transient`; **daily/account quota exhaustion is `quota`** (Google Ads `RESOURCE_EXHAUSTED`, Meta's `X-Business-Use-Case-Usage` headroom) and carries `retryAfterMs` — it must never be classified `transient`, because retrying into an exhausted quota burns the remaining allowance shared with the internal decision engine; disapprovals, policy violations and billing holds are `policy`; expired or revoked tokens are `auth`; schema and length violations are `validation` and should have been caught at preflight — a `validation` error reaching the platform is a preflight bug and is logged as such.

A `quota` error suspends writes for that `(org, channel)` until `retryAfterMs` elapses, and the adapter surfaces remaining headroom where the platform reports it, so the executor can back off before exhaustion rather than after.

## Testing

- `linkedin-adapter.test.ts` — every capability against a mocked MCP client; error classification table including `quota` vs `transient`; idempotency-key replay returns the original ids without a second write.
- `credentials.test.ts` — `env://` resolution, missing ref throws, resolved values never appear in a log line (assert on a captured logger).
- `connections.db.test.ts` — suspension isolates one tenant/channel; RLS prevents cross-org reads.
- `live-smoke.test.ts` — env-flagged real-account smoke, following `mcp/google-ads-server/live-smoke.test.ts`.
- `w2-gate.test.ts` — all three adapters satisfy the same interface contract (a shared conformance suite run per adapter), and every mutating tool descriptor declares an `actionKind`.
