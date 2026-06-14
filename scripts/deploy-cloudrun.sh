#!/usr/bin/env bash
# =============================================================================
# scripts/deploy-cloudrun.sh — build + deploy AgentDex to Google Cloud Run
# =============================================================================
# Prereqs (run once):
#   gcloud auth login
#   gcloud config set project agentrank-499305
#   gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
#                          artifactregistry.googleapis.com
#
# Then just run:  ./scripts/deploy-cloudrun.sh
#
# The snapshot is baked into the image, so the service needs NO BigQuery creds
# at runtime. It DOES make outbound calls for live ENS + tokenURI metadata.
# Set a real RPC via ETH_RPC_URL for reliable ENS resolution under load.
# =============================================================================
set -euo pipefail

PROJECT="${GCP_PROJECT:-agentrank-499305}"
REGION="${GCP_REGION:-us-central1}"
SERVICE="${SERVICE_NAME:-agentrank}"
RPC_URL="${ETH_RPC_URL:-https://eth.llamarpc.com}"
IMAGE="gcr.io/${PROJECT}/${SERVICE}"

echo "→ Building container with Cloud Build: ${IMAGE}"
gcloud builds submit --tag "${IMAGE}" --project "${PROJECT}"

echo "→ Deploying to Cloud Run: ${SERVICE} (${REGION})"
gcloud run deploy "${SERVICE}" \
  --image "${IMAGE}" \
  --project "${PROJECT}" \
  --region "${REGION}" \
  --platform managed \
  --allow-unauthenticated \
  --port 8080 \
  --memory 1Gi \
  --cpu 1 \
  --concurrency 80 \
  --min-instances 0 \
  --max-instances 4 \
  --set-env-vars "ETH_RPC_URL=${RPC_URL},NODE_ENV=production"

echo "→ Live URL:"
gcloud run services describe "${SERVICE}" --project "${PROJECT}" --region "${REGION}" \
  --format 'value(status.url)'
