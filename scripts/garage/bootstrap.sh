#!/usr/bin/env bash
# Idempotent: safe to re-run against an already-bootstrapped cluster.
set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.garage.yml}"
KEY_NAME="${KEY_NAME:-gs-server}"
g() { docker compose -f "$COMPOSE_FILE" exec -T garage /garage "$@"; }

echo "==> waiting for garage to answer"
for _ in $(seq 1 30); do
  if g status >/dev/null 2>&1; then break; fi
  sleep 1
done

NODE_ID="$(g status | awk '/^[0-9a-f]{16}/ { print $1; exit }')"
if [ -z "$NODE_ID" ]; then
  echo "could not read a node id from 'garage status'" >&2
  exit 1
fi
echo "==> node ${NODE_ID}"

g layout assign -z dc1 -c 10G "$NODE_ID" || true
LAYOUT_VERSION="$(g layout show | awk '/Current cluster layout version/ { print $NF }')"
g layout apply --version "$(( ${LAYOUT_VERSION:-0} + 1 ))" || true

echo "==> buckets"
g bucket create gs-artifacts     || true
g bucket create gs-graph-staging || true

echo "==> server key"
if ! g key info "$KEY_NAME" >/dev/null 2>&1; then
  g key create "$KEY_NAME"
fi
g key allow --create-bucket "$KEY_NAME" || true
g bucket allow --read --write --owner gs-artifacts     --key "$KEY_NAME"
g bucket allow --read --write --owner gs-graph-staging --key "$KEY_NAME"

echo
echo "==> put these in ads-agent/.env.local"
g key info "$KEY_NAME" --show-secret \
  | awk '/Key ID/ { print "ARTIFACT_ACCESS_KEY_ID=" $NF }
         /Secret key/ { print "ARTIFACT_SECRET_ACCESS_KEY=" $NF }'
