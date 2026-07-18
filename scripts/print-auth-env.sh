#!/usr/bin/env bash
# Print recommended .env lines for enabling auth. Does NOT rewrite .env automatically
# (avoids locking you out without a known password).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

pass="${1:-}"
if [[ -z "$pass" ]]; then
  # generate a random password suggestion
  if command -v openssl >/dev/null 2>&1; then
    pass="$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-20)"
  else
    pass="ChangeMe-$(date +%s)"
  fi
fi

token_secret=""
if command -v openssl >/dev/null 2>&1; then
  token_secret="$(openssl rand -hex 24)"
fi

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
