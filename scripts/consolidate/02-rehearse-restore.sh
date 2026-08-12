#!/usr/bin/env bash
# Restores both dumps into a throwaway PG18 instance and diffs row counts
# against the source. This is the gate for S2 and S3: a backup nobody has
# restored is a hope, not a backup.
set -euo pipefail

CONTAINER=pg18-rehearsal
PORT=5534
BASE="postgresql://gentle:gentle@localhost:${PORT}"

cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT

cleanup
docker run -d --name "$CONTAINER" \
  -e POSTGRES_USER=gentle -e POSTGRES_PASSWORD=gentle -e POSTGRES_DB=postgres \
  -p "${PORT}:5432" gentle-space-pg:pg18-age \
  postgres -c shared_preload_libraries=age >/dev/null

until pg_isready -h localhost -p "$PORT" -U gentle >/dev/null 2>&1; do sleep 1; done

psql -q "${BASE}/postgres" -f backups/pre-s2-globals.sql || true
psql -q "${BASE}/postgres" -c 'CREATE DATABASE gentle_space_listings'
psql -q "${BASE}/postgres" -c 'CREATE DATABASE ads_agent'

pg_restore --no-owner --no-privileges -d "${BASE}/gentle_space_listings" backups/pre-s2-listings.dump
pg_restore --no-owner --no-privileges -d "${BASE}/ads_agent"              backups/pre-s2-adsagent.dump

psql -Aqt -F$'\t' "${BASE}/gentle_space_listings" -f scripts/consolidate/rowcounts.sql \
  > backups/rehearsed-listings.rowcounts
psql -Aqt -F$'\t' "${BASE}/ads_agent" -f scripts/consolidate/rowcounts.sql \
  > backups/rehearsed-adsagent.rowcounts

echo "--- listings row-count diff ---"
diff backups/pre-s2-listings.rowcounts backups/rehearsed-listings.rowcounts
echo "--- ads_agent row-count diff ---"
diff backups/pre-s2-adsagent.rowcounts backups/rehearsed-adsagent.rowcounts

psql -Aqt "${BASE}/gentle_space_listings" -c "SELECT count(*) FROM ag_catalog.ag_graph"
echo "REHEARSAL PASSED"
