# Build upstream-ops:local on Windows (calls bash script if available)
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
if (Get-Command bash -ErrorAction SilentlyContinue) {
  bash ./scripts/build-local.sh
  exit $LASTEXITCODE
}
Write-Host "bash not found; run scripts/build-local.sh from Git Bash" -ForegroundColor Yellow
exit 1
