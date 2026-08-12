#!/usr/bin/env python3
"""Create Coolify services on GCP target from source inventory."""
from __future__ import annotations

import base64
import json
import os
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ENV_FILE = ROOT / ".secrets/coolify-migration/target.env"
INVENTORY = ROOT / ".secrets/coolify-migration/inventory/source-resources.json"
MAP_FILE = ROOT / ".secrets/coolify-migration/uuid-map.json"
ENV_VARS = ROOT / ".secrets/coolify-migration/inventory/env-vars.json"


def load_env(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        out[k] = v.strip("'\"")
    return out


def api(method: str, path: str, body: dict | None, env: dict[str, str]) -> dict:
    url = env["TARGET_URL"].rstrip("/") + path
    data = None if body is None else json.dumps(body).encode()
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "Authorization": f"Bearer {env['TARGET_TOKEN']}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        raw = resp.read().decode()
        return json.loads(raw) if raw else {}


def replace_ips(text: str, new_ip: str) -> str:
    return text.replace("100.71.169.23", new_ip).replace("223.181.116.105", new_ip)


def main() -> int:
    env = load_env(ENV_FILE)
    inv = json.loads(INVENTORY.read_text())
    uuid_map = json.loads(MAP_FILE.read_text())
    env_vars_all = json.loads(ENV_VARS.read_text()) if ENV_VARS.exists() else {}

    project_map = uuid_map["projects"]
    service_map = uuid_map.setdefault("services", {})
    new_ip = env["TARGET_PUBLIC_IP"]
    server = env["TARGET_SERVER_UUID"]

    services = [r for r in inv if r.get("type") == "service"]
    print(f"Creating {len(services)} services...")

    for s in services:
        old = s["uuid"]
        if old in service_map:
            print(f"SKIP {s['name']} -> {service_map[old]}")
            continue

        env_id = s.get("environment_id")
        project_old = "zdjrgfgpddn4dmas0oc0ps4w" if env_id == 1 else "d1441pghbcqmc7rd945q4l9d"
        project_uuid = project_map[project_old]

        compose = s.get("docker_compose_raw")
        if not compose:
            print(f"WARN no compose for {s['name']}, skipping")
            continue
        compose = replace_ips(compose, new_ip)

        body = {
            "server_uuid": server,
            "project_uuid": project_uuid,
            "environment_name": "production",
            "name": s["name"],
            "description": s.get("description") or "",
            "docker_compose_raw": base64.b64encode(compose.encode()).decode(),
            "instant_deploy": True,
        }
        if s.get("type") and s["type"] != "service":
            body["type"] = s["type"]

        try:
            resp = api("POST", "/api/v1/services", body, env)
        except urllib.error.HTTPError as e:
            err = e.read().decode()
            print(f"FAIL {s['name']}: {e.code} {err[:500]}")
            continue

        new_uuid = resp.get("uuid")
        if not new_uuid:
            print(f"FAIL {s['name']}: {resp}")
            continue

        service_map[old] = new_uuid
        MAP_FILE.write_text(json.dumps(uuid_map, indent=2) + "\n")
        print(f"OK {s['name']}: {old} -> {new_uuid}")

        evs = env_vars_all.get(old) or []
        prod = [
            {
                "key": e["key"],
                "value": replace_ips(str(e.get("value") or ""), new_ip),
                "is_buildtime": e.get("is_buildtime", False),
                "is_runtime": e.get("is_runtime", True),
                "is_preview": e.get("is_preview", False),
            }
            for e in evs
            if not e.get("is_preview")
        ]
        if prod:
            try:
                api(
                    "PATCH",
                    f"/api/v1/services/{new_uuid}/envs/bulk",
                    {"data": prod},
                    env,
                )
                print(f"   env vars: {len(prod)}")
            except urllib.error.HTTPError as e:
                print(f"   env vars failed: {e.read().decode()[:200]}")

    print("Done.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
