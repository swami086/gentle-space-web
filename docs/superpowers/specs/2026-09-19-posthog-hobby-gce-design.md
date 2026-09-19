# PostHog hobby self-host on GCE — Design

**Date:** 2026-09-19  
**Status:** Approved (brainstorming)  
**Feature:** Self-host PostHog (official Docker Compose hobby) on a new GCE VM, wire the Gentle Space Next.js app first, see Live events / product insights. iOS later.

## Goal

Run PostHog ourselves on GCP so we can inspect product analytics (pageviews, funnels, session replay later) for the Spaces Next.js app — without replacing ClickHouse, Langfuse, portal events, or GKE workloads.

## Non-goals

- GKE / Helm install (PostHog [sunset Kubernetes support](https://posthog.com/blog/sunsetting-helm-support-posthog)).
- Replacing ClickHouse context graph, portal `search_performed`, or Langfuse.
- Broker Field iOS SDK (follow-up).
- Deleting or modifying `coolify-gcp-replica`, `gentle-space-web`, or GKE nodes.
- Custom reverse proxies, self-signed certs, or bare-IP HTTPS.

## Decisions (brainstorming)

| Question | Decision |
|---|---|
| Backend host | Self-host (not PostHog Cloud) |
| Where | New GCE VM — not GKE; existing VMs lack spare capacity |
| Domain | `<EXTERNAL_IP>.sslip.io` (official installer requires a hostname, **not** a raw IP) |
| Clients this round | Next.js Spaces app only |
| Coolify replica | Leave running; do not delete |

## Capacity check (gcloud, 2026-09-19)

Project `propane-galaxy-498403-n8`. Hobby needs ≥8GB RAM (deploy script) / docs suggest ~16GB + >30GB disk.

No suitable free host: GKE nodes excluded; `openmemory-uswest` 4GB; `gentle-space-web` already ~full; `kite-host` disk too small; Coolify left alone. **→ new VM.**

## Architecture

```
Browser / Next.js (localhost:3002)
        |  posthog-js → HTTPS
        v
https://<VM-IP>.sslip.io   (Caddy + Let's Encrypt from hobby installer)
        |
 PostHog hobby Docker Compose stack on GCE VM `posthog-hobby`
```

Does **not** share ClickHouse with Gentle Space analytics.

## Login / access safety (avoid Sourcegraph-class failures)

1. Always use `https://<IP>.sslip.io` — never `http://IP`.
2. Pass that exact hostname to `deploy-hobby` / hobby-installer (script: “NOT an IP address”).
3. Firewall: TCP 80 + 443 to the VM (Let’s Encrypt + UI).
4. No GKE Ingress, no competing self-signed TLS secrets.
5. After boot: create PostHog project in UI → API key into Next.js env only.

## VM spec

| Field | Value |
|---|---|
| Name | `posthog-hobby` |
| Project | `propane-galaxy-498403-n8` |
| Zone | `us-west1-b` |
| Machine | `e2-standard-4` (4 vCPU / 16GB) |
| Disk | 50GB pd-balanced (or default SSD) |
| Image | Ubuntu 22.04 LTS |
| Network tag | `posthog-hobby` |
| Firewall | `allow-posthog-hobby-http` → tcp:80,443 → tag `posthog-hobby` |
| Public IP | Ephemeral OK; hostname = `<natIP>.sslip.io` |

## Install (official only)

Per [Self-host PostHog](https://posthog.com/docs/self-host):

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/posthog/posthog/HEAD/bin/deploy-hobby)"
# or: ./hobby-installer --ci --domain=<EXTERNAL_IP>.sslip.io
```

Wait ~5–10 minutes for migrations + TLS. Open `https://<EXTERNAL_IP>.sslip.io`.

Disclaimer: self-hosted is [officially unsupported](https://posthog.com/docs/self-host/open-source/disclaimer); user assumes ops risk.

## Next.js wiring (after UI is reachable)

Per [Next.js library docs](https://posthog.com/docs/libraries/next-js):

- Package: `posthog-js`
- Env: `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST=https://<IP>.sslip.io`
- Prefer official App Router init (`instrumentation-client` / documented path for current Next)
- Prefer gating capture behind existing `site_analytics` consent when practical
- Success: browse `/spaces` → events visible in PostHog Live

## Success criteria

1. `https://<IP>.sslip.io` loads PostHog UI; admin can sign up / log in.
2. Project API key works from local Next.js.
3. At least one `$pageview` or custom event appears in Live.
4. Coolify / GKE / ClickHouse / Langfuse unchanged.

## References

- https://posthog.com/docs/self-host  
- https://posthog.com/docs/libraries/next-js  
- https://posthog.com/blog/sunsetting-helm-support-posthog  
- `~/sourcegraph-gke/README.md` (TLS / URL login lessons)
