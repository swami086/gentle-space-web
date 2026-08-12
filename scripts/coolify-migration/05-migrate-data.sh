#!/usr/bin/env bash
# Migrate data from source Coolify server to GCP replica over Tailscale.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib.sh"

SOURCE_TS_IP="${SOURCE_SERVER_IP:-100.71.169.23}"
SSH_OPTS='-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null'
RSYNC_SSH="ssh ${SSH_OPTS}"
MAP=$(cat "$MAP_FILE")
OLD_PG="v7fsu88nrm1y2am2yb7mrxls"
OLD_MONGO="prw7gyyyreh4kdnv3enbkg29"
NEW_PG=$(map_get databases "$OLD_PG")
NEW_MONGO=$(map_get databases "$OLD_MONGO")

echo "Checking Tailscale connectivity to source ${SOURCE_TS_IP}..."
if ! gcloud compute ssh "$GCP_INSTANCE" --zone="$GCP_ZONE" --project="$GCP_PROJECT" --tunnel-through-iap \
  --command="tailscale status --json 2>/dev/null | jq -r '.Self.Online'" 2>/dev/null | grep -q true; then
  echo "Tailscale not online on GCP VM. Complete login: ${TAILSCALE_LOGIN_URL:-see target.env}" >&2
  exit 1
fi

gcloud compute ssh "$GCP_INSTANCE" --zone="$GCP_ZONE" --project="$GCP_PROJECT" --tunnel-through-iap \
  --command="ping -c1 -W2 ${SOURCE_TS_IP} >/dev/null" || {
  echo "Cannot reach source ${SOURCE_TS_IP} over Tailnet" >&2
  exit 1
}

echo "Syncing /opt/migrated-stacks from source..."
gcloud compute ssh "$GCP_INSTANCE" --zone="$GCP_ZONE" --project="$GCP_PROJECT" --tunnel-through-iap \
  --command="sudo mkdir -p /opt/migrated-stacks && sudo rsync -az --delete -e '${RSYNC_SSH}' root@${SOURCE_TS_IP}:/opt/migrated-stacks/ /opt/migrated-stacks/" \
  || echo "WARN: rsync exited non-zero (partial transfer is OK if code 23)"

echo "Dumping PostgreSQL cre-leadgen-db from source..."
gcloud compute ssh "$GCP_INSTANCE" --zone="$GCP_ZONE" --project="$GCP_PROJECT" --tunnel-through-iap \
  --command="set -e
SRC_CID=\$(ssh ${SSH_OPTS} root@${SOURCE_TS_IP} \"docker ps --format '{{.Names}}' | grep -m1 ${OLD_PG} || true\")
DST_CID=\$(sudo docker ps --format '{{.Names}}' | grep -m1 ${NEW_PG} || true)
test -n \"\$SRC_CID\" && test -n \"\$DST_CID\"
sudo docker exec \$DST_CID psql -U leadgen -d postgres -c 'DROP DATABASE IF EXISTS leadgen;'
sudo docker exec \$DST_CID psql -U leadgen -d postgres -c 'CREATE DATABASE leadgen;'
ssh ${SSH_OPTS} root@${SOURCE_TS_IP} \"docker exec \$SRC_CID pg_dump -U leadgen leadgen\" | sudo docker exec -i \$DST_CID psql -U leadgen -d leadgen
"

echo "Dumping MongoDB payloadcms-mongo from source..."
gcloud compute ssh "$GCP_INSTANCE" --zone="$GCP_ZONE" --project="$GCP_PROJECT" --tunnel-through-iap \
  --command="set -e
SRC_CID=\$(ssh ${SSH_OPTS} root@${SOURCE_TS_IP} \"docker ps --format '{{.Names}}' | grep -m1 ${OLD_MONGO} || true\")
DST_CID=\$(sudo docker ps --format '{{.Names}}' | grep -m1 ${NEW_MONGO} || true)
test -n \"\$SRC_CID\" && test -n \"\$DST_CID\"
ssh ${SSH_OPTS} root@${SOURCE_TS_IP} \"docker exec \$SRC_CID mongodump --archive --gzip -u root -p '0BZTa0cOj1PxScYYb9vpXOxAYsVXxRhbzifzVxt6YamUgprf9GrTBkcz2Y3QjzxS' --authenticationDatabase admin\" | sudo docker exec -i \$DST_CID mongorestore --archive --gzip --drop -u root -p '0BZTa0cOj1PxScYYb9vpXOxAYsVXxRhbzifzVxt6YamUgprf9GrTBkcz2Y3QjzxS' --authenticationDatabase admin
"

echo "Syncing Docker volumes for key stacks..."
# ponytail: named-volume copy is best-effort; complex stacks may need per-service restarts
for vol_pattern in wordpress wp_data signoz memgraph coder openmemory qdrant; do
  gcloud compute ssh "$GCP_INSTANCE" --zone="$GCP_ZONE" --project="$GCP_PROJECT" --tunnel-through-iap \
    --command="ssh ${SSH_OPTS} root@${SOURCE_TS_IP} 'docker volume ls -q' | grep -i '${vol_pattern}' || true" | while read -r vol; do
    [[ -z "$vol" ]] && continue
    echo "  volume $vol"
    gcloud compute ssh "$GCP_INSTANCE" --zone="$GCP_ZONE" --project="$GCP_PROJECT" --tunnel-through-iap \
      --command="sudo docker volume create ${vol} 2>/dev/null || true; ssh ${SSH_OPTS} root@${SOURCE_TS_IP} \"docker run --rm -v ${vol}:/from alpine sh -c 'cd /from && tar cf - .'\" | sudo docker run --rm -i -v ${vol}:/to alpine sh -c 'cd /to && tar xf -'"
  done
done

echo "Data migration complete."
