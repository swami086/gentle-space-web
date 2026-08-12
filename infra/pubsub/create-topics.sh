#!/usr/bin/env bash
# S5a event backbone — Google Cloud Pub/Sub topology (datastore spec §14.2–§14.4).
#
# Idempotent: every create tolerates ALREADY_EXISTS. Safe to re-run.
#
#   ./infra/pubsub/create-topics.sh
#   ./infra/pubsub/create-topics.sh --with-gcs-export gs://gentle-space-raw-events
#
# The --with-gcs-export flag creates the §14.6 Cloud Storage export subscription.
# It belongs to S6a (portal ingestion) and needs the bucket to exist first; the
# ClickHouse S3Queue side is not created here.
set -euo pipefail

PROJECT_ID="${GOOGLE_CLOUD_PROJECT:?GOOGLE_CLOUD_PROJECT is not set}"
RELAY_SA="outbox-relay@${PROJECT_ID}.iam.gserviceaccount.com"
DLQ_TOPIC="gs-events-dead-letter"
GCS_BUCKET=""

if [[ "${1:-}" == "--with-gcs-export" ]]; then
  GCS_BUCKET="${2:?--with-gcs-export needs a bucket URI, e.g. gs://gentle-space-raw-events}"
fi

TOPICS=(
  enquiry.received
  enquiry.activity_logged
  graph.tenant_stale
  agent.task_requested
  reminder.due
  deletion.requested
  portal.event
)

# One subscription per consumer named in §14.2. deletion.requested gets one per
# store, matching context.deletion_propagations.store's CHECK list (§14.4).
declare -A SUBSCRIPTIONS=(
  [enquiry.received]="local-persist twenty-sync graph-stale agent-wake notify"
  [enquiry.activity_logged]="twenty-notes graph-stale requirement-extraction"
  [graph.tenant_stale]="rebuild-worker"
  [agent.task_requested]="kanban-dispatcher"
  [reminder.due]="notify today-feed"
  [deletion.requested]="postgres clickhouse duckdb-snapshot graph twenty vector-index objectstore langfuse clickhouse-raw"
  [portal.event]="gcs-export"
)

ok_exists() { grep -q "ALREADY_EXISTS\|already exists" <<<"$1" || return 1; }

run_tolerating_exists() {
  local output
  if ! output="$("$@" 2>&1)"; then
    ok_exists "$output" || { echo "$output" >&2; return 1; }
    echo "  exists already"
    return 0
  fi
  echo "$output"
}

echo "== enabling the API =="
gcloud services enable pubsub.googleapis.com --project "$PROJECT_ID"

echo "== dead-letter topic (created first: subscriptions reference it) =="
run_tolerating_exists gcloud pubsub topics create "$DLQ_TOPIC" \
  --project "$PROJECT_ID" --message-retention-duration=7d

echo "== topics =="
for topic in "${TOPICS[@]}"; do
  echo "-- $topic"
  run_tolerating_exists gcloud pubsub topics create "$topic" \
    --project "$PROJECT_ID" --message-retention-duration=7d
done

echo "== relay service account, publisher on each topic and nothing wider =="
run_tolerating_exists gcloud iam service-accounts create outbox-relay \
  --project "$PROJECT_ID" --display-name="S5a outbox relay publisher"
for topic in "${TOPICS[@]}"; do
  gcloud pubsub topics add-iam-policy-binding "$topic" \
    --project "$PROJECT_ID" \
    --member="serviceAccount:${RELAY_SA}" \
    --role="roles/pubsub.publisher" >/dev/null
  echo "  publisher on $topic"
done

echo "== subscriptions =="
for topic in "${TOPICS[@]}"; do
  for consumer in ${SUBSCRIPTIONS[$topic]}; do
    sub="${topic}.${consumer}"
    echo "-- $sub"
    # expiration-period=never: an unattached subscription is deleted after 31
    # days of inactivity by default, which would silently drop a consumer that
    # has not shipped yet.
    # ack-deadline 60s and max-delivery-attempts 5 are the retry budget before
    # dead-lettering; ordering is enabled because delivery is per-tenant ordered.
    run_tolerating_exists gcloud pubsub subscriptions create "$sub" \
      --project "$PROJECT_ID" \
      --topic="$topic" \
      --ack-deadline=60 \
      --message-retention-duration=7d \
      --expiration-period=never \
      --enable-message-ordering \
      --dead-letter-topic="$DLQ_TOPIC" \
      --max-delivery-attempts=5
  done
done

echo "== IAM that dead-lettering silently needs =="
# Without these two bindings, dead-lettering fails without an error and the
# message is simply redelivered forever. This is the classic Pub/Sub trap.
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"
PUBSUB_SA="serviceAccount:service-${PROJECT_NUMBER}@gcp-sa-pubsub.iam.gserviceaccount.com"

gcloud pubsub topics add-iam-policy-binding "$DLQ_TOPIC" \
  --project "$PROJECT_ID" --member="$PUBSUB_SA" --role="roles/pubsub.publisher" >/dev/null
echo "  pubsub SA can publish to $DLQ_TOPIC"

for topic in "${TOPICS[@]}"; do
  for consumer in ${SUBSCRIPTIONS[$topic]}; do
    gcloud pubsub subscriptions add-iam-policy-binding "${topic}.${consumer}" \
      --project "$PROJECT_ID" --member="$PUBSUB_SA" --role="roles/pubsub.subscriber" >/dev/null
  done
done
echo "  pubsub SA can subscribe to every subscription"

echo "== dead-letter drain subscription (so dead letters are inspectable) =="
run_tolerating_exists gcloud pubsub subscriptions create "${DLQ_TOPIC}.inspect" \
  --project "$PROJECT_ID" --topic="$DLQ_TOPIC" \
  --ack-deadline=60 --message-retention-duration=7d --expiration-period=never

if [[ -n "$GCS_BUCKET" ]]; then
  echo "== §14.6 Cloud Storage export subscription (S6a) =="
  # Native export type: writes messages to the bucket as they are received,
  # batched by bytes or duration. ClickHouse S3Queue consumes the files; that
  # side is S6/S6a, not this script.
  run_tolerating_exists gcloud pubsub subscriptions create "portal.event.gcs-raw" \
    --project "$PROJECT_ID" \
    --topic="portal.event" \
    --cloud-storage-bucket="${GCS_BUCKET#gs://}" \
    --cloud-storage-file-prefix="raw/" \
    --cloud-storage-file-suffix=".json" \
    --cloud-storage-max-bytes=10MB \
    --cloud-storage-max-duration=60s \
    --expiration-period=never
fi

echo
echo "== verification =="
gcloud pubsub topics list --project "$PROJECT_ID" --format='value(name)' | sort
echo "topics: $(gcloud pubsub topics list --project "$PROJECT_ID" --format='value(name)' | wc -l | tr -d ' ')"
echo "subscriptions: $(gcloud pubsub subscriptions list --project "$PROJECT_ID" --format='value(name)' | wc -l | tr -d ' ')"
