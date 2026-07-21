param(
  [ValidateSet("build", "verify", "all")]
  [string]$Command = "all"
)

$ErrorActionPreference = "Stop"
$Root = if ($env:UPSTREAM_OPS_ROOT) { $env:UPSTREAM_OPS_ROOT } else { Split-Path -Parent $PSScriptRoot }
$ImageTag = if ($env:UPSTREAM_OPS_CANDIDATE_IMAGE) { $env:UPSTREAM_OPS_CANDIDATE_IMAGE } else { "upstream-ops:candidate-local" }
$Port = if ($env:UPSTREAM_OPS_CANDIDATE_PORT) { [int]$env:UPSTREAM_OPS_CANDIDATE_PORT } else { 18418 }
$DataDir = if ($env:UPSTREAM_OPS_CANDIDATE_DATA_DIR) { $env:UPSTREAM_OPS_CANDIDATE_DATA_DIR } else { Join-Path ([System.IO.Path]::GetTempPath()) ("upstream-ops-candidate-" + [guid]::NewGuid()) }
$Container = if ($env:UPSTREAM_OPS_CANDIDATE_CONTAINER) { $env:UPSTREAM_OPS_CANDIDATE_CONTAINER } else { "upstream-ops-candidate-$PID" }
$AppSecretValue = if ($env:APP_SECRET) { $env:APP_SECRET } else { "release-candidate-local-only-secret-0123456789abcdef" }
$AdminPasswordValue = if ($env:ADMIN_PASSWORD) { $env:ADMIN_PASSWORD } else { "release-candidate-local-password" }
$AuthTokenSecretValue = if ($env:AUTH_TOKEN_SECRET) { $env:AUTH_TOKEN_SECRET } else { "release-candidate-local-token-secret-0123456789abcdef" }
$CreatedData = -not $env:UPSTREAM_OPS_CANDIDATE_DATA_DIR

function Invoke-Docker([string[]]$Arguments) {
  & docker @Arguments
  if ($LASTEXITCODE -ne 0) { throw "Docker command failed" }
}

function Build-Image {
  Invoke-Docker @("build", "--pull=false", "-t", $ImageTag, $Root)
}

function Validate-Compose {
  $oldSecret = $env:APP_SECRET
  try {
    $env:APP_SECRET = $AppSecretValue
    Invoke-Docker @("compose", "-f", (Join-Path $Root "docker-compose.yml"), "config", "--quiet")
  }
  finally { $env:APP_SECRET = $oldSecret }
}

function Verify-Image {
  New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
  Invoke-Docker @("run", "-d", "--name", $Container, "-p", "127.0.0.1:${Port}:8418", "-e", "APP_SECRET=$AppSecretValue", "-e", "AUTH_ENABLED=true", "-e", "ADMIN_USERNAME=admin", "-e", "ADMIN_PASSWORD=$AdminPasswordValue", "-e", "AUTH_TOKEN_SECRET=$AuthTokenSecretValue", "-v", "${DataDir}:/app/data", $ImageTag, "-config", "/app/data/config.yaml") | Out-Null
  $health = "http://127.0.0.1:$Port/healthz"
  for ($i = 0; $i -lt 30; $i++) {
    try {
      Invoke-WebRequest -UseBasicParsing -Uri $health -TimeoutSec 3 | Out-Null
      Write-Host "candidate health verified: $health"
      return
    }
    catch { Start-Sleep -Seconds 1 }
  }
  throw "candidate health check failed: $health"
}

try {
  switch ($Command) {
    "build" { Build-Image; Validate-Compose; Write-Host "candidate image built: $ImageTag" }
    "verify" { Validate-Compose; Verify-Image }
    "all" { Build-Image; Validate-Compose; Verify-Image; Write-Host "candidate verification passed: $ImageTag" }
  }
}
finally {
  try { & docker rm -f $Container *> $null } catch { }
  if ($CreatedData) { Remove-Item -LiteralPath $DataDir -Recurse -Force -ErrorAction SilentlyContinue }
}
