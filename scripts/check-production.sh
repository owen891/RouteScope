#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-http://localhost:8088}"
BASE_URL="${BASE_URL%/}"

health_status="$(curl -sS --connect-timeout 5 --max-time 10 --max-redirs 0 -o /dev/null -w '%{http_code}' "$BASE_URL/healthz")"
if [[ "$health_status" != "200" ]]; then
  echo "health check failed: expected 200, got $health_status" >&2
  exit 1
fi

anonymous_status="$(curl -sS --connect-timeout 5 --max-time 10 --max-redirs 0 -o /dev/null -w '%{http_code}' "$BASE_URL/api/channels")"
if [[ "$anonymous_status" != "401" ]]; then
  echo "authentication check failed: anonymous /api/channels expected 401, got $anonymous_status" >&2
  echo "Set AUTH_ENABLED=true and recreate the container before production exposure." >&2
  exit 1
fi

echo "Production endpoint checks passed: health=200, anonymous API=401."
