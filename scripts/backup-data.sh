#!/usr/bin/env bash
# Consistent SQLite/config backup and restore helper.
set -euo pipefail

ROOT="${UPSTREAM_OPS_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
DATA_DIR="${UPSTREAM_OPS_DATA_DIR:-$ROOT/data}"
BACKUP_DIR="${UPSTREAM_OPS_BACKUP_DIR:-$DATA_DIR/backups}"
DB_NAME="upstream-ops.db"
CFG_NAME="config.yaml"
APP_SERVICE="${UPSTREAM_OPS_COMPOSE_SERVICE:-app}"
STOP_APP="${UPSTREAM_OPS_STOP_APP:-auto}"

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | awk '{print $1}'
  else
    echo "sha256sum or shasum is required" >&2
    return 1
  fi
}

file_size() {
  if stat -c '%s' "$1" >/dev/null 2>&1; then
    stat -c '%s' "$1"
  else
    stat -f '%z' "$1"
  fi
}

compose_available() {
  command -v docker >/dev/null 2>&1 && docker compose -f "$ROOT/docker-compose.yml" config --services >/dev/null 2>&1
}

app_is_running() {
  compose_available && docker compose -f "$ROOT/docker-compose.yml" ps --status=running --services 2>/dev/null | grep -Fxq "$APP_SERVICE"
}

app_was_stopped=0
restart_app() {
  if [[ "$app_was_stopped" == "1" ]]; then
    docker compose -f "$ROOT/docker-compose.yml" up -d "$APP_SERVICE" >/dev/null
  fi
}
trap restart_app EXIT

stop_app_if_requested() {
  if [[ "$STOP_APP" == "0" ]]; then
    if app_is_running; then
      echo "UPSTREAM_OPS_STOP_APP=0 refuses to operate on a running $APP_SERVICE; stop Compose first" >&2
      exit 1
    fi
    return
  fi
  if [[ "$STOP_APP" == "1" ]]; then
    if ! compose_available; then
      echo "UPSTREAM_OPS_STOP_APP=1 requires a valid Docker Compose project" >&2
      exit 1
    fi
    if ! app_is_running; then
      return
    fi
    docker compose -f "$ROOT/docker-compose.yml" stop "$APP_SERVICE" >/dev/null
    app_was_stopped=1
    return
  fi
  if app_is_running; then
    docker compose -f "$ROOT/docker-compose.yml" stop "$APP_SERVICE" >/dev/null
    app_was_stopped=1
  fi
}

write_manifest() {
  local dir="$1" mode="$2" db_path="$dir/$DB_NAME" cfg_path="$dir/$CFG_NAME"
  local db_hash cfg_hash db_size cfg_size
  db_hash="$(sha256_file "$db_path")"
  cfg_hash="$(sha256_file "$cfg_path")"
  db_size="$(file_size "$db_path")"
  cfg_size="$(file_size "$cfg_path")"
  {
    printf '{\n'
    printf '  "version": 1,\n'
    printf '  "mode": "%s",\n' "$mode"
    printf '  "database": {"name":"%s","size":%s,"sha256":"%s"},\n' "$DB_NAME" "$db_size" "$db_hash"
    printf '  "config": {"name":"%s","size":%s,"sha256":"%s"},\n' "$CFG_NAME" "$cfg_size" "$cfg_hash"
    printf '  "created_at": "%s"\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf '}\n'
  } > "$dir/manifest.json"
}

manifest_field() {
  local file="$1" object="$2" key="$3"
  case "$object:$key" in
    database:name) sed -n 's/.*"database"[[:space:]]*:[[:space:]]*{"name":"\([^"]*\)".*/\1/p' "$file" ;;
    database:size) sed -n 's/.*"database"[[:space:]]*:[[:space:]]*{.*"size":\([0-9][0-9]*\).*/\1/p' "$file" ;;
    database:sha256) sed -n 's/.*"database"[[:space:]]*:[[:space:]]*{.*"sha256":"\([0-9A-Fa-f]*\)".*/\1/p' "$file" ;;
    config:name) sed -n 's/.*"config"[[:space:]]*:[[:space:]]*{"name":"\([^"]*\)".*/\1/p' "$file" ;;
    config:size) sed -n 's/.*"config"[[:space:]]*:[[:space:]]*{.*"size":\([0-9][0-9]*\).*/\1/p' "$file" ;;
    config:sha256) sed -n 's/.*"config"[[:space:]]*:[[:space:]]*{.*"sha256":"\([0-9A-Fa-f]*\)".*/\1/p' "$file" ;;
    *) return 1 ;;
  esac
}

