#!/usr/bin/env bash
# Loads GCP service-account credentials for BigQuery from an environment
# variable into a file, and exports GOOGLE_APPLICATION_CREDENTIALS (and
# GOOGLE_CLOUD_PROJECT, derived from the key) for the rest of the session.
#
# Set ONE of these in the cloud environment's variables (see README):
#   GOOGLE_APPLICATION_CREDENTIALS_JSON_B64  (base64 of the key file)  [preferred]
#   GOOGLE_APPLICATION_CREDENTIALS_JSON      (single-line/minified key JSON)
#
# Safe to run anywhere: no-ops quietly when no credential var is present.
set -euo pipefail

CRED_DIR="${HOME}/.config/agentrank"
CRED_PATH="${CRED_DIR}/gcp-sa.json"
mkdir -p "${CRED_DIR}"

if [ -n "${GOOGLE_APPLICATION_CREDENTIALS_JSON_B64:-}" ]; then
  printf '%s' "${GOOGLE_APPLICATION_CREDENTIALS_JSON_B64}" | base64 -d > "${CRED_PATH}"
elif [ -n "${GOOGLE_APPLICATION_CREDENTIALS_JSON:-}" ]; then
  printf '%s' "${GOOGLE_APPLICATION_CREDENTIALS_JSON}" > "${CRED_PATH}"
else
  echo "[agentrank] No GCP credential env var set (GOOGLE_APPLICATION_CREDENTIALS_JSON[_B64]); skipping BigQuery setup." >&2
  exit 0
fi
chmod 600 "${CRED_PATH}"

# Validate it parses and pull project_id out of the key.
PROJECT_FROM_KEY=""
if command -v python3 >/dev/null 2>&1; then
  if ! PROJECT_FROM_KEY="$(python3 - "${CRED_PATH}" <<'PY'
import json, sys
try:
    with open(sys.argv[1]) as f:
        d = json.load(f)
except Exception as e:
    sys.stderr.write(f"[agentrank] credential JSON is not valid: {e}\n")
    sys.exit(2)
print(d.get("project_id", ""))
PY
  )"; then
    echo "[agentrank] ERROR: credential value did not parse as JSON. Re-check the env var (base64 intact? minified to one line?)." >&2
    exit 1
  fi
fi

# Persist for subsequent Bash commands in this session.
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo "GOOGLE_APPLICATION_CREDENTIALS=${CRED_PATH}" >> "${CLAUDE_ENV_FILE}"
  if [ -z "${GOOGLE_CLOUD_PROJECT:-}" ] && [ -n "${PROJECT_FROM_KEY}" ]; then
    echo "GOOGLE_CLOUD_PROJECT=${PROJECT_FROM_KEY}" >> "${CLAUDE_ENV_FILE}"
  fi
fi

# Also export for this process tree (e.g. when run outside the hook).
export GOOGLE_APPLICATION_CREDENTIALS="${CRED_PATH}"
[ -z "${GOOGLE_CLOUD_PROJECT:-}" ] && [ -n "${PROJECT_FROM_KEY}" ] && export GOOGLE_CLOUD_PROJECT="${PROJECT_FROM_KEY}"

echo "[agentrank] GCP credentials ready at ${CRED_PATH} (project: ${GOOGLE_CLOUD_PROJECT:-${PROJECT_FROM_KEY:-unknown}})."
