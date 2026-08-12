#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

ensure_map

create_db() {
  local old_uuid=$1
  local existing
  existing=$(map_get databases "$old_uuid")
  if [[ -n "$existing" ]]; then
    echo "DB already mapped $old_uuid -> $existing"
    return
  fi

  local row
  row=$(jq -c --arg u "$old_uuid" '.[] | select(.uuid==$u)' "$INVENTORY")
  [[ -n "$row" ]] || { echo "Missing DB $old_uuid in inventory" >&2; exit 1; }

  local name type env_id project_old
  name=$(echo "$row" | jq -r '.name')
  type=$(echo "$row" | jq -r '.database_type // .type' | sed 's/standalone-//')
  env_id=$(echo "$row" | jq -r '.environment_id')
  if [[ "$env_id" == "1" ]]; then
    project_old="zdjrgfgpddn4dmas0oc0ps4w"
  else
    project_old="d1441pghbcqmc7rd945q4l9d"
  fi
  local project_uuid
  project_uuid=$(project_uuid "$project_old")

  local payload
  payload=$(jq -n \
    --arg server "$TARGET_SERVER_UUID" \
    --arg project "$project_uuid" \
    --arg name "$name" \
    --arg type "$type" \
    --argjson row "$row" \
    '{
      server_uuid: $server,
      project_uuid: $project,
      environment_name: "production",
      name: $name,
      instant_deploy: true
    }
    + (if $type=="postgresql" then {
      postgres_user: $row.postgres_user,
      postgres_password: $row.postgres_password,
      postgres_db: $row.postgres_db
    } else {} end)
    + (if $type=="mongodb" then {
      mongo_initdb_root_username: $row.mongo_initdb_root_username,
      mongo_initdb_root_password: $row.mongo_initdb_root_password,
      mongo_initdb_database: $row.mongo_initdb_database
    } else {} end)')

  local resp new_uuid
  resp=$(curl -sS -X POST \
    -H "Authorization: Bearer ${TARGET_TOKEN}" \
    -H "Accept: application/json" \
    -H "Content-Type: application/json" \
    "${TARGET_URL}/api/v1/databases/${type}" \
    -d "$payload")
  new_uuid=$(echo "$resp" | jq -r '.uuid // empty')
  if [[ -z "$new_uuid" ]]; then
    echo "Failed DB $name ($type): $resp" >&2
    exit 1
  fi
  map_set databases "$old_uuid" "$new_uuid"
  echo "Database $name: $old_uuid -> $new_uuid"
}

create_db "v7fsu88nrm1y2am2yb7mrxls"
create_db "prw7gyyyreh4kdnv3enbkg29"
echo "Databases created."