verify_snapshot() {
  local tag="$1" dir="$BACKUP_DIR/$tag" manifest="$BACKUP_DIR/$tag/manifest.json"
  [[ -n "$tag" && "$tag" != *..* && "$tag" != */* && "$tag" != *\\* ]] || { echo "unsafe snapshot tag" >&2; return 1; }
  [[ -f "$manifest" ]] || { echo "missing snapshot manifest: $manifest" >&2; return 1; }
  [[ -f "$dir/$DB_NAME" && -f "$dir/$CFG_NAME" ]] || { echo "snapshot files are incomplete: $dir" >&2; return 1; }
  local db_hash cfg_hash expected_db expected_cfg db_size cfg_size expected_db_size expected_cfg_size
  db_hash="$(sha256_file "$dir/$DB_NAME")"
  cfg_hash="$(sha256_file "$dir/$CFG_NAME")"
  db_size="$(file_size "$dir/$DB_NAME")"
  cfg_size="$(file_size "$dir/$CFG_NAME")"
  expected_db="$(manifest_field "$manifest" database sha256)"
  expected_cfg="$(manifest_field "$manifest" config sha256)"
  expected_db_size="$(manifest_field "$manifest" database size)"
  expected_cfg_size="$(manifest_field "$manifest" config size)"
  [[ "$(manifest_field "$manifest" database name)" == "$DB_NAME" && "$(manifest_field "$manifest" config name)" == "$CFG_NAME" ]] || { echo "snapshot manifest file names are invalid" >&2; return 1; }
  [[ "$db_hash" == "$expected_db" ]] || { echo "database checksum mismatch" >&2; return 1; }
  [[ "$cfg_hash" == "$expected_cfg" ]] || { echo "config checksum mismatch" >&2; return 1; }
  [[ "$db_size" == "$expected_db_size" ]] || { echo "database size mismatch" >&2; return 1; }
  [[ "$cfg_size" == "$expected_cfg_size" ]] || { echo "config size mismatch" >&2; return 1; }
}

backup_snapshot() {
  local stamp="${BACKUP_TAG:-$(date +%Y%m%d_%H%M%S)}"
  local target="$BACKUP_DIR/$stamp" staging="$BACKUP_DIR/.${stamp}.tmp"
  [[ -f "$DATA_DIR/$DB_NAME" ]] || { echo "missing $DATA_DIR/$DB_NAME" >&2; exit 1; }
  [[ -f "$DATA_DIR/$CFG_NAME" ]] || { echo "missing $DATA_DIR/$CFG_NAME" >&2; exit 1; }
  [[ ! -e "$target" ]] || { echo "snapshot already exists: $stamp" >&2; exit 1; }
  rm -rf "$staging"
  mkdir -p "$staging" "$BACKUP_DIR"
  stop_app_if_requested

  local mode="sidecars"
  if [[ "$app_was_stopped" == "1" ]]; then
    mode="stopped"
  elif [[ -z "$(find "$DATA_DIR" -maxdepth 1 -name "$DB_NAME-wal" -print -quit)" ]]; then
    mode="clean"
  fi
  cp -p "$DATA_DIR/$DB_NAME" "$staging/$DB_NAME"
  cp -p "$DATA_DIR/$CFG_NAME" "$staging/$CFG_NAME"
  for sidecar in "$DB_NAME-wal" "$DB_NAME-shm"; do
    [[ -f "$DATA_DIR/$sidecar" ]] && cp -p "$DATA_DIR/$sidecar" "$staging/$sidecar"
  done
  write_manifest "$staging" "$mode"
  mv "$staging" "$target"
  verify_snapshot "$stamp"
  echo "backup verified: $stamp"
}

restore_snapshot() {
  local tag="${1:-}"
  [[ -n "$tag" ]] || { echo "usage: $0 restore <timestamp>" >&2; exit 1; }
  verify_snapshot "$tag"
  stop_app_if_requested
  local source="$BACKUP_DIR/$tag" db_tmp="$DATA_DIR/.${DB_NAME}.restore.tmp" cfg_tmp="$DATA_DIR/.${CFG_NAME}.restore.tmp"
  mkdir -p "$DATA_DIR"
  rm -f "$db_tmp" "$cfg_tmp"
  cp -p "$source/$DB_NAME" "$db_tmp"
  cp -p "$source/$CFG_NAME" "$cfg_tmp"
  mv -f "$db_tmp" "$DATA_DIR/$DB_NAME"
  mv -f "$cfg_tmp" "$DATA_DIR/$CFG_NAME"
  rm -f "$DATA_DIR/$DB_NAME-wal" "$DATA_DIR/$DB_NAME-shm"
  for sidecar in "$DB_NAME-wal" "$DB_NAME-shm"; do
    [[ -f "$source/$sidecar" ]] && cp -p "$source/$sidecar" "$DATA_DIR/$sidecar"
  done
  if [[ "$app_was_stopped" == "1" ]]; then
    docker compose -f "$ROOT/docker-compose.yml" up -d "$APP_SERVICE" >/dev/null
    app_was_stopped=0
  fi
  local health_url="${UPSTREAM_OPS_HEALTH_URL:-http://localhost:${HTTP_PORT:-8080}/healthz}"
  if ! command -v curl >/dev/null 2>&1; then
    echo "restore requires curl for the /healthz check" >&2
    exit 1
  fi
  if ! curl -fsS --connect-timeout 5 --max-time 15 "$health_url" >/dev/null; then
    echo "restore completed but health check failed: $health_url" >&2
    exit 1
  fi
  echo "restore verified: $tag"
}

cmd="${1:-backup}"
case "$cmd" in
  backup) backup_snapshot ;;
  verify) verify_snapshot "${2:-}" ; echo "snapshot verified: ${2:-}" ;;
  list) [[ -d "$BACKUP_DIR" ]] && find "$BACKUP_DIR" -mindepth 2 -maxdepth 2 -name manifest.json -print | sort || true ;;
  restore) restore_snapshot "${2:-}" ;;
  *) echo "usage: $0 {backup|verify <timestamp>|list|restore <timestamp>}" >&2; exit 1 ;;
esac
