# Task 1 Report — A-MCP: Dual surface registration

**Agent:** A-MCP · **Branch:** `feat/ads-agent-gate-integrity` · **Date:** 2026-09-18  
**Status:** DONE

## Summary

Split `google-ads-mcp` tool registration into **read** (3 tools, default) and **write** (5 tools) surfaces controlled by `GOOGLE_ADS_MCP_SURFACE`, with Compose service `google-ads-mcp-write` on port 8769. Closes P0 wire-level gap: `:8766` no longer advertises mutate tools.

## Files changed

| File | Change |
|------|--------|
| `ads-agent/mcp/google-ads-server/surface.ts` | **Created** — `GoogleAdsMcpSurface`, `resolveGoogleAdsMcpSurface`, `resolveGoogleAdsMcpPort` |
| `ads-agent/mcp/google-ads-server/index.ts` | **Modified** — `registerReadTools` / `registerWriteTools`; `buildGoogleAdsMcpServer(surface)`; `startGoogleAdsMcpServer` binds surface + port from env |
| `ads-agent/mcp/google-ads-server/index.test.ts` | **Modified** — surface split tests, port/surface resolver tests; handler tests target correct surface |
| `ads-agent/scripts/run-google-ads-mcp.ts` | **Modified** — passes `resolveGoogleAdsMcpPort()` to `startGoogleAdsMcpServer` |
| `ads-agent/docker-compose.yml` | **Modified** — added `google-ads-mcp-write` service (`8769:8769`, `GOOGLE_ADS_MCP_SURFACE=write`, `GOOGLE_ADS_MCP_PORT=8769`) |

## Interfaces delivered

- `export type GoogleAdsMcpSurface = "read" | "write"`
- `resolveGoogleAdsMcpSurface(env?)` — `"write"` only when env is exactly `"write"`; else `"read"`
- `resolveGoogleAdsMcpPort(env?)` — default `8766`; invalid/unset falls back to `8766`
- `buildGoogleAdsMcpServer(surface?)` — registers tools by surface
- Re-exports of surface helpers from `index.ts` for script consumers

### Tool sets (verified in tests)

**Read:** `list_campaign_performance`, `search_terms_report`, `list_accessible_customers`  
**Write:** `create_campaign`, `pause_campaign`, `update_campaign_budget`, `add_negative_keyword`, `propose_change`

## TDD

1. Updated `index.test.ts` with failing surface expectations (replacing monolithic “8 tools” assertion).
2. Implemented `surface.ts` + refactored `index.ts`.
3. **Tests:** `npx vitest run mcp/google-ads-server/index.test.ts` — **14 passed**.

## Self-review

### Architect / API design

- **Safety default:** Unset or invalid `GOOGLE_ADS_MCP_SURFACE` → read-only registration (matches D1).
- **Single binary, two processes:** Same image/command; env distinguishes surfaces — no duplicate server code paths beyond registration.
- **Human gate unchanged:** `propose_change` remains on write surface only; read surface has zero mutate tools — external MCP clients on `:8766` cannot call Google mutate tools.
- **Port resolution:** `GOOGLE_ADS_MCP_PORT` honored for write Compose mapping `8769:8769`.

### Code quality

- Registration logic split into `registerReadTools` / `registerWriteTools` — minimal diff, no new dependencies.
- Tests use existing `InMemoryTransport` pattern; `registeredToolNames(surface)` helper for listTools assertions.

### Out of scope (follow-up waves)

- `lib/bifrost/google-ads-mcp-client` `callGoogleAdsTool(..., surface)` and `GOOGLE_ADS_MCP_WRITE_URL` (D1 remainder).
- `live-smoke.test.ts` still asserts 8 tools on default read URL — will fail when live smoke runs against read-only server; update in a later task or split smoke by surface.
- `.env.example` / README write URL documentation (not in file lock).

### File lock compliance

Only touched paths listed in task brief. No changes to bifrost, UI, draft-rules, connectors, preflight.

## Compose snippet (write service)

```yaml
google-ads-mcp-write:
  environment:
    GOOGLE_ADS_MCP_SURFACE: write
    GOOGLE_ADS_MCP_PORT: "8769"
    GOOGLE_ADS_MCP_BIND: "0.0.0.0"
    GOOGLE_ADS_MCP_ALLOWED_HOSTS: localhost,127.0.0.1,google-ads-mcp-write,host.docker.internal
  ports:
    - "8769:8769"
```

## Git

Changes left **uncommitted** per coordinator instruction.
