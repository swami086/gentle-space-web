# OpenMemory MCP on GKE Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Executor model:** Use **Composer 2.5** (`composer-2.5-fast`) for all implementation subagents and inline execution of this plan.

**Goal:** Deploy Mem0 OpenMemory MCP (API + Postgres + Qdrant) onto existing GKE cluster `stackgen-web` with a public HTTP LoadBalancer, then point `.cursor/mcp.json` at `http://<EXTERNAL_IP>:8765/mcp/cursor/sse/GentleSpace`.

**Architecture:** Namespace `openmemory` on `stackgen-web` / `us-west1-b` / project `propane-galaxy-498403-n8`. Three workloads: `qdrant` and `postgres` (ClusterIP + PVC), `openmemory-api` (Deployment + LoadBalancer on port 8765). Fresh empty store; no Tailscale migration. Secrets created at apply time and never committed.

**Tech Stack:** GKE, kubectl, Kubernetes YAML manifests, `skpassegna/openmemory-mcp`, `postgres:16-alpine`, `qdrant/qdrant`, Cursor MCP JSON.

**Related:** [`docs/superpowers/specs/2026-09-05-openmemory-gke-design.md`](../specs/2026-09-05-openmemory-gke-design.md) (approved design — read first).

## Global Constraints

- Project: `propane-galaxy-498403-n8`. Cluster: `stackgen-web`. Location: `us-west1-b`. Do not create a new GKE cluster.
- Product is **Mem0 OpenMemory MCP**, not Cavira LongMemory. Do not deploy `ghcr.io/caviraoss/longmemory`.
- Public HTTP LoadBalancer is intentional for this pass; do not add TLS/Ingress unless the user asks.
- Never commit `OPENAI_API_KEY`, Postgres passwords, or raw Secret YAML with secret values. Manifests in git use placeholders or `stringData` only in a local untracked secrets apply file (gitignored).
- Preserve MCP path user id `GentleSpace` and Cursor client segment `cursor`.
- Follow `gcloud` skill: validate leaf `gcloud help` before inventing flags; use `--quiet`; no pipes in `run_gcloud_command` MCP; prefer kubectl after credentials are fetched.
- Manifest hardening baseline from `gke-manifest-generation` / `gke-app-onboarding`: explicit namespace, dedicated SA, resource requests/limits, probes, ClusterIP for internal services.
- Repo artifacts live under `deploy/openmemory/` (new). Only tracked config change for cutover is `.cursor/mcp.json` URL (and optional `.gitignore` entry for local secrets).

---

## File map

| Path | Responsibility |
|------|----------------|
| `deploy/openmemory/00-namespace.yaml` | Namespace + ServiceAccount |
| `deploy/openmemory/01-configmap.yaml` | Non-secret config |
| `deploy/openmemory/02-secrets.example.yaml` | Example Secret shape (placeholders only; committed) |
| `deploy/openmemory/02-secrets.local.yaml` | Real secrets (gitignored; created at apply time) |
| `deploy/openmemory/10-qdrant.yaml` | PVC + Deployment + ClusterIP Service |
| `deploy/openmemory/20-postgres.yaml` | PVC + Deployment + ClusterIP Service |
| `deploy/openmemory/30-api.yaml` | API Deployment + LoadBalancer Service |
| `deploy/openmemory/README.md` | Apply order, credentials, verification commands |
| `.gitignore` | Ignore `deploy/openmemory/02-secrets.local.yaml` if not already covered |
| `.cursor/mcp.json` | Cutover URL to LB |

---

## Parallel Execution Waves

| Wave | Tasks | Depends on | Executor |
|------|-------|------------|----------|
| 1 | Task 1 (manifests scaffold + gitignore) | — | Composer 2.5 |
| 2 | Task 2 (cluster credentials + apply stack) | Task 1 + user secrets | Composer 2.5 (interactive secrets from user) |
| 3 | Task 3 (verify LB + smoke HTTP) | Task 2 | Composer 2.5 |
| 4 | Task 4 (update mcp.json + document) | Task 3 | Composer 2.5 |

