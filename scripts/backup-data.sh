#!/usr/bin/env bash
# Verified SQLite/MySQL and runtime configuration backup/restore helper.
set -euo pipefail

ROOT="${UPSTREAM_OPS_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
DATA_DIR="${UPSTREAM_OPS_DATA_DIR:-$ROOT/data}"
BACKUP_DIR="${UPSTREAM_OPS_BACKUP_DIR:-$DATA_DIR/backups}"
CFG_NAME="config.yaml"
SQLITE_NAME="upstream-ops.db"
MYSQL_NAME="upstream-ops.sql"
APP_SERVICE="${UPSTREAM_OPS_COMPOSE_SERVICE:-app}"
STOP_APP="${UPSTREAM_OPS_STOP_APP:-auto}"
DB_DRIVER="${DATABASE_DRIVER:-}"
EFFECTIVE_APP_SECRET="${APP_SECRET:-}"
COMPOSE_CONFIG_JSON=""
app_was_stopped=0

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}'
  else echo "sha256sum or shasum is required" >&2; return 1; fi
}

sha256_value() {
  if command -v sha256sum >/dev/null 2>&1; then printf '%s' "$1" | sha256sum | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then printf '%s' "$1" | shasum -a 256 | awk '{print $1}'
  else echo "sha256sum or shasum is required" >&2; return 1; fi
}

file_size() {
  if stat -c '%s' "$1" >/dev/null 2>&1; then stat -c '%s' "$1"; else stat -f '%z' "$1"; fi
}

python_command() {
  if command -v python3 >/dev/null 2>&1; then printf '%s\n' python3
  elif command -v python >/dev/null 2>&1; then printf '%s\n' python
  else return 1; fi
}

load_compose_config() {
  [[ -n "$COMPOSE_CONFIG_JSON" ]] && return 0
  command -v docker >/dev/null 2>&1 || return 1
  COMPOSE_CONFIG_JSON="$(docker compose -f "$ROOT/docker-compose.yml" -f "$ROOT/docker-compose.mysql.yml" config --format json 2>/dev/null || true)"
  if [[ -z "$COMPOSE_CONFIG_JSON" ]]; then
    COMPOSE_CONFIG_JSON="$(docker compose -f "$ROOT/docker-compose.yml" config --format json 2>/dev/null || true)"
  fi
  [[ -n "$COMPOSE_CONFIG_JSON" ]]
}

resolve_deployment() {
  local parsed=""
  if load_compose_config && command -v "$(python_command 2>/dev/null || true)" >/dev/null 2>&1; then
    local py
    py="$(python_command)"
    parsed="$(printf '%s' "$COMPOSE_CONFIG_JSON" | "$py" -c 'import json,sys; d=json.load(sys.stdin); e=d.get("services",{}).get("app",{}).get("environment",{}); print(str(e.get("DATABASE_DRIVER", ""))); print(str(e.get("APP_SECRET", "")))' 2>/dev/null || true)"
    if [[ -z "$DB_DRIVER" ]]; then DB_DRIVER="$(printf '%s\n' "$parsed" | sed -n '1p')"; fi
    if [[ -z "$EFFECTIVE_APP_SECRET" ]]; then EFFECTIVE_APP_SECRET="$(printf '%s\n' "$parsed" | sed -n '2p')"; fi
  fi
  DB_DRIVER="$(printf '%s' "${DB_DRIVER:-sqlite}" | tr '[:upper:]' '[:lower:]')"
  [[ "$DB_DRIVER" == "mysql" || "$DB_DRIVER" == "sqlite" ]] || { echo "unsupported DATABASE_DRIVER: $DB_DRIVER" >&2; exit 1; }
}

resolve_deployment

compose() {
  if [[ "$DB_DRIVER" == "mysql" ]]; then
    docker compose -f "$ROOT/docker-compose.yml" -f "$ROOT/docker-compose.mysql.yml" "$@"
  else
    docker compose -f "$ROOT/docker-compose.yml" "$@"
  fi
}

compose_available() {
  command -v docker >/dev/null 2>&1 && compose config --services >/dev/null 2>&1
}

app_is_running() {
  compose_available && compose ps --status=running --services 2>/dev/null | grep -Fxq "$APP_SERVICE"
}

restart_app() {
  if [[ "$app_was_stopped" == "1" ]]; then compose up -d "$APP_SERVICE" >/dev/null || true; fi
}
trap restart_app EXIT

