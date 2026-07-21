#!/usr/bin/env bash
# Build upstream-ops:local without full multi-stage golang pull when possible.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "==> frontend deps + build"
cd frontend
if command -v pnpm >/dev/null 2>&1; then
  PNPM=pnpm
else
  PNPM="npx pnpm@10.4.0"
fi
$PNPM install --no-frozen-lockfile
$PNPM test
$PNPM build
cd "$ROOT"

echo "==> embed dist into web/dist"
rm -rf web/dist
mkdir -p web/dist
cp -a frontend/dist/. web/dist/

echo "==> go build linux/amd64"
OUT="${TMPDIR:-/tmp}/upstream-ops-linux"
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o "$OUT" ./cmd/server
cp "$OUT" "$ROOT/upstream-ops-linux"

echo "==> docker runtime image"
DOCKERFILE="${TMPDIR:-/tmp}/Dockerfile.upstream-ops-runtime"
cat > "$DOCKERFILE" <<'DOCKER'
FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata wget && mkdir -p /app/data
WORKDIR /app
COPY upstream-ops-linux /usr/local/bin/upstream-ops
RUN chmod +x /usr/local/bin/upstream-ops
EXPOSE 8418
ENTRYPOINT ["upstream-ops"]
DOCKER
docker build -f "$DOCKERFILE" -t upstream-ops:local .
rm -f "$ROOT/upstream-ops-linux"

echo "==> restore web/dist placeholder"
rm -rf web/dist
mkdir -p web/dist
printf '%s\n' '# 占位文件 — 让 //go:embed all:dist 在 dist 为空时仍能编译。' > web/dist/.gitkeep

echo "Done: image upstream-ops:local"
echo "Start: docker compose up -d  (with override image: upstream-ops:local)"
