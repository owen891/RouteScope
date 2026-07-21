#!/usr/bin/env bash
# Explicit real OneBot v11 delivery check. Never prints the access token.
set -euo pipefail

BASE_URL="${ONEBOT_BASE_URL:-http://127.0.0.1:5700}"
ACCESS_TOKEN="${ONEBOT_ACCESS_TOKEN:-}"
GROUP_ID="${ONEBOT_GROUP_ID:-}"
USER_ID="${ONEBOT_USER_ID:-}"
FAILURE_GROUP_ID="${ONEBOT_FAILURE_GROUP_ID:-}"
EVIDENCE_PATH="${ONEBOT_UAT_EVIDENCE_PATH:-}"
REAL_ENDPOINT="${ONEBOT_REAL_ENDPOINT:-0}"
CONFIRM="${ONEBOT_CONFIRM:-0}"
MESSAGE="${ONEBOT_TEST_MESSAGE:-UpstreamOps OneBot UAT $(date -u +%Y-%m-%dT%H:%M:%SZ)}"

if [[ -z "$GROUP_ID" || -z "$USER_ID" ]]; then
  echo "ONEBOT_GROUP_ID and ONEBOT_USER_ID are required" >&2
  exit 2
fi
BASE_URL="${BASE_URL%/}"

safe_endpoint() {
  python3 - "$1" <<'PY'
import sys
from urllib.parse import urlsplit, urlunsplit
parts = urlsplit(sys.argv[1])
if not parts.scheme or not parts.hostname:
    raise SystemExit("invalid OneBot base URL")
netloc = parts.hostname
if ":" in netloc and not netloc.startswith("["):
    netloc = f"[{netloc}]"
if parts.port is not None and not ((parts.scheme == "http" and parts.port == 80) or (parts.scheme == "https" and parts.port == 443)):
    netloc += f":{parts.port}"
print(urlunsplit((parts.scheme, netloc, parts.path.rstrip("/"), "", "")))
PY
}

request() {
  local endpoint="$1" body="$2" mode="$3"
  local url="$BASE_URL/$endpoint"
  local auth_args=()
  if [[ -n "$ACCESS_TOKEN" && "$mode" == "bearer" ]]; then
    auth_args=(-H "Authorization: Bearer $ACCESS_TOKEN")
  elif [[ -n "$ACCESS_TOKEN" && "$mode" == "query" ]]; then
    url="$url?access_token=$(python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$ACCESS_TOKEN")"
  fi
  curl -sS --connect-timeout 5 --max-time 15 -o /tmp/onebot-uat-response.$$ -w '%{http_code}' \
    -H 'Content-Type: application/json' "${auth_args[@]}" --data "$body" "$url"
}

json_id() {
  python3 - "$1" <<'PY'
import json, sys
value = sys.argv[1]
print(json.dumps(int(value) if value.isdigit() else value))
PY
}

check_response() {
  local label="$1" status="$2" require_message_id="${3:-0}"
  python3 - "$label" "$status" "$require_message_id" /tmp/onebot-uat-response.$$ <<'PY'
import json, sys
label, status, require_message_id, path = sys.argv[1:]
try:
    data = json.load(open(path, encoding='utf-8'))
except Exception as exc:
    print(f"{label}: HTTP {status}, invalid JSON ({exc})", file=sys.stderr)
    raise SystemExit(1)
retcode = data.get("retcode")
ok = str(data.get("status", "")).lower() == "ok" and (retcode is None or retcode == 0)
message_id = data.get("message_id", "missing")
print(f"{label}: HTTP {status}, status={data.get('status', 'missing')}, retcode={retcode if retcode is not None else 'missing'}, message_id={message_id}")
has_message_id = data.get("message_id") is not None and str(data.get("message_id")).strip() != ""
raise SystemExit(0 if ok and status == "200" and (require_message_id != "1" or has_message_id) else 1)
PY
}

trap 'rm -f /tmp/onebot-uat-response.$$ /tmp/onebot-uat-group.$$ /tmp/onebot-uat-private.$$ /tmp/onebot-uat-failure.$$ "${evidence_tmp:-}"' EXIT
if [[ "$CONFIRM" != "1" ]]; then
  echo "dry-run only: endpoint=$BASE_URL; group/private targets configured; set ONEBOT_CONFIRM=1 to send" 
  exit 0
