#!/usr/bin/env bash
# =============================================================================
# scripts/schedule-query.sh — register the AgentRank BigQuery scheduled query
# =============================================================================
# Keeps `agentrank-499305.agentrank.agent_summary` fresh by re-running the
# materialize DDL (sql/05_materialize.sql) on a cron via BigQuery Data Transfer
# ("scheduled queries") — the Google-native refresh path, no servers involved.
#
# This is the single scheduled query called out in CLAUDE.md's scope. After it
# refreshes the BQ table, regenerate the served snapshot + redeploy with:
#     npm run materialize && ./scripts/deploy-cloudrun.sh
# (or push to trigger the Vercel build). The DDL is a single bounded scan
# from the deploy date, well under the billing cap.
#
# Prereqs (run once):
#   gcloud auth login
#   gcloud config set project agentrank-499305
#   gcloud services enable bigquerydatatransfer.googleapis.com
#
# Usage:  ./scripts/schedule-query.sh
# =============================================================================
set -euo pipefail

PROJECT="${GCP_PROJECT:-agentrank-499305}"
LOCATION="${BQ_LOCATION:-US}"
SCHEDULE="${BQ_SCHEDULE:-every 24 hours}"
SQL_FILE="$(dirname "$0")/../sql/05_materialize.sql"

if [[ ! -f "$SQL_FILE" ]]; then
  echo "ERROR: $SQL_FILE not found" >&2
  exit 1
fi

echo "→ Registering scheduled query 'agentrank-materialize' (${SCHEDULE})"
# DDL scripts write their own destination table, so no --destination_table /
# --target_dataset is needed. --replace is implied by CREATE OR REPLACE in SQL.
bq query \
  --project_id="${PROJECT}" \
  --location="${LOCATION}" \
  --use_legacy_sql=false \
  --schedule="${SCHEDULE}" \
  --display_name="agentrank-materialize" \
  --maximum_bytes_billed=400000000000 \
  "$(cat "$SQL_FILE")"

echo "→ Done. Inspect / manage at:"
echo "   https://console.cloud.google.com/bigquery/scheduled-queries?project=${PROJECT}"
echo "   or:  bq ls --transfer_config --transfer_location=${LOCATION} --project_id=${PROJECT}"