---

### Task 1: Scaffold Kubernetes manifests under `deploy/openmemory/`

**Files:**
- Create: `deploy/openmemory/00-namespace.yaml`
- Create: `deploy/openmemory/01-configmap.yaml`
- Create: `deploy/openmemory/02-secrets.example.yaml`
- Create: `deploy/openmemory/10-qdrant.yaml`
- Create: `deploy/openmemory/20-postgres.yaml`
- Create: `deploy/openmemory/30-api.yaml`
- Create: `deploy/openmemory/README.md`
- Modify: `.gitignore` (add `deploy/openmemory/02-secrets.local.yaml`)

**Interfaces:**
- Consumes: approved design (`2026-09-05-openmemory-gke-design.md`)
- Produces: apply-ready YAML for namespace `openmemory`; Secret keys `OPENAI_API_KEY`, `POSTGRES_PASSWORD`; Services `qdrant:6333`, `postgres:5432`, `openmemory-api` LB `:8765`

- [ ] **Step 1: Ensure `.gitignore` ignores local secrets**

Add this line if missing:

```
deploy/openmemory/02-secrets.local.yaml
```

- [ ] **Step 2: Write `00-namespace.yaml`**

```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: openmemory
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: openmemory-sa
  namespace: openmemory
```

- [ ] **Step 3: Write `01-configmap.yaml`**

```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: openmemory-config
  namespace: openmemory
data:
  USER: "GentleSpace"
  QDRANT_HOST: "qdrant"
  POSTGRES_USER: "openmemory"
  POSTGRES_DB: "openmemory"
```

- [ ] **Step 4: Write `02-secrets.example.yaml` (placeholders only)**

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: openmemory-secrets
  namespace: openmemory
type: Opaque
stringData:
  OPENAI_API_KEY: "REPLACE_ME"
  POSTGRES_PASSWORD: "REPLACE_ME"
```

- [ ] **Step 5: Write `10-qdrant.yaml`**

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: qdrant-data
  namespace: openmemory
spec:
  accessModes: ["ReadWriteOnce"]
  storageClassName: standard-rwo
  resources:
    requests:
      storage: 20Gi
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: qdrant
  namespace: openmemory
  labels:
    app: qdrant
spec:
  replicas: 1
  selector:
    matchLabels:
      app: qdrant
  template:
    metadata:
      labels:
        app: qdrant
    spec:
      serviceAccountName: openmemory-sa
      securityContext:
        fsGroup: 1000
      containers:
        - name: qdrant
          image: qdrant/qdrant:v1.13.2
          ports:
            - name: http
              containerPort: 6333
            - name: grpc
              containerPort: 6334
          volumeMounts:
            - name: data
              mountPath: /qdrant/storage
          resources:
            requests:
              cpu: "100m"
              memory: "512Mi"
            limits:
              cpu: "500m"
              memory: "1Gi"
          readinessProbe:
            httpGet:
              path: /readyz
              port: 6333
            initialDelaySeconds: 5
            periodSeconds: 10
          livenessProbe:
            httpGet:
              path: /livez
              port: 6333
            initialDelaySeconds: 15
            periodSeconds: 20
      volumes:
        - name: data
          persistentVolumeClaim:
            claimName: qdrant-data
---
apiVersion: v1
kind: Service
metadata:
  name: qdrant
  namespace: openmemory
spec:
  type: ClusterIP
  selector:
    app: qdrant
  ports:
    - name: http
      port: 6333
      targetPort: 6333
    - name: grpc
      port: 6334
      targetPort: 6334
```

- [ ] **Step 6: Write `20-postgres.yaml`**

