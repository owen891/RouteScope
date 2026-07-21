param(
  [string]$Password
)

$ErrorActionPreference = "Stop"

function New-RandomBase64Text {
  param(
    [int]$ByteCount,
    [int]$Length
  )

  $Bytes = New-Object byte[] $ByteCount
  $Rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $Rng.GetBytes($Bytes)
  }
  finally {
    $Rng.Dispose()
  }
  $Text = [Convert]::ToBase64String($Bytes) -replace '[^A-Za-z0-9]', ''
  if ($Text.Length -lt $Length) {
    throw "failed to generate enough random password characters"
  }
  return $Text.Substring(0, $Length)
}

if ([string]::IsNullOrWhiteSpace($Password)) {
  $Password = New-RandomBase64Text -ByteCount 24 -Length 20
}
$TokenSecret = New-RandomBase64Text -ByteCount 48 -Length 48

@"
# --- paste into .env then: docker compose up -d --force-recreate ---
AUTH_ENABLED=true
ADMIN_USERNAME=admin
ADMIN_PASSWORD=$Password
AUTH_TOKEN_SECRET=$TokenSecret

# Also open Settings -> 登录鉴权 -> 启用 -> 填写同一密码 -> 保存 -> 应用
# Verify with: powershell -ExecutionPolicy Bypass -File ./scripts/check-production.ps1
# Suggested password (save it): $Password
"@
