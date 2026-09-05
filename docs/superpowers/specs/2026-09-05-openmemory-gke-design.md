# Deploy Mem0 OpenMemory MCP on GKE — design

Date: 2026-09-05  
Status: approved  
Related: `.cursor/mcp.json` (`openmemory-gentlespace`); workspace OpenMemory rules / `openmemory.md`

## Problem

The existing OpenMemory MCP endpoint at `http://100.71.169.23:8770/mcp/cursor/sse/GentleSpace` is unreachable (Tailscale/Coolify host down). Cursor cannot use project memory (`add_memories`, `search_memory`, etc.). We need a durable, self-hosted OpenMemory MCP stack on GKE and an updated workspace MCP URL.

## Goals

1. Run **Mem0 OpenMemory MCP** (FastAPI + MCP SSE + Postgres + Qdrant) on the existing GKE cluster `stackgen-web` (`us-west1-b`, project `propane-galaxy-498403-n8`).
2. Expose the API via a **public LoadBalancer** on HTTP (short-term; TLS/auth later).
3. Preserve Cursor URL shape: `/mcp/cursor/sse/GentleSpace`.
4. Update `.cursor/mcp.json` to the new LB URL once the EXTERNAL-IP is assigned.
5. Fresh empty store (no migration from Tailscale).

## Non-goals

- Migrating memories from `100.71.169.23:8770`
- Deploying Cavira **LongMemory** (rewritten OpenMemory) — incompatible tools/API
- New GKE cluster / Autopilot golden-path cluster creation
- TLS, Cloud Armor, IAP, Tailscale subnet routing
- HA multi-replica Postgres/Qdrant
- Committing secrets (`OPENAI_API_KEY`, DB passwords) to git

## Decisions (locked in brainstorming)

| Decision | Choice |
|----------|--------|
| Product | **A** Mem0 OpenMemory MCP (not Cavira LongMemory) |
| Cluster | **B** Reuse `stackgen-web` / `us-west1-b` |
| Exposure | **C** Public LoadBalancer, HTTP |
| Data | **A** Fresh start; ignore Tailscale |
| Architecture | In-cluster full stack (API + Postgres + Qdrant + PVCs) |

## Architecture

```
Cursor ──HTTP──► Service LoadBalancer :8765
                      │
                      ▼
              openmemory-api (Deployment)
                 │           │
                 ▼           ▼
            postgres      qdrant
            (PVC)         (PVC)
```

- **Namespace:** `openmemory`
- **ServiceAccount:** `openmemory-sa`
- **API image:** `skpassegna/openmemory-mcp` (or equivalent Mem0 OpenMemory API image if tagged newer)
- **API port:** `8765` (documented for the image; Swagger at `/docs`)
- **MCP path:** `http://<EXTERNAL_IP>:8765/mcp/cursor/sse/GentleSpace`
- **Postgres / Qdrant:** ClusterIP only; not publicly exposed
- **Storage:** PVCs `standard-rwo` (~20Gi each) for Postgres and Qdrant
- **Secrets:** Kubernetes Secret for `OPENAI_API_KEY` and Postgres password (created at apply time; not in git)

## Components

| Resource | Purpose |
|----------|---------|
| Namespace `openmemory` | Isolation |
| ServiceAccount `openmemory-sa` | Dedicated SA (not `default`) |
| Secret `openmemory-secrets` | `OPENAI_API_KEY`, `POSTGRES_PASSWORD` |
| ConfigMap `openmemory-config` | Non-secret hostnames / connection hints |
| Deployment `qdrant` + PVC + ClusterIP Service | Vector store (`6333`) |
| Deployment `postgres` + PVC + ClusterIP Service | Relational store (`5432`) |
| Deployment `openmemory-api` + LoadBalancer Service | API + MCP SSE (`8765`) |

## Environment (API)

Required / expected (from image docs + Mem0 OpenMemory guides):

- `OPENAI_API_KEY` — embedding/LLM provider (from Secret)
- `USER` — default user id; set to `GentleSpace` for parity with MCP path user segment
- `QDRANT_HOST` — `qdrant` (in-cluster DNS short name in namespace)
- `DATABASE_URL` — `postgresql://openmemory:<password>@postgres:5432/openmemory` (password from Secret)

## mcp.json cutover

Replace:

```json
"url": "http://100.71.169.23:8770/mcp/cursor/sse/GentleSpace"
```

with:

```json
"url": "http://<EXTERNAL_IP>:8765/mcp/cursor/sse/GentleSpace"
```

Keep existing `alwaysAllow` tool names unchanged.

## Verification

1. All pods Ready in namespace `openmemory`
2. LoadBalancer EXTERNAL-IP assigned
3. `curl -sf http://<EXTERNAL_IP>:8765/docs` returns HTML/JSON docs
4. Cursor MCP shows `openmemory-gentlespace` connected with memory tools
5. Smoke: add one memory via MCP, search it back

## Security note

Public HTTP LoadBalancer is an explicit short-term trade-off. Follow-up (out of scope): TLS termination, IP allowlist / Cloud Armor, and API auth if the image supports it.

## Skills / research used

- Catalog: `gke-cluster-creation`, `gke-app-onboarding`, `gke-manifest-generation`, `gke-storage`, `kubernetes-deploying`, `gcloud`, `longmemory` (installed; not used for this product choice), `firecrawl-cli`, `brainstorming`, `writing-plans`
- Firecrawl: Mem0 OpenMemory MCP path shape, `skpassegna/openmemory-mcp` port `8765` / env vars; Cavira LongMemory distinguished and rejected
