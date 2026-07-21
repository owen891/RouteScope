param(
  [string]$BaseUrl = "http://localhost:8080"
)

$ErrorActionPreference = "Stop"
$BaseUrl = $BaseUrl.TrimEnd("/")

function Get-StatusCode {
  param([string]$Url)

  try {
    $Response = Invoke-WebRequest -Uri $Url -Method Get -UseBasicParsing -TimeoutSec 10 -MaximumRedirection 0
    return [int]$Response.StatusCode
  }
  catch {
    if ($_.Exception.Response) {
      return [int]$_.Exception.Response.StatusCode
    }
    throw
  }
}

$HealthStatus = Get-StatusCode "$BaseUrl/healthz"
if ($HealthStatus -ne 200) {
  throw "health check failed: expected 200, got $HealthStatus"
}

$AnonymousStatus = Get-StatusCode "$BaseUrl/api/channels"
if ($AnonymousStatus -ne 401) {
  throw "authentication check failed: anonymous /api/channels expected 401, got $AnonymousStatus. Set AUTH_ENABLED=true and recreate the container before production exposure."
}

Write-Host "Production endpoint checks passed: health=200, anonymous API=401." -ForegroundColor Green
