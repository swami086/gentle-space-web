# OpenMemory MCP on GKE

Deploy Mem0 OpenMemory MCP (API + Postgres + Qdrant) to the existing GKE cluster.

## Cluster

| Setting | Value |
|---------|-------|
| GCP project | `propane-galaxy-498403-n8` |
| Cluster | `stackgen-web` |
| Zone | `us-west1-b` |
| Namespace | `openmemory` |

## Apply order

Apply manifests in numeric order. Real secrets go in a local file that is **not** committed:

```bash
kubectl apply -f deploy/openmemory/00-namespace.yaml
kubectl apply -f deploy/openmemory/01-configmap.yaml
kubectl apply -f deploy/openmemory/02-secrets.local.yaml   # create from 02-secrets.example.yaml
kubectl apply -f deploy/openmemory/10-qdrant.yaml
kubectl apply -f deploy/openmemory/20-postgres.yaml
kubectl apply -f deploy/openmemory/30-api.yaml
```

Copy `02-secrets.example.yaml` to `02-secrets.local.yaml`, replace placeholders with real values, and ensure `DATABASE_URL` is a fully resolved connection string (password embedded, not interpolated).

## Get EXTERNAL-IP

After applying `30-api.yaml`, poll until the LoadBalancer assigns an address:

```bash
kubectl -n openmemory get svc openmemory-api -o wide
```

Wait until `EXTERNAL-IP` is not `<pending>` (typically 1–3 minutes on GKE).

Current MCP URL: `http://136.67.164.6:8765/mcp/cursor/sse/GentleSpace`

## Cursor MCP URL

Update `.cursor/mcp.json` for server `openmemory-gentlespace`:

```json
"url": "http://<EXTERNAL_IP>:8765/mcp/cursor/sse/GentleSpace"
```

Replace `<EXTERNAL_IP>` with the value from `kubectl get svc`.

## Security warning

The `openmemory-api` Service is a **public HTTP LoadBalancer** on port 8765. There is no TLS or authentication in this pass. Anyone who discovers the IP can reach the API. Treat this as a short-term trade-off; follow-up should add TLS, IP allowlisting, or API auth.

Never commit `02-secrets.local.yaml` or real API keys / passwords to git.