stop_app_if_requested() {
  if [[ "$STOP_APP" == "0" ]]; then
    if app_is_running; then echo "UPSTREAM_OPS_STOP_APP=0 refuses to operate on a running $APP_SERVICE; stop Compose first" >&2; exit 1; fi
    return
  fi
  if [[ "$STOP_APP" == "1" ]]; then
    if ! compose_available; then echo "UPSTREAM_OPS_STOP_APP=1 requires a valid Docker Compose project" >&2; exit 1; fi
    if ! app_is_running; then return; fi
  elif ! app_is_running; then
    return
  fi
  compose stop "$APP_SERVICE" >/dev/null
  app_was_stopped=1
}

sqlite_online_backup() {
  local source="$1" destination="$2" py
  py="$(python_command 2>/dev/null || true)"
  [[ -n "$py" ]] || return 2
  "$py" - "$source" "$destination" <<'PY'
from pathlib import Path
import sqlite3, sys
source_path = Path(sys.argv[1]).resolve()
destination_path = Path(sys.argv[2]).resolve()
source_uri = source_path.as_uri() + "?mode=ro"
with sqlite3.connect(source_uri, uri=True, timeout=30) as source, sqlite3.connect(destination_path, timeout=30) as destination:
    source.backup(destination, pages=256)
    result = destination.execute("PRAGMA integrity_check").fetchone()[0]
    if result != "ok":
        raise SystemExit(f"backup integrity_check failed: {result}")
PY
}

sqlite_integrity_check() {
  local path="$1" py
  py="$(python_command 2>/dev/null || true)"
  [[ -n "$py" ]] || return 0
  "$py" - "$path" <<'PY'
import sqlite3, sys
with sqlite3.connect(f"file:{sys.argv[1]}?mode=ro", uri=True, timeout=30) as db:
    result = db.execute("PRAGMA integrity_check").fetchone()[0]
if result != "ok":
    raise SystemExit(f"SQLite integrity_check failed: {result}")
PY
}

mysql_dump() {
  local destination="$1"
  compose exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_PASSWORD" mysqldump --single-transaction --quick --skip-lock-tables --routines --events --triggers --no-tablespaces "$MYSQL_DATABASE"' > "$destination"
  [[ -s "$destination" ]] || { echo "MySQL dump is empty" >&2; return 1; }
}

mysql_restore() {
  local source="$1"
  compose up -d mysql >/dev/null
  compose exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_PASSWORD" mysql "$MYSQL_DATABASE"' < "$source"
}

write_manifest() {
  local dir="$1" mode="$2" driver="$3" db_name="$4"
  local db_path="$dir/$db_name" cfg_path="$dir/$CFG_NAME"
  local db_hash cfg_hash db_size cfg_size secret_hash
  db_hash="$(sha256_file "$db_path")"; cfg_hash="$(sha256_file "$cfg_path")"
  db_size="$(file_size "$db_path")"; cfg_size="$(file_size "$cfg_path")"
  secret_hash=""
  [[ -n "$EFFECTIVE_APP_SECRET" ]] && secret_hash="$(sha256_value "$EFFECTIVE_APP_SECRET")"
  {
    printf '{\n'
    printf '  "version": 3,\n'
    printf '  "mode": "%s",\n' "$mode"
    printf '  "database": {"driver":"%s","name":"%s","size":%s,"sha256":"%s"},\n' "$driver" "$db_name" "$db_size" "$db_hash"
    printf '  "config": {"name":"%s","size":%s,"sha256":"%s"},\n' "$CFG_NAME" "$cfg_size" "$cfg_hash"
    printf '  "security": {"app_secret_sha256":"%s"},\n' "$secret_hash"
    printf '  "created_at": "%s"\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf '}\n'
  } > "$dir/manifest.json"
}

manifest_field() {
  local file="$1" object="$2" key="$3"
  case "$object:$key" in
    version:version) sed -n 's/.*"version"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' "$file" ;;
    database:driver) sed -n 's/.*"database"[[:space:]]*:[[:space:]]*{[^}]*"driver":"\([^"]*\)".*/\1/p' "$file" ;;
    database:name) sed -n 's/.*"database"[[:space:]]*:[[:space:]]*{[^}]*"name":"\([^"]*\)".*/\1/p' "$file" ;;
    database:size) sed -n 's/.*"database"[[:space:]]*:[[:space:]]*{[^}]*"size":\([0-9][0-9]*\).*/\1/p' "$file" ;;
    database:sha256) sed -n 's/.*"database"[[:space:]]*:[[:space:]]*{[^}]*"sha256":"\([0-9A-Fa-f]*\)".*/\1/p' "$file" ;;
    config:name) sed -n 's/.*"config"[[:space:]]*:[[:space:]]*{"name":"\([^"]*\)".*/\1/p' "$file" ;;
    config:size) sed -n 's/.*"config"[[:space:]]*:[[:space:]]*{[^}]*"size":\([0-9][0-9]*\).*/\1/p' "$file" ;;
    config:sha256) sed -n 's/.*"config"[[:space:]]*:[[:space:]]*{[^}]*"sha256":"\([0-9A-Fa-f]*\)".*/\1/p' "$file" ;;
    security:app_secret_sha256) sed -n 's/.*"security"[[:space:]]*:[[:space:]]*{[^}]*"app_secret_sha256":"\([0-9A-Fa-f]*\)".*/\1/p' "$file" ;;
    *) return 1 ;;
  esac
}

