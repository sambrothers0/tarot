#!/usr/bin/env bash
# Build backend/ with Cloud Build and deploy it to Cloud Run.
# Usage: GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com ./deploy.sh
# Needs the one-time setup in README.md (APIs enabled, tarot-database-url secret).
set -euo pipefail
cd "$(dirname "$0")"

: "${GOOGLE_CLIENT_ID:?set GOOGLE_CLIENT_ID}"
REGION="${REGION:-us-central1}"         # a free-tier region
SERVICE="${SERVICE:-tarot-api}"
ORIGINS="${ALLOWED_ORIGINS:-https://sambrothers0.github.io,http://localhost:5173}"

# Commas separate env vars on the gcloud command line, so the origin list uses
# gcloud's custom-delimiter syntax (^@^) instead.
gcloud run deploy "$SERVICE" \
  --source . \
  --region "$REGION" \
  --allow-unauthenticated \
  --min-instances 0 \
  --max-instances 1 \
  --memory 512Mi \
  --cpu 1 \
  --set-env-vars "^@^GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID}@ALLOWED_ORIGINS=${ORIGINS}" \
  --set-secrets "DATABASE_URL=tarot-database-url:latest"
