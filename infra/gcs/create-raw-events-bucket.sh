#!/usr/bin/env bash
# Creates the raw portal-event transport bucket, its writer service account, and the
# HMAC key S3Queue needs. Idempotent: safe to re-run.
set -euo pipefail

PROJECT="${GCP_PROJECT:-propane-galaxy-498403-n8}"
BUCKET="${GCS_RAW_EVENTS_BUCKET:-gs-portal-raw-events-prod}"
LOCATION="${GCP_LOCATION:-asia-south1}"
SA="portal-raw-ingest@${PROJECT}.iam.gserviceaccount.com"

gcloud storage buckets describe "gs://${BUCKET}" --project="${PROJECT}" >/dev/null 2>&1 || \
  gcloud storage buckets create "gs://${BUCKET}" \
    --project="${PROJECT}" \
    --location="${LOCATION}" \
    --uniform-bucket-level-access \
    --public-access-prevention

gcloud storage buckets update "gs://${BUCKET}" \
  --project="${PROJECT}" \
  --lifecycle-file=infra/gcs/raw-events-lifecycle.json

gcloud iam service-accounts describe "${SA}" --project="${PROJECT}" >/dev/null 2>&1 || \
  gcloud iam service-accounts create portal-raw-ingest \
    --project="${PROJECT}" \
    --display-name="Portal raw event ingest (ClickHouse S3Queue)"

# Scoped to this bucket only, never project-wide. S3Queue deletes files after
# processing, so it needs objectAdmin rather than objectViewer.
gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" \
  --project="${PROJECT}" \
  --member="serviceAccount:${SA}" \
  --role="roles/storage.objectAdmin"

# The Pub/Sub service agent is the writer of the exported batches.
PUBSUB_AGENT="$(gcloud storage service-agent --project="${PROJECT}")"
gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" \
  --project="${PROJECT}" \
  --member="serviceAccount:${PUBSUB_AGENT}" \
  --role="roles/storage.objectCreator"

echo "bucket gs://${BUCKET} ready; writer ${SA}; pubsub agent ${PUBSUB_AGENT}"
echo "create the HMAC key with:"
echo "  gcloud storage hmac create ${SA} --project=${PROJECT}"
