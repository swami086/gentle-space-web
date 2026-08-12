#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"
ENV_DIR="$(dirname "$INVENTORY")"
APP_ENVS="${ENV_DIR}/app-envs.json"

ensure_map
DEPLOY_KEY=$(jq -r '.private_keys["bangalore-cre-leadgen-deploy"]' "$MAP_FILE")
NEW_PG=$(map_get databases v7fsu88nrm1y2am2yb7mrxls)

post_app() {
  local path=$1 payload=$2 old_uuid=$3 name=$4
  local existing
  existing=$(map_get applications "$old_uuid")
  if [[ -n "$existing" ]]; then
    echo "App $name already mapped -> $existing"
    echo "$existing"
    return
  fi
  local resp new_uuid
  resp=$(api_post "$path" "$payload")
  new_uuid=$(echo "$resp" | jq -r '.uuid // empty')
  if [[ -z "$new_uuid" ]]; then
    echo "Failed app $name: $resp" >&2
    exit 1
  fi
  map_set applications "$old_uuid" "$new_uuid"
  echo "Application $name: $old_uuid -> $new_uuid"
  echo "$new_uuid"
}

# cre-leadgen (private deploy key)
CRE_PROJECT=$(project_uuid d1441pghbcqmc7rd945q4l9d)
CRE_PAYLOAD=$(jq -n \
  --arg server "$TARGET_SERVER_UUID" \
  --arg project "$CRE_PROJECT" \
  --arg key "$DEPLOY_KEY" \
  '{
    server_uuid: $server,
    project_uuid: $project,
    environment_name: "production",
    private_key_uuid: $key,
    git_repository: "git@github.com:swami086/bangalore-cre-leadgen.git",
    git_branch: "main",
    build_pack: "dockerfile",
    ports_exposes: "8000",
    dockerfile_location: "/Dockerfile",
    name: "cre-leadgen",
    description: "Bangalore CRE leadgen — FastAPI + React",
    health_check_enabled: true,
    health_check_path: "/api/health",
    health_check_port: 8000,
    instant_deploy: false
  }')
CRE_NEW=$(post_app "/api/v1/applications/private-deploy-key" "$CRE_PAYLOAD" "op2tui0hvn1jymjuhiet408y" "cre-leadgen")

# payloadcms (public)
MFP=$(project_uuid zdjrgfgpddn4dmas0oc0ps4w)
PAYLOADCMS_BODY=$(jq -n \
  --arg server "$TARGET_SERVER_UUID" \
  --arg project "$MFP" \
  '{
    server_uuid: $server,
    project_uuid: $project,
    environment_name: "production",
    git_repository: "payloadcms/payload",
    git_branch: "main",
    build_pack: "dockercompose",
    ports_exposes: "3000",
    name: "payloadcms",
    health_check_enabled: true,
    health_check_path: "/admin",
    health_check_port: 3000,
    health_check_start_period: 120,
    instant_deploy: false
  }')
post_app "/api/v1/applications/public" "$PAYLOADCMS_BODY" "b963y11znrd4uq3hw4fepibn" "payloadcms" >/dev/null

# roi-calculator (public)
ROI_BODY=$(jq -n \
  --arg server "$TARGET_SERVER_UUID" \
  --arg project "$MFP" \
  '{
    server_uuid: $server,
    project_uuid: $project,
    environment_name: "production",
    git_repository: "swami086/claude-code-roi-calculator",
    git_branch: "main",
    build_pack: "dockerfile",
    ports_exposes: "80",
    name: "roi-calculator",
    description: "Claude Code x FinTechCo ROI calculator",
    instant_deploy: false
  }')
post_app "/api/v1/applications/public" "$ROI_BODY" "qobkw8od4b86mu0lnks2rhm4" "roi-calculator" >/dev/null

# Set cre-leadgen env vars (DATABASE_URL uses new PG uuid)
if [[ -f "$APP_ENVS" ]]; then
  ENVS=$(jq -c --arg pg "$NEW_PG" --arg pass "be31e55e67b079bb4ac9477ee9f16a0c" \
    '.["op2tui0hvn1jymjuhiet408y"] | map(if .key=="DATABASE_URL" then .value="postgresql://leadgen:\($pass)@\($pg):5432/leadgen" else . end)' \
    "$APP_ENVS")
else
  ENVS='[]'
fi

if [[ "$ENVS" != "[]" && -n "$ENVS" ]]; then
  BULK=$(echo "$ENVS" | jq '[.[] | select(.is_preview==false) | {key:.key,value:.value,is_buildtime:.is_buildtime,is_runtime:.is_runtime,is_preview:.is_preview}]')
  api_post "/api/v1/applications/${CRE_NEW}/envs/bulk" "$(jq -n --argjson data "$BULK" '{data:$data}')" >/dev/null
  echo "Applied cre-leadgen env vars"
fi

# Deploy all apps
for old in op2tui0hvn1jymjuhiet408y b963y11znrd4uq3hw4fepibn qobkw8od4b86mu0lnks2rhm4; do
  nu=$(map_get applications "$old")
  api_post "/api/v1/deploy?uuid=${nu}&force=false" "{}" >/dev/null || true
  echo "Triggered deploy for $nu"
done

echo "Applications created and deploy triggered."
