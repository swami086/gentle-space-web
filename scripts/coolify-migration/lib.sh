#!/usr/bin/env bash
# ponytail: shared helpers for Coolify GCP migration scripts
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ROOT}/.secrets/coolify-migration/target.env"
INVENTORY="${ROOT}/.secrets/coolify-migration/inventory/source-resources.json"
MAP_FILE="${ROOT}/.secrets/coolify-migration/uuid-map.json"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE" >&2
  exit 1
fi
# shellcheck source=/dev/null
source "$ENV_FILE"

api() {
  local method=$1 path=$2
  shift 2
  curl -sS -X "$method" \
    -H "Authorization: Bearer ${TARGET_TOKEN}" \
    -H "Accept: application/json" \
    -H "Content-Type: application/json" \
    "${TARGET_URL}${path}" "$@"
}

api_get() { api GET "$1"; }
api_post() { api POST "$1" -d "$2"; }
api_patch() { api PATCH "$1" -d "$2"; }

replace_ips() {
  local s=$1
  s=${s//100.71.169.23/${TARGET_PUBLIC_IP}}
  s=${s//223.181.116.105/${TARGET_PUBLIC_IP}}
  printf '%s' "$s"
}

ensure_map() {
  if [[ ! -f "$MAP_FILE" ]]; then
    echo '{"projects":{},"applications":{},"databases":{},"services":{},"private_keys":{}}' >"$MAP_FILE"
  fi
}

map_set() {
  local kind=$1 old=$2 new=$3
  ensure_map
  jq --arg k "$old" --arg v "$new" ".${kind}[\$k]=\$v" "$MAP_FILE" >"${MAP_FILE}.tmp" && mv "${MAP_FILE}.tmp" "$MAP_FILE"
}

map_get() {
  local kind=$1 old=$2
  jq -r --arg k "$old" ".${kind}[\$k] // empty" "$MAP_FILE"
}

project_uuid() {
  map_get projects "$1"
}