```yaml
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: postgres-data
  namespace: openmemory
spec:
  accessModes: ["ReadWriteOnce"]
  storageClassName: standard-rwo
  resources:
    requests:
      storage: 20Gi
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: postgres
  namespace: openmemory
  labels:
    app: postgres
spec:
  replicas: 1
  selector:
    matchLabels:
      app: postgres
  template:
    metadata:
      labels:
        app: postgres
    spec:
      serviceAccountName: openmemory-sa
      securityContext:
        fsGroup: 999
      containers:
        - name: postgres
          image: postgres:16-alpine
          ports:
            - name: postgres
              containerPort: 5432
          env:
            - name: POSTGRES_USER
              valueFrom:
                configMapKeyRef:
                  name: openmemory-config
                  key: POSTGRES_USER
            - name: POSTGRES_DB
              valueFrom:
                configMapKeyRef:
                  name: openmemory-config
                  key: POSTGRES_DB
            - name: POSTGRES_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: openmemory-secrets
                  key: POSTGRES_PASSWORD
            - name: PGDATA
              value: /var/lib/postgresql/data/pgdata
          volumeMounts:
            - name: data
              mountPath: /var/lib/postgresql/data
          resources:
            requests:
              cpu: "100m"
              memory: "256Mi"
            limits:
              cpu: "500m"
              memory: "512Mi"
          readinessProbe:
            exec:
              command: ["pg_isready", "-U", "openmemory", "-d", "openmemory"]
            initialDelaySeconds: 5
            periodSeconds: 10
          livenessProbe:
            exec:
              command: ["pg_isready", "-U", "openmemory", "-d", "openmemory"]
            initialDelaySeconds: 15
            periodSeconds: 20
      volumes:
        - name: data
          persistentVolumeClaim:
            claimName: postgres-data
---
apiVersion: v1
kind: Service
metadata:
  name: postgres
  namespace: openmemory
spec:
  type: ClusterIP
  selector:
    app: postgres
  ports:
    - name: postgres
      port: 5432
      targetPort: 5432
```

- [ ] **Step 7: Write `30-api.yaml`**

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: openmemory-api
  namespace: openmemory
  labels:
    app: openmemory-api
spec:
  replicas: 1
  selector:
    matchLabels:
      app: openmemory-api
  template:
    metadata:
      labels:
        app: openmemory-api
    spec:
      serviceAccountName: openmemory-sa
      containers:
        - name: api
          image: skpassegna/openmemory-mcp:latest
          ports:
            - name: http
              containerPort: 8765
          env:
            - name: OPENAI_API_KEY
              valueFrom:
                secretKeyRef:
                  name: openmemory-secrets
                  key: OPENAI_API_KEY
            - name: USER
              valueFrom:
                configMapKeyRef:
                  name: openmemory-config
                  key: USER
            - name: QDRANT_HOST
              valueFrom:
                configMapKeyRef:
                  name: openmemory-config
                  key: QDRANT_HOST
            - name: DATABASE_URL
              value: "postgresql://openmemory:$(POSTGRES_PASSWORD)@postgres:5432/openmemory"
            - name: POSTGRES_PASSWORD
              valueFrom:
                secretKeyRef:
                  name: openmemory-secrets
                  key: POSTGRES_PASSWORD
          resources:
            requests:
              cpu: "200m"
              memory: "512Mi"
            limits:
              cpu: "1000m"
              memory: "1Gi"
          readinessProbe:
            tcpSocket:
              port: 8765
            initialDelaySeconds: 10
            periodSeconds: 10
          livenessProbe:
            tcpSocket:
              port: 8765
            initialDelaySeconds: 30
            periodSeconds: 20
---
apiVersion: v1
kind: Service
metadata:
  name: openmemory-api
  namespace: openmemory
spec:
  type: LoadBalancer
  selector:
    app: openmemory-api
  ports:
    - name: http
      port: 8765
      targetPort: 8765
```

**Important implementer note:** Kubernetes does **not** expand `$(POSTGRES_PASSWORD)` inside a plain `value:` string for `DATABASE_URL`. In Task 2, after creating the real Secret, either:

1. Set `DATABASE_URL` as a fully resolved string in the Secret (preferred), and reference it with `secretKeyRef`, **or**
2. Use an entrypoint/env wrapper.

Preferred fix for apply: put complete `DATABASE_URL` in `openmemory-secrets` and wire API env from that key. Update `30-api.yaml` before apply if needed so `DATABASE_URL` comes from `secretKeyRef` only (remove broken interpolation).

- [ ] **Step 8: Write `deploy/openmemory/README.md`**

Include: project/cluster, apply order (`00`→`01`→`02-secrets.local`→`10`→`20`→`30`), how to get EXTERNAL-IP, mcp.json URL template, security warning (public HTTP).

- [ ] **Step 9: Commit manifests (no secrets)**

```bash
git add deploy/openmemory .gitignore
git status
git commit -m "$(cat <<'EOF'
Add OpenMemory GKE manifests for Mem0 MCP stack.

