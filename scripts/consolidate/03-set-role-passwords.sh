#!/usr/bin/env bash
# Sets login passwords for the roles created by migration 003. Kept out of the
# migration so no credential is ever committed. Run once per environment.
set -euo pipefail

: "${ADMIN_URL:?set ADMIN_URL to a superuser connection on the consolidated instance}"
: "${LISTINGS_RW_PASSWORD:?}"
: "${ADSAGENT_RW_PASSWORD:?}"
: "${CONTEXT_RW_PASSWORD:?}"
: "${SHARED_RW_PASSWORD:?}"
: "${DERIVED_RW_PASSWORD:?}"
: "${AGENT_RO_PASSWORD:?}"

psql -q "$ADMIN_URL" <<SQL
ALTER ROLE listings_rw PASSWORD '${LISTINGS_RW_PASSWORD}';
ALTER ROLE adsagent_rw PASSWORD '${ADSAGENT_RW_PASSWORD}';
ALTER ROLE context_rw  PASSWORD '${CONTEXT_RW_PASSWORD}';
ALTER ROLE shared_rw   PASSWORD '${SHARED_RW_PASSWORD}';
ALTER ROLE derived_rw  PASSWORD '${DERIVED_RW_PASSWORD}';
ALTER ROLE agent_ro    PASSWORD '${AGENT_RO_PASSWORD}';
SQL
echo "role passwords set"
