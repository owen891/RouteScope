#!/usr/bin/env bash
# Print recommended .env lines for enabling auth. Does NOT rewrite .env automatically
# (avoids locking you out without a known password).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

random_hex() {
  local byte_count="$1"
  local value=""

  if command -v openssl >/dev/null 2>&1; then
    if ! value="$(openssl rand -hex "$byte_count")"; then
      echo "unable to generate credentials: openssl random generation failed" >&2
      return 1
    fi
  elif [[ -r /dev/urandom ]] && command -v od >/dev/null 2>&1; then
    if ! value="$(od -An -N "$byte_count" -tx1 /dev/urandom | tr -d '[:space:]')"; then
      echo "unable to generate credentials: /dev/urandom read failed" >&2
      return 1
    fi
  else
    echo "unable to generate credentials: no cryptographic random source is available" >&2
    return 1
  fi

  if [[ ! "$value" =~ ^[0-9a-fA-F]+$ ]] || (( ${#value} != byte_count * 2 )); then
    echo "unable to generate credentials: cryptographic random source returned invalid data" >&2
    return 1
  fi
  printf '%s' "$value"
}

pass="${1:-}"
if [[ -z "$pass" ]]; then
  pass="$(random_hex 16)"
fi
token_secret="$(random_hex 32)"

cat <<EOF
# --- paste into .env then: docker compose up -d --force-recreate ---
AUTH_ENABLED=true
ADMIN_USERNAME=admin
ADMIN_PASSWORD=${pass}
AUTH_TOKEN_SECRET=${token_secret}

# Also open Settings → 登录鉴权 → 启用 → 填写同一密码 → 保存 → 应用
# Verify: open /api/channels without login should return 401
# Suggested password (save it): ${pass}
EOF
