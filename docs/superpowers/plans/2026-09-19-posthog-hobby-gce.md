# PostHog Hobby GCE Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up official PostHog hobby Compose on a new GCE VM and wire the Next.js Spaces app so Live events appear.

**Architecture:** New Ubuntu VM `posthog-hobby` (e2-standard-4, us-west1-b) runs stock `deploy-hobby` behind `https://<IP>.sslip.io`. Next.js uses `posthog-js` with `NEXT_PUBLIC_POSTHOG_*` pointing at that host. No GKE, no ClickHouse replacement.

**Tech Stack:** GCE, Ubuntu 22.04, Docker Compose (PostHog hobby), `posthog-js`, Next.js 15 App Router

## Global Constraints

- Official hobby install only — no Helm/GKE ([sunset](https://posthog.com/blog/sunsetting-helm-support-posthog)).
- Domain for installer = `<EXTERNAL_IP>.sslip.io`, never bare IP.
- Access UI only via HTTPS on that hostname.
- Do not delete/modify `coolify-gcp-replica`, GKE nodes, or `gentle-space-web`.
- iOS out of scope this plan.
- Spec: `docs/superpowers/specs/2026-09-19-posthog-hobby-gce-design.md`

---

## File map

| Path | Role |
|---|---|
| GCP: VM `posthog-hobby` + firewall tag | Host |
| `~/.env.local` / project `.env.local` | `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` (secrets not committed) |
| `app/` or root `instrumentation-client.ts` | Official PostHog init |
| `docs/superpowers/specs/2026-09-19-posthog-hobby-gce-design.md` | Spec (done) |

---

### Task 1: Create GCE VM + firewall

**Steps:**

- [ ] `gcloud compute firewall-rules create allow-posthog-hobby-http --allow=tcp:80,tcp:443 --source-ranges=0.0.0.0/0 --target-tags=posthog-hobby --description='PostHog hobby UI + Let's Encrypt'`
- [ ] `gcloud compute instances create posthog-hobby --zone=us-west1-b --machine-type=e2-standard-4 --boot-disk-size=50GB --image-family=ubuntu-2204-lts --image-project=ubuntu-os-cloud --tags=posthog-hobby --scopes=cloud-platform`
- [ ] Record EXTERNAL_IP; confirm hostname `https://EXTERNAL_IP.sslip.io`

**Verify:** `gcloud compute instances describe posthog-hobby --zone=us-west1-b --format='get(networkInterfaces[0].accessConfigs[0].natIP)'` returns an IP; `curl -I http://IP` may fail until install — SSH works.

---

### Task 2: Official hobby install on the VM

**Steps:**

- [ ] SSH: `gcloud compute ssh posthog-hobby --zone=us-west1-b`
- [ ] Run official installer with domain set to `$IP.sslip.io` (interactive `deploy-hobby` or `hobby-installer --ci --domain=$IP.sslip.io`)
- [ ] Wait until web is up (~5–10 min)
- [ ] Open `https://$IP.sslip.io` in browser; complete first-user signup

**Verify:** HTTPS 200 on PostHog login/UI; no cert errors in browser.

---

### Task 3: Next.js SDK

**Steps:**

- [ ] Create project in PostHog UI; copy project API key
- [ ] Add to `.env.local`: `NEXT_PUBLIC_POSTHOG_KEY=…`, `NEXT_PUBLIC_POSTHOG_HOST=https://$IP.sslip.io`
- [ ] `npm install posthog-js`
- [ ] Init per current [Next.js docs](https://posthog.com/docs/libraries/next-js) (instrumentation-client / provider)
- [ ] Optionally skip capture until `site_analytics` consent granted

**Verify:** Local `npm run dev`; hit `/spaces`; PostHog Live shows `$pageview` (or equivalent).

---

### Task 4: Docs / memory

**Steps:**

- [ ] Note URL + VM name in `openmemory.md` (no API keys)
- [ ] Store OpenMemory fact: PostHog hobby at `https://…sslip.io` on `posthog-hobby`

**Verify:** Spec + plan paths documented; secrets only in `.env.local`.
