#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib.sh
source "$SCRIPT_DIR/lib.sh"

ensure_map

create_project() {
  local old_uuid=$1 name=$2 desc=${3:-}
  local existing
  existing=$(map_get projects "$old_uuid")
  if [[ -n "$existing" ]]; then
    echo "Project $name already mapped -> $existing"
    return
  fi
  local payload
  if [[ -n "$desc" ]]; then
    payload=$(jq -n --arg n "$name" --arg d "$desc" '{name:$n,description:$d}')
  else
    payload=$(jq -n --arg n "$name" '{name:$n}')
  fi
  local resp new_uuid
  resp=$(api_post "/api/v1/projects" "$payload")
  new_uuid=$(echo "$resp" | jq -r '.uuid // empty')
  if [[ -z "$new_uuid" ]]; then
    echo "Failed creating project $name: $resp" >&2
    exit 1
  fi
  map_set projects "$old_uuid" "$new_uuid"
  echo "Project $name: $old_uuid -> $new_uuid"
}

create_project "zdjrgfgpddn4dmas0oc0ps4w" "My first project"
create_project "d1441pghbcqmc7rd945q4l9d" "cre-leadgen" "Bangalore CRE lead generation app"

echo "Projects ready."
