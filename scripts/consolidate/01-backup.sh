#!/usr/bin/env bash
# Pre-S2 base backup. Both source instances, plus globals (roles are not in a
# per-database dump). Run from the repo root.
set -euo pipefail

: "${LISTINGS_URL:?set LISTINGS_URL, e.g. postgresql://gentle:gentle@localhost:5433/gentle_space_listings}"
: "${ADSAGENT_URL:?set ADSAGENT_URL to the DATABASE_URL from ads-agent/.env.local}"

mkdir -p backups
pg_dumpall --globals-only --dbname "$LISTINGS_URL" > backups/pre-s2-globals.sql
pg_dump -Fc --dbname "$LISTINGS_URL" -f backups/pre-s2-listings.dump
pg_dump -Fc --dbname "$ADSAGENT_URL" -f backups/pre-s2-adsagent.dump

psql -Aqt -F$'\t' --dbname "$LISTINGS_URL" -f scripts/consolidate/rowcounts.sql \
  > backups/pre-s2-listings.rowcounts
psql -Aqt -F$'\t' --dbname "$ADSAGENT_URL" -f scripts/consolidate/rowcounts.sql \
  > backups/pre-s2-adsagent.rowcounts

echo "backup complete:"
ls -l backups/
