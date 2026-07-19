#!/usr/bin/env bash
# Explicit real OneBot v11 delivery check. Never prints the access token.
set -euo pipefail

BASE_URL="${ONEBOT_BASE_URL:-http://127.0.0.1:5700}"
ACCESS_TOKEN="${ONEBOT_ACCESS_TOKEN:-}"
GROUP_ID="${ONEBOT_GROUP_ID:-}"
USER_ID="${ONEBOT_USER_ID:-}"
FAILURE_GROUP_ID="${ONEBOT_FAILURE_GROUP_ID:-}"
CONFIRM="${ONEBOT_CONFIRM:-0}"
MESSAGE="${ONEBOT_TEST_MESSAGE:-UpstreamOps OneBot UAT $(date -u +%Y-%m-%dT%H:%M:%SZ)}"

if [[ -z "$GROUP_ID" || -z "$USER_ID" ]]; then
  echo "ONEBOT_GROUP_ID and ONEBOT_USER_ID are required" >&2
  exit 2
fi
BASE_URL="${BASE_URL%/}"

request() {
  local endpoint="$1" body="$2" mode="$3" url="$BASE_URL/$endpoint"
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
  local label="$1" status="$2"
  python3 - "$label" "$status" /tmp/onebot-uat-response.$$ <<'PY'
import json, sys
label, status, path = sys.argv[1:]
try:
    data = json.load(open(path, encoding='utf-8'))
except Exception as exc:
    print(f"{label}: HTTP {status}, invalid JSON ({exc})", file=sys.stderr)
    raise SystemExit(1)
retcode = data.get("retcode")
ok = str(data.get("status", "")).lower() == "ok" and (retcode is None or retcode == 0)
message_id = "present" if data.get("message_id") is not None else "absent"
print(f"{label}: HTTP {status}, status={data.get('status', 'missing')}, retcode={retcode if retcode is not None else 'missing'}, message_id={message_id}")
raise SystemExit(0 if ok and status == "200" else 1)
PY
}

trap 'rm -f /tmp/onebot-uat-response.$$' EXIT
if [[ "$CONFIRM" != "1" ]]; then
  echo "dry-run only: endpoint=$BASE_URL; group/private targets configured; set ONEBOT_CONFIRM=1 to send" 
  exit 0
fi

status="$(request send_group_msg "{\"group_id\":$(json_id "$GROUP_ID"),\"message\":$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$MESSAGE")}" bearer)"
check_response "group" "$status"
status="$(request send_private_msg "{\"user_id\":$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$USER_ID"),\"message\":$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$MESSAGE")}" query)"
check_response "private" "$status"
if [[ -n "$FAILURE_GROUP_ID" ]]; then
  status="$(request send_group_msg "{\"group_id\":$(json_id "$FAILURE_GROUP_ID"),\"message\":$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$MESSAGE failure-case")}" bearer)"
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
echo "OneBot group/private delivery checks passed"
