#!/usr/bin/env bash
# Build and verify a local release candidate without publishing it.
set -euo pipefail

ROOT="${UPSTREAM_OPS_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
IMAGE_TAG="${UPSTREAM_OPS_CANDIDATE_IMAGE:-upstream-ops:candidate-$(git -C "$ROOT" rev-parse --short HEAD)}"
PORT="${UPSTREAM_OPS_CANDIDATE_PORT:-18418}"
DATA_DIR="${UPSTREAM_OPS_CANDIDATE_DATA_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/upstream-ops-candidate.XXXXXX")}"
CONTAINER="${UPSTREAM_OPS_CANDIDATE_CONTAINER:-upstream-ops-candidate-$$}"
APP_SECRET_VALUE="${APP_SECRET:-release-candidate-local-only-secret-0123456789abcdef}"
ADMIN_PASSWORD_VALUE="${ADMIN_PASSWORD:-release-candidate-local-password}"
AUTH_TOKEN_SECRET_VALUE="${AUTH_TOKEN_SECRET:-release-candidate-local-token-secret-0123456789abcdef}"
CREATED_DATA=0

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  if [[ "$CREATED_DATA" == "1" ]]; then rm -rf "$DATA_DIR"; fi
}
trap cleanup EXIT

usage() { printf '%s\n' "usage: $0 {build|verify|all}"; }

build_image() {
  docker build --pull=false -t "$IMAGE_TAG" "$ROOT"
}

validate_compose() {
  APP_SECRET="$APP_SECRET_VALUE" docker compose -f "$ROOT/docker-compose.yml" config --quiet
}

verify_image() {
  mkdir -p "$DATA_DIR"
  docker run -d --name "$CONTAINER" \
    -p "127.0.0.1:${PORT}:8418" \
    -e "APP_SECRET=$APP_SECRET_VALUE" \
    -e "AUTH_ENABLED=true" \
    -e "ADMIN_USERNAME=admin" \
    -e "ADMIN_PASSWORD=$ADMIN_PASSWORD_VALUE" \
    -e "AUTH_TOKEN_SECRET=$AUTH_TOKEN_SECRET_VALUE" \
    -v "$DATA_DIR:/app/data" \
    "$IMAGE_TAG" -config /app/data/config.yaml >/dev/null
  local health="http://127.0.0.1:${PORT}/healthz"
  for _ in $(seq 1 30); do
    if curl -fsS --connect-timeout 1 --max-time 3 "$health" >/dev/null; then
      echo "candidate health verified: $health"
      return 0
    fi
    sleep 1
  done
  echo "candidate health check failed: $health" >&2
  return 1
}

command="${1:-all}"
case "$command" in
  build)
    build_image
    validate_compose
    echo "candidate image built: $IMAGE_TAG"
    ;;
  verify)
    validate_compose
    verify_image
    ;;
  all)
    build_image
    validate_compose
    verify_image
    echo "candidate verification passed: $IMAGE_TAG"
    ;;
  *) usage >&2; exit 2 ;;
esac
