param(
  [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$PreviousLocation = Get-Location
$HadAppSecret = Test-Path Env:\APP_SECRET
$PreviousAppSecret = $env:APP_SECRET

function Invoke-CheckedCommand {
  param(
    [string]$Label,
    [scriptblock]$Command
  )

  Write-Host "==> $Label"
  & $Command
  if ($LASTEXITCODE -ne 0) {
    throw "$Label failed with exit code $LASTEXITCODE"
  }
}

function Invoke-Pnpm {
  param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)

  $Prefix = @($script:PnpmCommand | Select-Object -Skip 1)
  & $script:PnpmCommand[0] @Prefix @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "pnpm $($Arguments -join ' ') failed with exit code $LASTEXITCODE"
  }
}

try {
  Set-Location $Root
  $Pnpm = Get-Command pnpm.cmd -ErrorAction SilentlyContinue
  if ($Pnpm) {
    $script:PnpmCommand = @($Pnpm.Source)
  }
  else {
    $Pnpm = Get-Command pnpm -ErrorAction SilentlyContinue
    if ($Pnpm) {
      $script:PnpmCommand = @($Pnpm.Source)
    }
    else {
      $Corepack = Get-Command corepack -ErrorAction SilentlyContinue
      if (-not $Corepack) {
        throw "pnpm 10.4.0 is required. Enable Corepack or install the pinned pnpm version."
      }
      $script:PnpmCommand = @($Corepack.Source, "pnpm")
    }
  }
  $PnpmVersion = (Invoke-Pnpm --version).Trim()
  if ($PnpmVersion -ne "10.4.0") {
    throw "pnpm 10.4.0 is required; found $PnpmVersion."
  }

  Invoke-CheckedCommand "validate native security and workflow contracts" {
    go test ./scripts -run '^(TestPowerShellSecurityTools|TestWorkflowContracts)$' -count=1
  }
  Invoke-CheckedCommand "check diff" { git diff --check }
  Set-Location (Join-Path $Root "frontend")
  if (-not $SkipInstall) {
    Invoke-CheckedCommand "install frontend dependencies" { Invoke-Pnpm install --frozen-lockfile }
  }
  Invoke-CheckedCommand "lint frontend" { Invoke-Pnpm lint }
  Invoke-CheckedCommand "test frontend" { Invoke-Pnpm test }
  Invoke-CheckedCommand "build frontend" { Invoke-Pnpm build }

  Set-Location $Root
  Invoke-CheckedCommand "test backend" { go test ./... -count=1 }
  $env:APP_SECRET = "verification-only-placeholder-not-for-production"
  Invoke-CheckedCommand "validate Compose configuration" { docker compose config --quiet }
  Write-Host "All quality gates passed." -ForegroundColor Green
}
finally {
  Set-Location $PreviousLocation
  if ($HadAppSecret) {
    $env:APP_SECRET = $PreviousAppSecret
  }
  else {
    Remove-Item Env:\APP_SECRET -ErrorAction SilentlyContinue
  }
}