verify_snapshot() {
  local tag="$1"
  [[ -n "$tag" && "$tag" != *..* && "$tag" != */* && "$tag" != *\\* ]] || { echo "unsafe snapshot tag" >&2; return 1; }
  local dir="$BACKUP_DIR/$tag" manifest="$BACKUP_DIR/$tag/manifest.json"
  [[ -f "$manifest" ]] || { echo "missing snapshot manifest: $manifest" >&2; return 1; }
  local driver db_name
  driver="$(manifest_field "$manifest" database driver || true)"; [[ -n "$driver" ]] || driver="sqlite"
  db_name="$(manifest_field "$manifest" database name || true)"
  [[ "$driver" == "sqlite" && "$db_name" == "$SQLITE_NAME" || "$driver" == "mysql" && "$db_name" == "$MYSQL_NAME" ]] || { echo "snapshot database driver/name is invalid" >&2; return 1; }
  [[ -f "$dir/$db_name" && -f "$dir/$CFG_NAME" ]] || { echo "snapshot files are incomplete: $dir" >&2; return 1; }
  local db_hash cfg_hash expected_db expected_cfg db_size cfg_size expected_db_size expected_cfg_size
  db_hash="$(sha256_file "$dir/$db_name")"; cfg_hash="$(sha256_file "$dir/$CFG_NAME")"
  db_size="$(file_size "$dir/$db_name")"; cfg_size="$(file_size "$dir/$CFG_NAME")"
  expected_db="$(manifest_field "$manifest" database sha256)"; expected_cfg="$(manifest_field "$manifest" config sha256)"
  expected_db_size="$(manifest_field "$manifest" database size)"; expected_cfg_size="$(manifest_field "$manifest" config size)"
  [[ "$(manifest_field "$manifest" config name)" == "$CFG_NAME" ]] || { echo "snapshot manifest file names are invalid" >&2; return 1; }
  [[ "$db_hash" == "$expected_db" ]] || { echo "database checksum mismatch" >&2; return 1; }
  [[ "$cfg_hash" == "$expected_cfg" ]] || { echo "config checksum mismatch" >&2; return 1; }
  [[ "$db_size" == "$expected_db_size" ]] || { echo "database size mismatch" >&2; return 1; }
  [[ "$cfg_size" == "$expected_cfg_size" ]] || { echo "config size mismatch" >&2; return 1; }
  [[ "$driver" != "sqlite" ]] || sqlite_integrity_check "$dir/$db_name"
}

verify_app_secret() {
  local tag="$1" expected current
  expected="$(manifest_field "$BACKUP_DIR/$tag/manifest.json" security app_secret_sha256 || true)"
  [[ -n "$expected" ]] || return 0
  current="$EFFECTIVE_APP_SECRET"
  [[ -n "$current" ]] || { echo "APP_SECRET is required to restore this encrypted snapshot" >&2; return 1; }
  [[ "$(sha256_value "$current")" == "$expected" ]] || { echo "APP_SECRET does not match the snapshot encryption key" >&2; return 1; }
}

backup_snapshot() {
  local stamp="${BACKUP_TAG:-$(date +%Y%m%d_%H%M%S)}"
  local target="$BACKUP_DIR/$stamp" staging="$BACKUP_DIR/.${stamp}.tmp"
  [[ -f "$DATA_DIR/$CFG_NAME" ]] || { echo "missing $DATA_DIR/$CFG_NAME" >&2; exit 1; }
  [[ ! -e "$target" ]] || { echo "snapshot already exists: $stamp" >&2; exit 1; }
  if [[ "$DB_DRIVER" == "sqlite" ]]; then [[ -f "$DATA_DIR/$SQLITE_NAME" ]] || { echo "missing $DATA_DIR/$SQLITE_NAME" >&2; exit 1; }
  elif ! compose_available; then echo "MySQL backup requires a valid Docker Compose project" >&2; exit 1; fi
  rm -rf "$staging"; mkdir -p "$staging" "$BACKUP_DIR"
  stop_app_if_requested
  local mode db_name backup_rc=0
  if [[ "$DB_DRIVER" == "mysql" ]]; then
    db_name="$MYSQL_NAME"; mysql_dump "$staging/$db_name"; mode="mysql-dump"
  else
    db_name="$SQLITE_NAME"
    if sqlite_online_backup "$DATA_DIR/$SQLITE_NAME" "$staging/$db_name"; then mode="sqlite-online"
    else
      backup_rc=$?
      if [[ "$backup_rc" != "2" ]]; then rm -rf "$staging"; echo "SQLite online backup failed" >&2; exit 1; fi
      if [[ -f "$DATA_DIR/$SQLITE_NAME-wal" || -f "$DATA_DIR/$SQLITE_NAME-shm" ]] && [[ "$app_was_stopped" != "1" ]]; then
        rm -rf "$staging"; echo "active SQLite sidecars detected and Python is unavailable; install Python or stop Compose app" >&2; exit 1
      fi
      mode=$([[ "$app_was_stopped" == "1" ]] && echo "stopped-copy" || echo "clean-copy")
      cp -p "$DATA_DIR/$SQLITE_NAME" "$staging/$db_name"
      if [[ "$app_was_stopped" == "1" ]]; then for sidecar in "$SQLITE_NAME-wal" "$SQLITE_NAME-shm"; do [[ -f "$DATA_DIR/$sidecar" ]] && cp -p "$DATA_DIR/$sidecar" "$staging/$sidecar"; done; fi
    fi
  fi
  cp -p "$DATA_DIR/$CFG_NAME" "$staging/$CFG_NAME"
  write_manifest "$staging" "$mode" "$DB_DRIVER" "$db_name"
  mv "$staging" "$target"
  verify_snapshot "$stamp"
  echo "backup verified: $stamp ($mode)"
}

restore_snapshot() {
  local tag="${1:-}" manifest driver db_name source
  [[ -n "$tag" ]] || { echo "usage: $0 restore <timestamp>" >&2; exit 1; }
  verify_snapshot "$tag"; verify_app_secret "$tag"
  manifest="$BACKUP_DIR/$tag/manifest.json"; driver="$(manifest_field "$manifest" database driver || true)"; [[ -n "$driver" ]] || driver="sqlite"
  [[ "$driver" == "$DB_DRIVER" ]] || { echo "snapshot database driver ($driver) does not match current deployment ($DB_DRIVER)" >&2; exit 1; }
  db_name="$(manifest_field "$manifest" database name)"; source="$BACKUP_DIR/$tag"
  stop_app_if_requested
  if [[ "$driver" == "mysql" ]]; then
    mysql_restore "$source/$db_name"
  else
    local db_tmp="$DATA_DIR/.${SQLITE_NAME}.restore.tmp" cfg_tmp="$DATA_DIR/.${CFG_NAME}.restore.tmp"
    mkdir -p "$DATA_DIR"; rm -f "$db_tmp" "$cfg_tmp"
    cp -p "$source/$db_name" "$db_tmp"; cp -p "$source/$CFG_NAME" "$cfg_tmp"
    mv -f "$db_tmp" "$DATA_DIR/$SQLITE_NAME"; mv -f "$cfg_tmp" "$DATA_DIR/$CFG_NAME"
    rm -f "$DATA_DIR/$SQLITE_NAME-wal" "$DATA_DIR/$SQLITE_NAME-shm"
    for sidecar in "$SQLITE_NAME-wal" "$SQLITE_NAME-shm"; do [[ -f "$source/$sidecar" ]] && cp -p "$source/$sidecar" "$DATA_DIR/$sidecar"; done
  fi
  if [[ "$driver" == "mysql" ]]; then cp -p "$source/$CFG_NAME" "$DATA_DIR/$CFG_NAME"; fi
  if [[ "$app_was_stopped" == "1" ]]; then compose up -d "$APP_SERVICE" >/dev/null; app_was_stopped=0; fi
  local health_url="${UPSTREAM_OPS_HEALTH_URL:-http://localhost:${HTTP_PORT:-8080}/healthz}"
  command -v curl >/dev/null 2>&1 || { echo "restore requires curl for the /healthz check" >&2; exit 1; }
  curl -fsS --connect-timeout 5 --max-time 15 "$health_url" >/dev/null || { echo "restore completed but health check failed: $health_url" >&2; exit 1; }
  echo "restore verified: $tag"
}

cmd="${1:-backup}"
case "$cmd" in
  backup) backup_snapshot ;;
  verify) verify_snapshot "${2:-}"; echo "snapshot verified: ${2:-}" ;;
  list) [[ -d "$BACKUP_DIR" ]] && find "$BACKUP_DIR" -mindepth 2 -maxdepth 2 -name manifest.json -print | sort || true ;;
  restore) restore_snapshot "${2:-}" ;;
  *) echo "usage: $0 {backup|verify <timestamp>|list|restore <timestamp>}" >&2; exit 1 ;;
esac
