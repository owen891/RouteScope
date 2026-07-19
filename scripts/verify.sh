#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if command -v corepack >/dev/null 2>&1; then
  corepack prepare pnpm@10.4.0 --activate
  PNPM=(corepack pnpm)
elif command -v pnpm >/dev/null 2>&1; then
  PNPM=(pnpm)
else
  echo "pnpm 10.4.0 is required. Enable Corepack or install the pinned pnpm version." >&2
  exit 1
fi

PNPM_VERSION="$("${PNPM[@]}" --version)"
if [[ "$PNPM_VERSION" != "10.4.0" ]]; then
  echo "pnpm 10.4.0 is required; found $PNPM_VERSION." >&2
  exit 1
fi

echo "==> validate native security and workflow contracts"
go test ./scripts -run '^(TestBashSecurityTools|TestWorkflowContracts)$' -count=1

echo "==> check diff"
git diff --check

echo "==> frontend quality gates"
cd frontend
if [[ "${SKIP_INSTALL:-false}" != "true" ]]; then
  "${PNPM[@]}" install --frozen-lockfile
fi
"${PNPM[@]}" lint
"${PNPM[@]}" test
"${PNPM[@]}" build

echo "==> backend tests"
cd "$ROOT"
go test ./... -count=1

echo "==> validate Compose configuration"
APP_SECRET="verification-only-placeholder-not-for-production" \
  docker compose config --quiet

echo "All quality gates passed."