Scaffold namespace, qdrant, postgres, and LoadBalancer API under deploy/openmemory for stackgen-web.
EOF
)"
```

Only commit if the user has asked for commits in this session or explicitly authorizes this commit step. If commits are not authorized, stop after writing files and report paths.

---

### Task 2: Create secrets, get cluster credentials, apply stack

**Files:**
- Create (local only): `deploy/openmemory/02-secrets.local.yaml`
- Modify if needed: `deploy/openmemory/30-api.yaml` (DATABASE_URL via secretKeyRef)

**Interfaces:**
- Consumes: Task 1 manifests; user-provided `OPENAI_API_KEY` and a generated Postgres password
- Produces: Running pods in `openmemory`; LB Service pending/assigned

- [ ] **Step 1: Ask the user for `OPENAI_API_KEY`** (do not invent one). Generate a strong `POSTGRES_PASSWORD` locally (e.g. `openssl rand -hex 24`).

- [ ] **Step 2: Write `02-secrets.local.yaml` (gitignored)**

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: openmemory-secrets
  namespace: openmemory
type: Opaque
stringData:
  OPENAI_API_KEY: "<from user>"
  POSTGRES_PASSWORD: "<generated>"
  DATABASE_URL: "postgresql://openmemory:<generated>@postgres:5432/openmemory"
```

- [ ] **Step 3: Fix API `DATABASE_URL` to use secretKeyRef**

In `30-api.yaml`, replace the broken interpolated `DATABASE_URL` `value:` with:

```yaml
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: openmemory-secrets
                  key: DATABASE_URL
```

Remove the redundant env expansion pattern.

- [ ] **Step 4: Validate gcloud leaf help, then get credentials**

```bash
gcloud help container clusters get-credentials
```

Then:

```bash
gcloud container clusters get-credentials stackgen-web --zone=us-west1-b --project=propane-galaxy-498403-n8 --quiet
```

Expected: kubeconfig context updated for `stackgen-web`.

- [ ] **Step 5: Apply manifests in order**

```bash
kubectl apply -f deploy/openmemory/00-namespace.yaml
kubectl apply -f deploy/openmemory/01-configmap.yaml
kubectl apply -f deploy/openmemory/02-secrets.local.yaml
kubectl apply -f deploy/openmemory/10-qdrant.yaml
kubectl apply -f deploy/openmemory/20-postgres.yaml
kubectl apply -f deploy/openmemory/30-api.yaml
```

Expected: `created` / `configured` for each resource.

- [ ] **Step 6: Wait for rollouts**

```bash
kubectl -n openmemory rollout status deployment/qdrant --timeout=300s
kubectl -n openmemory rollout status deployment/postgres --timeout=300s
kubectl -n openmemory rollout status deployment/openmemory-api --timeout=300s
kubectl -n openmemory get pods
```

Expected: all pods `Running` / `Ready`. If API CrashLoops, check `kubectl -n openmemory logs deploy/openmemory-api` for missing env / DB connectivity and fix before Task 3.

---

### Task 3: Wait for LoadBalancer IP and smoke-test HTTP

**Files:**
- None (ops verification); may append EXTERNAL-IP to `deploy/openmemory/README.md`

**Interfaces:**
- Consumes: Service `openmemory-api` in namespace `openmemory`
- Produces: Concrete MCP base URL `http://<EXTERNAL_IP>:8765/mcp/cursor/sse/GentleSpace`

- [ ] **Step 1: Poll for EXTERNAL-IP**

