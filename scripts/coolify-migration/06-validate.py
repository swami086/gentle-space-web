#!/usr/bin/env python3
"""Validate GCP Coolify replica and write handoff report."""
from __future__ import annotations

import json
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ENV_FILE = ROOT / ".secrets/coolify-migration/target.env"
MAP_FILE = ROOT / ".secrets/coolify-migration/uuid-map.json"
REPORT = ROOT / ".secrets/coolify-migration/HANDOFF.md"


def load_env(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        out[k] = v.strip("'\"")
    return out


def get(path: str, env: dict[str, str]):
    req = urllib.request.Request(
        env["TARGET_URL"].rstrip("/") + path,
        headers={
            "Authorization": f"Bearer {env['TARGET_TOKEN']}",
            "Accept": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        raw = r.read().decode()
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return raw


def main() -> None:
    env = load_env(ENV_FILE)
    uuid_map = json.loads(MAP_FILE.read_text())
    apps = get("/api/v1/applications", env)
    dbs = get("/api/v1/databases", env)
    svcs = get("/api/v1/services", env)
    health = get("/api/v1/health", env)

    lines = [
        "# Coolify GCP Replication Handoff",
        "",
        f"Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}",
        "",
        "## Target",
        f"- URL: {env['TARGET_URL']}",
        f"- Public IP: {env['TARGET_PUBLIC_IP']}",
        f"- Coolify version: 4.1.2 (installer latest)",
        f"- GCP: `{env['GCP_INSTANCE']}` in `{env['GCP_PROJECT']}` / `{env.get('GCP_ZONE','us-central1-a')}`",
        f"- API health: {health}",
        "",
        "## Resource counts (target)",
        f"- Applications: {len(apps)} (expected 3)",
        f"- Databases: {len(dbs)} (expected 2)",
        f"- Services: {len(svcs)} (expected 28+; includes test services if any)",
        "",
        "## UUID mapping",
        "",
        "### Projects",
    ]
    for old, new in uuid_map.get("projects", {}).items():
        lines.append(f"- `{old}` → `{new}`")

    lines += ["", "### Applications"]
    for old, new in uuid_map.get("applications", {}).items():
        app = next((a for a in apps if a.get("uuid") == new), {})
        lines.append(
            f"- `{old}` → `{new}` **{app.get('name','?')}** status=`{app.get('status','?')}`"
        )

    lines += ["", "### Databases"]
    for old, new in uuid_map.get("databases", {}).items():
        db = next((d for d in dbs if d.get("uuid") == new), {})
        lines.append(
            f"- `{old}` → `{new}` **{db.get('name','?')}** status=`{db.get('status','?')}`"
        )

    lines += ["", "### Services"]
    for old, new in uuid_map.get("services", {}).items():
        svc = next((s for s in svcs if s.get("uuid") == new), {})
        lines.append(
            f"- `{old}` → `{new}` **{svc.get('name','?')}** status=`{svc.get('status','?')}`"
        )

    lines += [
        "",
        "## Status summary",
        "",
    ]
    for kind, items in [("Applications", apps), ("Databases", dbs), ("Services", svcs)]:
        running = sum(1 for i in items if str(i.get("status", "")).startswith("running"))
        lines.append(f"- {kind}: {running}/{len(items)} running")

    lines += [
        "",
        "## Pending manual steps",
        "",
        "1. **Tailscale**: Complete device auth for `coolify-gcp-replica` at the login URL in `target.env`, then run:",
        "   ```bash",
        "   bash scripts/coolify-migration/05-migrate-data.sh",
        "   ```",
        "2. **Data migration**: Postgres `cre-leadgen-db`, Mongo `payloadcms-mongo`, `/opt/migrated-stacks/`, and Docker volumes require Tailscale connectivity to source `100.71.169.23`.",
        "3. **SSH access**: Direct SSH to VM public IP may timeout; use IAP:",
        "   ```bash",
        "   gcloud compute ssh coolify-gcp-replica --zone=us-central1-a --project=propane-galaxy-498403-n8 --tunnel-through-iap",
        "   ```",
        "4. **Services with host bind mounts** (`/opt/migrated-stacks/...`) will stay unhealthy until rsync completes.",
        "5. **Review secrets** in `.secrets/coolify-migration/` (API token, deploy keys) — never commit.",
        "",
        "## Admin credentials",
        "",
        "- Email: `swami@stackgen.com`",
        "- Password: stored at registration (see session notes / password manager)",
        "",
    ]

    REPORT.write_text("\n".join(lines) + "\n")
    print(REPORT.read_text())


if __name__ == "__main__":
    main()
