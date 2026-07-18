#!/usr/bin/env bash
# Backup / restore helpers for UpstreamOps data volume.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
mkdir -p data/backups

cmd="${1:-backup}"
stamp="$(date +%Y%m%d_%H%M%S)"

case "$cmd" in
  backup)
    if [[ ! -f data/upstream-ops.db ]]; then
      echo "missing data/upstream-ops.db" >&2
      exit 1
    fi
    cp -a data/upstream-ops.db "data/backups/upstream-ops.db.${stamp}"
    if [[ -f data/config.yaml ]]; then
      cp -a data/config.yaml "data/backups/config.yaml.${stamp}"
    fi
    # optional wal/shm
    [[ -f data/upstream-ops.db-wal ]] && cp -a data/upstream-ops.db-wal "data/backups/upstream-ops.db-wal.${stamp}" || true
    [[ -f data/upstream-ops.db-shm ]] && cp -a data/upstream-ops.db-shm "data/backups/upstream-ops.db-shm.${stamp}" || true
    echo "backed up -> data/backups/*.${stamp}"
    ls -la data/backups/*."${stamp}" 2>/dev/null || ls -la data/backups | tail -5
    ;;
  list)
    ls -la data/backups | tail -30
    ;;
  restore)
    tag="${2:-}"
    if [[ -z "$tag" ]]; then
      echo "usage: $0 restore <timestamp>" >&2
      echo "example: $0 restore 20260718_120000" >&2
      exit 1
    fi
    db="data/backups/upstream-ops.db.${tag}"
    cfg="data/backups/config.yaml.${tag}"
    if [[ ! -f "$db" ]]; then
      echo "not found: $db" >&2
      exit 1
    fi
    echo "stopping app..."
    docker compose stop app || true
    cp -a "$db" data/upstream-ops.db
    if [[ -f "$cfg" ]]; then
      cp -a "$cfg" data/config.yaml
    fi
    # drop wal/shm so sqlite reopens cleanly
    rm -f data/upstream-ops.db-wal data/upstream-ops.db-shm
    echo "starting app..."
    docker compose up -d
    echo "restored from ${tag}"
    ;;
  *)
    echo "usage: $0 {backup|list|restore <timestamp>}" >&2
    exit 1
    ;;
esac