```bash
kubectl -n openmemory get svc openmemory-api -o wide
```

Repeat until `EXTERNAL-IP` is not `<pending>` (may take 1–3 minutes on GKE).

- [ ] **Step 2: Smoke docs endpoint**

```bash
curl -sS -o /dev/null -w "%{http_code}\n" "http://<EXTERNAL_IP>:8765/docs"
```

Expected: `200` (or `307`/`301` then follow). If connection refused, verify `targetPort` and pod readiness.

- [ ] **Step 3: Smoke MCP SSE path exists**

```bash
curl -sS -D - -o /dev/null --max-time 10 "http://<EXTERNAL_IP>:8765/mcp/cursor/sse/GentleSpace"
```

Expected: HTTP headers indicating SSE or MCP stream (often `text/event-stream` or 200 with streaming). Do not fail the plan solely on body content if headers show the route is live; Cursor will complete the handshake.

- [ ] **Step 4: Record the URL in `deploy/openmemory/README.md`**

Add a line: `Current MCP URL: http://<EXTERNAL_IP>:8765/mcp/cursor/sse/GentleSpace`

---

### Task 4: Update Cursor MCP config and verify cutover checklist

**Files:**
- Modify: `.cursor/mcp.json` (lines for `openmemory-gentlespace.url`)

**Interfaces:**
- Consumes: EXTERNAL-IP from Task 3
- Produces: Workspace MCP pointing at GKE OpenMemory

- [ ] **Step 1: Update `.cursor/mcp.json`**

Set:

```json
"url": "http://<EXTERNAL_IP>:8765/mcp/cursor/sse/GentleSpace"
```

Keep `alwaysAllow` tools unchanged:

```json
"alwaysAllow": [
  "add_memories",
  "search_memory",
  "list_memories",
  "delete_all_memories"
]
```

- [ ] **Step 2: Tell the user to reload MCP servers in Cursor**

User action required: reload MCP / restart Cursor agents so `openmemory-gentlespace` reconnects.

- [ ] **Step 3: Checklist against the design**

- [ ] Namespace `openmemory` on `stackgen-web`
- [ ] Public LB HTTP on `:8765`
- [ ] Path `/mcp/cursor/sse/GentleSpace`
- [ ] Fresh store (no Tailscale migration)
- [ ] `.cursor/mcp.json` updated
- [ ] No secrets committed

- [ ] **Step 4: Optional commit (only if user asks)**

```bash
git add .cursor/mcp.json deploy/openmemory/README.md deploy/openmemory/30-api.yaml
git commit -m "$(cat <<'EOF'
Point OpenMemory MCP at GKE LoadBalancer.

Cut over workspace mcp.json from the dead Tailscale host to the new openmemory-api service.
EOF
)"
```

---

## Spec coverage self-check

| Spec requirement | Task |
|------------------|------|
| Mem0 OpenMemory MCP (not LongMemory) | Tasks 1–2 (`skpassegna/openmemory-mcp`) |
| Reuse `stackgen-web` | Task 2 credentials |
| Public LB HTTP | Task 1 `30-api.yaml` + Task 3 |
| Path `/mcp/cursor/sse/GentleSpace` | Tasks 3–4 |
| Fresh store | Task 2 (empty PVCs) |
| Update mcp.json | Task 4 |
| Secrets not in git | Task 1 gitignore + Task 2 local secrets |
| PVCs for Postgres/Qdrant | Task 1 `10`/`20` |

## Placeholder scan

No TBD/TODO left in steps. `DATABASE_URL` interpolation pitfall is called out with an explicit fix in Task 2.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-05-openmemory-gke.md`.

**Executor:** Composer 2.5 (`composer-2.5-fast`) for all implementation work.

**Two execution options:**

1. **Subagent-Driven (recommended)** — dispatch a fresh Composer 2.5 subagent per task, review between tasks  
2. **Inline Execution** — run tasks in this session with `executing-plans`, checkpoints between waves  

**Before Task 2:** you must provide an `OPENAI_API_KEY` (or confirm another embed provider the image supports).

Which approach — **1** or **2**?