fi
if [[ -n "$EVIDENCE_PATH" && "$REAL_ENDPOINT" != "1" ]]; then
  echo "ONEBOT_UAT_EVIDENCE_PATH requires ONEBOT_REAL_ENDPOINT=1; synthetic fixtures cannot produce release evidence" >&2
  exit 2
fi
if [[ -n "$EVIDENCE_PATH" && -z "$FAILURE_GROUP_ID" ]]; then
  echo "ONEBOT_UAT_EVIDENCE_PATH requires ONEBOT_FAILURE_GROUP_ID" >&2
  exit 2
fi

status="$(request send_group_msg "{\"group_id\":$(json_id "$GROUP_ID"),\"message\":$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$MESSAGE")}" bearer)"
check_response "group" "$status" 1
cp /tmp/onebot-uat-response.$$ /tmp/onebot-uat-group.$$
status="$(request send_private_msg "{\"user_id\":$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$USER_ID"),\"message\":$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$MESSAGE")}" query)"
check_response "private" "$status" 1
cp /tmp/onebot-uat-response.$$ /tmp/onebot-uat-private.$$
if [[ -n "$FAILURE_GROUP_ID" ]]; then
  status="$(request send_group_msg "{\"group_id\":$(json_id "$FAILURE_GROUP_ID"),\"message\":$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$MESSAGE failure-case")}" bearer)"
  failure_status="$status"
  cp /tmp/onebot-uat-response.$$ /tmp/onebot-uat-failure.$$
  if python3 - "$status" /tmp/onebot-uat-response.$$ <<'PY'
import json, sys
status, path = sys.argv[1:]
try:
    data = json.load(open(path, encoding='utf-8'))
except Exception:
    raise SystemExit(1)
ok = str(data.get("status", "")).lower() == "ok" and (data.get("retcode") in (None, 0))
print(f"failure-case: HTTP {status}, status={data.get('status', 'missing')}, retcode={data.get('retcode', 'missing')}")
raise SystemExit(0 if ok else 1)
PY
  then
    echo "failure-case unexpectedly succeeded" >&2
    exit 1
  fi
fi
if [[ -n "$EVIDENCE_PATH" ]]; then
  mkdir -p "$(dirname "$EVIDENCE_PATH")"
  evidence_tmp="$EVIDENCE_PATH.tmp.$$"
  python3 - "$BASE_URL" "$GROUP_ID" "$USER_ID" "$FAILURE_GROUP_ID" "${failure_status:-}" \
    /tmp/onebot-uat-group.$$ /tmp/onebot-uat-private.$$ /tmp/onebot-uat-failure.$$ <<'PY' > "$evidence_tmp"
import json, sys
from datetime import datetime, timezone

base_url, group_id, user_id, failure_group_id, failure_http_status, group_path, private_path, failure_path = sys.argv[1:]

def read(path):
    try:
        with open(path, encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, json.JSONDecodeError):
        return {}

def safe_endpoint(value):
    from urllib.parse import urlsplit, urlunsplit
    parts = urlsplit(value)
    if not parts.scheme or not parts.hostname:
        return value
    netloc = parts.hostname
    if ":" in netloc and not netloc.startswith("["):
        netloc = f"[{netloc}]"
    if parts.port is not None and not ((parts.scheme == "http" and parts.port == 80) or (parts.scheme == "https" and parts.port == 443)):
        netloc += f":{parts.port}"
    return urlunsplit((parts.scheme, netloc, parts.path.rstrip("/"), "", ""))

def result(path, status):
    data = read(path)
    return {
        "http_status": int(status),
        "status": data.get("status", "missing"),
        "retcode": data.get("retcode"),
        "message_id": data.get("message_id"),
    }

record = {
    "version": 1,
    "source": "external-onebot-runner",
    "real_endpoint": True,
    "confirmed": True,
    "tested_at_utc": datetime.now(timezone.utc).isoformat(),
    "endpoint": safe_endpoint(base_url),
    "group": result(group_path, "200"),
    "private": result(private_path, "200"),
    "failure": result(failure_path, failure_http_status),
}
json.dump(record, sys.stdout, ensure_ascii=False, indent=2)
sys.stdout.write("\n")
PY
  mv -f "$evidence_tmp" "$EVIDENCE_PATH"
fi
echo "OneBot group/private delivery checks passed"
