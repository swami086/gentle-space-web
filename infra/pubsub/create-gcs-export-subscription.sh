#!/usr/bin/env bash
# Native Cloud Storage export subscription: configuration, not consumer code.
# The portal.event topic is created by S5a; this script fails loudly if it is absent.
set -euo pipefail

PROJECT="${GCP_PROJECT:-propane-galaxy-498403-n8}"
BUCKET="${GCS_RAW_EVENTS_BUCKET:-gs-portal-raw-events-prod}"
TOPIC="portal.event"
SUBSCRIPTION="portal-event-gcs-export"
DEAD_LETTER="portal.event.dead"

gcloud pubsub topics describe "${TOPIC}" --project="${PROJECT}" >/dev/null
gcloud pubsub topics describe "${DEAD_LETTER}" --project="${PROJECT}" >/dev/null 2>&1 || \
  gcloud pubsub topics create "${DEAD_LETTER}" --project="${PROJECT}"

gcloud pubsub subscriptions describe "${SUBSCRIPTION}" --project="${PROJECT}" >/dev/null 2>&1 || \
  gcloud pubsub subscriptions create "${SUBSCRIPTION}" \
    --project="${PROJECT}" \
    --topic="${TOPIC}" \
    --cloud-storage-bucket="${BUCKET}" \
    --cloud-storage-file-prefix="portal-event/" \
    --cloud-storage-file-suffix=".json" \
    --cloud-storage-output-format=text \
    --cloud-storage-max-bytes=10000000 \
    --cloud-storage-max-duration=60s \
    --dead-letter-topic="${DEAD_LETTER}" \
    --max-delivery-attempts=5

echo "subscription ${SUBSCRIPTION} exporting ${TOPIC} to gs://${BUCKET}/portal-event/"
