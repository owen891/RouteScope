#!/usr/bin/env bash
set -euo pipefail

ROOT="${UPSTREAM_OPS_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
PROJECT="upstream-ops-onebot-uat-$$"
PORT="${UPSTREAM_OPS_UAT_PORT:-18419}"
KEEP="${ONEBOT_UAT_KEEP:-0}"

compose() {
  COMPOSE_PROJECT_NAME="$PROJECT" UPSTREAM_OPS_UAT_PORT="$PORT" APP_SECRET="uat-only-app-secret-not-production" \
    docker compose -f "$ROOT/docker-compose.onebot-uat.yml" "$@"
}

cleanup() { [[ "$KEEP" == "1" ]] || compose down -v --remove-orphans >/dev/null 2>&1 || true; }
trap cleanup EXIT

compose run --rm onebot-check
echo "Container network OneBot checks passed; this is protocol validation, not real QQ delivery."
