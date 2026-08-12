#!/usr/bin/env bash
# Restores the ads_agent dump into the consolidated instance under the adsagent
# schema, via a scratch database. The scratch route is used rather than sed on
# the dump because it never touches the source and is reversible at every step.
set -euo pipefail

: "${TARGET_URL:?set TARGET_URL, e.g. postgresql://gentle:gentle@localhost:5433/gentle_space_listings}"
ADMIN_BASE="${TARGET_URL%/*}"
SCRATCH="${ADMIN_BASE}/adsagent_scratch"

psql -q "${ADMIN_BASE}/postgres" -c 'DROP DATABASE IF EXISTS adsagent_scratch'
psql -q "${ADMIN_BASE}/postgres" -c 'CREATE DATABASE adsagent_scratch'
pg_restore --no-owner --no-privileges -d "$SCRATCH" backups/pre-s2-adsagent.dump

# Rename inside the scratch database, then dump the already-renamed schema.
psql -q "$SCRATCH" -c 'ALTER SCHEMA public RENAME TO adsagent'
pg_dump -Fc --schema=adsagent --dbname "$SCRATCH" -f backups/adsagent-renamed.dump

# Task 7 created an empty adsagent shell; drop it so pg_restore can recreate tables.
psql -q "$TARGET_URL" -c 'DROP SCHEMA IF EXISTS adsagent CASCADE'

pg_restore --no-owner --no-privileges -d "$TARGET_URL" backups/adsagent-renamed.dump

# Reapply role grants dropped with the schema shell (003 defaults cover new objects only).
psql -q "$TARGET_URL" <<'SQL'
GRANT USAGE ON SCHEMA adsagent TO adsagent_rw, agent_ro;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA adsagent TO adsagent_rw;
GRANT SELECT ON ALL TABLES IN SCHEMA adsagent TO agent_ro;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA adsagent TO adsagent_rw;
SQL

psql -Aqt -F$'\t' "$TARGET_URL" -c \
  "SELECT replace(format('%s.%s', n.nspname, c.relname), 'adsagent.', 'public.'), \
          (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', n.nspname, c.relname), false, true, '')))[1]::text::bigint \
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace \
    WHERE c.relkind = 'r' AND n.nspname = 'adsagent' ORDER BY 1" \
  > backups/consolidated-adsagent.rowcounts

echo "--- ads_agent row-count diff (source vs consolidated) ---"
diff backups/pre-s2-adsagent.rowcounts backups/consolidated-adsagent.rowcounts
psql -q "${ADMIN_BASE}/postgres" -c 'DROP DATABASE adsagent_scratch'
echo "CONSOLIDATION RESTORE PASSED"
