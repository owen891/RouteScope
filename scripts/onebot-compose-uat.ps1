param([switch]$Keep)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Project = "upstream-ops-onebot-uat-$PID"
$Port = if ($env:UPSTREAM_OPS_UAT_PORT) { $env:UPSTREAM_OPS_UAT_PORT } else { "18419" }
$env:COMPOSE_PROJECT_NAME = $Project
$env:UPSTREAM_OPS_UAT_PORT = $Port
$env:APP_SECRET = "uat-only-app-secret-not-production"

function Compose([string[]]$ComposeArgs) {
  & docker compose -f (Join-Path $Root "docker-compose.onebot-uat.yml") @ComposeArgs
  if ($LASTEXITCODE -ne 0) { throw "docker compose failed" }
}

try {
  Push-Location $Root
  Compose @("run", "--rm", "onebot-check")
  $health = "http://127.0.0.1:$Port/healthz"
  for ($i = 0; $i -lt 30; $i++) {
    try { Invoke-WebRequest -UseBasicParsing -Uri $health -TimeoutSec 3 | Out-Null; break }
    catch { if ($i -eq 29) { throw "app health check failed: $health" }; Start-Sleep -Seconds 1 }
  }
  Write-Host "Container network fixture is ready; app health=200 at $health."
  Write-Host "The profile validates Docker networking and OneBot protocol behavior, not real QQ delivery."
}
finally {
  Pop-Location
  if (-not $Keep) { try { Compose @("down", "-v", "--remove-orphans") | Out-Null } catch { } }
}
