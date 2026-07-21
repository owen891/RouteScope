param(
  [ValidateSet("backup", "verify", "list", "restore")]
  [string]$Command = "backup",
  [string]$Tag
)

$ErrorActionPreference = "Stop"
$Root = if ($env:UPSTREAM_OPS_ROOT) { $env:UPSTREAM_OPS_ROOT } else { Split-Path -Parent $PSScriptRoot }
$DataDir = if ($env:UPSTREAM_OPS_DATA_DIR) { $env:UPSTREAM_OPS_DATA_DIR } else { Join-Path $Root "data" }
$BackupDir = if ($env:UPSTREAM_OPS_BACKUP_DIR) { $env:UPSTREAM_OPS_BACKUP_DIR } else { Join-Path $DataDir "backups" }
$DbName = "upstream-ops.db"
$ConfigName = "config.yaml"
$AppService = if ($env:UPSTREAM_OPS_COMPOSE_SERVICE) { $env:UPSTREAM_OPS_COMPOSE_SERVICE } else { "app" }
$StopApp = if ($env:UPSTREAM_OPS_STOP_APP) { $env:UPSTREAM_OPS_STOP_APP } else { "auto" }
$AppWasStopped = $false

function Get-FileSha256([string]$Path) {
  (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
}

function Test-ComposeAvailable {
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { return $false }
  try {
    & docker compose -f (Join-Path $Root "docker-compose.yml") config --services 2>$null | Out-Null
    return $LASTEXITCODE -eq 0
  } catch {
    return $false
  }
}

function Test-AppRunning {
  if (-not (Test-ComposeAvailable)) { return $false }
  try {
    $services = & docker compose -f (Join-Path $Root "docker-compose.yml") ps --status=running --services 2>$null
  } catch {
    return $false
  }
  return $LASTEXITCODE -eq 0 -and ($services -split "\r?\n" | Where-Object { $_ -eq $AppService }).Count -gt 0
}

function Stop-AppIfRequested {
  if ($StopApp -eq "0") {
    if (Test-AppRunning) { throw "UPSTREAM_OPS_STOP_APP=0 refuses to operate on a running $AppService; stop Compose first" }
    return
  }
  if ($StopApp -eq "1") {
    if (-not (Test-ComposeAvailable)) { throw "UPSTREAM_OPS_STOP_APP=1 requires a valid Docker Compose project" }
    if (-not (Test-AppRunning)) { return }
    & docker compose -f (Join-Path $Root "docker-compose.yml") stop $AppService *> $null
    if ($LASTEXITCODE -ne 0) { throw "failed to stop Compose service $AppService" }
    $script:AppWasStopped = $true
    return
  }
  if (Test-AppRunning) {
    & docker compose -f (Join-Path $Root "docker-compose.yml") stop $AppService *> $null
    if ($LASTEXITCODE -ne 0) { throw "failed to stop Compose service $AppService" }
    $script:AppWasStopped = $true
  }
}

function Get-Manifest([string]$SnapshotTag) {
  if ([string]::IsNullOrWhiteSpace($SnapshotTag) -or $SnapshotTag.Contains("..") -or $SnapshotTag.Contains("/") -or $SnapshotTag.Contains("\")) {
    throw "unsafe or missing snapshot tag"
  }
  $dir = Join-Path $BackupDir $SnapshotTag
  $manifestPath = Join-Path $dir "manifest.json"
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw "missing snapshot manifest: $manifestPath" }
  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  if (-not (Test-Path -LiteralPath (Join-Path $dir $DbName) -PathType Leaf) -or -not (Test-Path -LiteralPath (Join-Path $dir $ConfigName) -PathType Leaf)) {
    throw "snapshot files are incomplete: $dir"
  }
  if ($manifest.database.name -ne $DbName -or $manifest.config.name -ne $ConfigName) { throw "snapshot manifest file names are invalid" }
  $dbPath = Join-Path $dir $DbName
  $configPath = Join-Path $dir $ConfigName
  if ((Get-FileSha256 $dbPath) -ne $manifest.database.sha256.ToLowerInvariant()) { throw "database checksum mismatch" }
  if ((Get-FileSha256 $configPath) -ne $manifest.config.sha256.ToLowerInvariant()) { throw "config checksum mismatch" }
  if ((Get-Item -LiteralPath $dbPath).Length -ne [int64]$manifest.database.size) { throw "database size mismatch" }
  if ((Get-Item -LiteralPath $configPath).Length -ne [int64]$manifest.config.size) { throw "config size mismatch" }
  return @{ Tag = $SnapshotTag; Dir = $dir; Manifest = $manifest }
}

function Write-Manifest([string]$Dir, [string]$Mode) {
  $dbPath = Join-Path $Dir $DbName
  $configPath = Join-Path $Dir $ConfigName
  $manifest = [ordered]@{
    version = 1
    mode = $Mode
    database = [ordered]@{ name = $DbName; size = (Get-Item -LiteralPath $dbPath).Length; sha256 = Get-FileSha256 $dbPath }
    config = [ordered]@{ name = $ConfigName; size = (Get-Item -LiteralPath $configPath).Length; sha256 = Get-FileSha256 $configPath }
    created_at = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ")
  }
  $manifestJson = $manifest | ConvertTo-Json -Depth 4 -Compress
  [System.IO.File]::WriteAllText((Join-Path $Dir "manifest.json"), $manifestJson, [System.Text.UTF8Encoding]::new($false))
}

function Backup-Snapshot {
  $stamp = if ($env:BACKUP_TAG) { $env:BACKUP_TAG } else { Get-Date -Format "yyyyMMdd_HHmmss" }
  $target = Join-Path $BackupDir $stamp
  $staging = Join-Path $BackupDir ".${stamp}.tmp"
  $dbPath = Join-Path $DataDir $DbName
  $configPath = Join-Path $DataDir $ConfigName
  if (-not (Test-Path -LiteralPath $dbPath -PathType Leaf)) { throw "missing $dbPath" }
  if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) { throw "missing $configPath" }
  if (Test-Path -LiteralPath $target) { throw "snapshot already exists: $stamp" }
  Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Path $staging -Force | Out-Null
  New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
  Stop-AppIfRequested
  $mode = if ($AppWasStopped) { "stopped" } elseif (Test-Path -LiteralPath (Join-Path $DataDir "$DbName-wal")) { "sidecars" } else { "clean" }
  Copy-Item -LiteralPath $dbPath -Destination (Join-Path $staging $DbName)
  Copy-Item -LiteralPath $configPath -Destination (Join-Path $staging $ConfigName)
  foreach ($sidecar in @("$DbName-wal", "$DbName-shm")) {
    $path = Join-Path $DataDir $sidecar
    if (Test-Path -LiteralPath $path -PathType Leaf) { Copy-Item -LiteralPath $path -Destination (Join-Path $staging $sidecar) }
  }
  Write-Manifest $staging $mode
  Move-Item -LiteralPath $staging -Destination $target
  Get-Manifest $stamp | Out-Null
  Write-Host "backup verified: $stamp"
}

function Restore-Snapshot([string]$SnapshotTag) {
  $snapshot = Get-Manifest $SnapshotTag
  Stop-AppIfRequested
  New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
  $dbTmp = Join-Path $DataDir ".${DbName}.restore.tmp"
  $configTmp = Join-Path $DataDir ".${ConfigName}.restore.tmp"
  Remove-Item -LiteralPath $dbTmp, $configTmp -Force -ErrorAction SilentlyContinue
  Copy-Item -LiteralPath (Join-Path $snapshot.Dir $DbName) -Destination $dbTmp
  Copy-Item -LiteralPath (Join-Path $snapshot.Dir $ConfigName) -Destination $configTmp
  Move-Item -LiteralPath $dbTmp -Destination (Join-Path $DataDir $DbName) -Force
  Move-Item -LiteralPath $configTmp -Destination (Join-Path $DataDir $ConfigName) -Force
  Remove-Item -LiteralPath (Join-Path $DataDir "$DbName-wal"), (Join-Path $DataDir "$DbName-shm") -Force -ErrorAction SilentlyContinue
  foreach ($sidecar in @("$DbName-wal", "$DbName-shm")) {
    $path = Join-Path $snapshot.Dir $sidecar
    if (Test-Path -LiteralPath $path -PathType Leaf) { Copy-Item -LiteralPath $path -Destination (Join-Path $DataDir $sidecar) }
  }
  if ($AppWasStopped) {
    & docker compose -f (Join-Path $Root "docker-compose.yml") up -d $AppService *> $null
    if ($LASTEXITCODE -ne 0) { throw "restore completed but failed to restart Compose service $AppService" }
    $script:AppWasStopped = $false
  }
  $healthPort = if ($env:HTTP_PORT) { $env:HTTP_PORT } else { "8080" }
  $healthUrl = if ($env:UPSTREAM_OPS_HEALTH_URL) { $env:UPSTREAM_OPS_HEALTH_URL } else { "http://localhost:$healthPort/healthz" }
  try { Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 15 | Out-Null } catch { throw "restore completed but health check failed: $healthUrl" }
  Write-Host "restore verified: $SnapshotTag"
}

try {
  switch ($Command) {
    "backup" { Backup-Snapshot }
    "verify" { Get-Manifest $Tag | Out-Null; Write-Host "snapshot verified: $Tag" }
    "list" { if (Test-Path -LiteralPath $BackupDir) { Get-ChildItem -LiteralPath $BackupDir -Directory | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName "manifest.json") } | Sort-Object Name | ForEach-Object { Join-Path $_.FullName "manifest.json" } } }
    "restore" { Restore-Snapshot $Tag }
  }
}
finally {
  if ($AppWasStopped) {
    & docker compose -f (Join-Path $Root "docker-compose.yml") up -d $AppService *> $null
  }
}
