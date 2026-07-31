param(
  [ValidateSet("backup", "verify", "list", "restore")]
  [string]$Command = "backup",
  [string]$Tag
)

$ErrorActionPreference = "Stop"
$Root = if ($env:UPSTREAM_OPS_ROOT) { $env:UPSTREAM_OPS_ROOT } else { Split-Path -Parent $PSScriptRoot }
$DataDir = if ($env:UPSTREAM_OPS_DATA_DIR) { $env:UPSTREAM_OPS_DATA_DIR } else { Join-Path $Root "data" }
$BackupDir = if ($env:UPSTREAM_OPS_BACKUP_DIR) { $env:UPSTREAM_OPS_BACKUP_DIR } else { Join-Path $DataDir "backups" }
$ConfigName = "config.yaml"
$SqliteName = "upstream-ops.db"
$MysqlName = "upstream-ops.sql"
$AppService = if ($env:UPSTREAM_OPS_COMPOSE_SERVICE) { $env:UPSTREAM_OPS_COMPOSE_SERVICE } else { "app" }
$StopApp = if ($env:UPSTREAM_OPS_STOP_APP) { $env:UPSTREAM_OPS_STOP_APP } else { "auto" }
$DbDriver = if ($env:DATABASE_DRIVER) { $env:DATABASE_DRIVER.ToLowerInvariant() } else { "" }
$EffectiveAppSecret = if ($env:APP_SECRET) { $env:APP_SECRET } else { "" }
$ComposeConfig = $null
$AppWasStopped = $false
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Get-ComposeArguments {
  $args = @("compose", "-f", (Join-Path $Root "docker-compose.yml"))
  if ($DbDriver -eq "mysql") { $args += @("-f", (Join-Path $Root "docker-compose.mysql.yml")) }
  return $args
}

function Resolve-Deployment {
  if (Get-Command docker -ErrorAction SilentlyContinue) {
    try {
      $raw = & docker compose -f (Join-Path $Root "docker-compose.yml") -f (Join-Path $Root "docker-compose.mysql.yml") config --format json 2>$null | Out-String
      if (-not $raw.Trim()) { $raw = & docker compose -f (Join-Path $Root "docker-compose.yml") config --format json 2>$null | Out-String }
      if ($raw.Trim()) {
        $script:ComposeConfig = $raw | ConvertFrom-Json
        $envMap = $script:ComposeConfig.services.app.environment
        if (-not $script:DbDriver -and $envMap.DATABASE_DRIVER) { $script:DbDriver = ([string]$envMap.DATABASE_DRIVER).ToLowerInvariant() }
        if (-not $script:EffectiveAppSecret -and $envMap.APP_SECRET) { $script:EffectiveAppSecret = [string]$envMap.APP_SECRET }
      }
    } catch { }
  }
  if (-not $script:DbDriver) { $script:DbDriver = "sqlite" }
  if ($script:DbDriver -ne "sqlite" -and $script:DbDriver -ne "mysql") { throw "unsupported DATABASE_DRIVER: $($script:DbDriver)" }
}

Resolve-Deployment

function Invoke-Compose {
  param([Parameter(Mandatory = $true)][string[]]$Arguments)
  $prefix = Get-ComposeArguments
  $output = & docker @prefix @Arguments 2>&1
  if ($LASTEXITCODE -ne 0) { throw "docker compose $($Arguments -join ' ') failed with exit code $LASTEXITCODE" }
  return $output
}

function Test-ComposeAvailable {
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { return $false }
  try { Invoke-Compose -Arguments @("config", "--services") | Out-Null; return $true } catch { return $false }
}

function Test-AppRunning {
  if (-not (Test-ComposeAvailable)) { return $false }
  try { $services = Invoke-Compose -Arguments @("ps", "--status=running", "--services") } catch { return $false }
  return @($services | Where-Object { $_.ToString().Trim() -eq $AppService }).Count -gt 0
}

function Stop-AppIfRequested {
  if ($StopApp -eq "0") {
    if (Test-AppRunning) { throw "UPSTREAM_OPS_STOP_APP=0 refuses to operate on a running $AppService; stop Compose first" }
    return
  }
  if ($StopApp -eq "1" -and -not (Test-ComposeAvailable)) { throw "UPSTREAM_OPS_STOP_APP=1 requires a valid Docker Compose project" }
  if (-not (Test-AppRunning)) { return }
  Invoke-Compose -Arguments @("stop", $AppService) | Out-Null
  $script:AppWasStopped = $true
}

function Get-FileSha256([string]$Path) { (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant() }
function Get-FileSize([string]$Path) { [int64](Get-Item -LiteralPath $Path).Length }
function Get-ValueSha256([string]$Value) {
  $sha = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($Value))) -replace "-", "").ToLowerInvariant() } finally { $sha.Dispose() }
}

function Invoke-SQLiteOnlineBackup([string]$Source, [string]$Destination) {
  $python = Get-Command python3 -ErrorAction SilentlyContinue
  if (-not $python) { $python = Get-Command python -ErrorAction SilentlyContinue }
  if (-not $python) { return $false }
  $program = [string]::Join("`n", @(
    'from pathlib import Path',
    'import sqlite3, sys',
    'source_path = Path(sys.argv[1]).resolve()',
    'destination_path = Path(sys.argv[2]).resolve()',
    'source_uri = source_path.as_uri() + "?mode=ro"',
    'with sqlite3.connect(source_uri, uri=True, timeout=30) as source, sqlite3.connect(destination_path, timeout=30) as destination:',
    '    source.backup(destination, pages=256)',
    '    result = destination.execute("PRAGMA integrity_check").fetchone()[0]',
    '    if result != "ok":',
    '        raise SystemExit(f"backup integrity_check failed: {result}")'
  ))
  $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($program))
  & $python.Source -c "import base64;exec(base64.b64decode('$encoded'))" $Source $Destination
  if ($LASTEXITCODE -ne 0) { throw "SQLite online backup failed" }
  return $true
}

function Test-SQLiteIntegrity([string]$Path) {
  $python = Get-Command python3 -ErrorAction SilentlyContinue
  if (-not $python) { $python = Get-Command python -ErrorAction SilentlyContinue }
  if (-not $python) { return }
  $program = [string]::Join("`n", @(
    'import sqlite3,sys',
    'db=sqlite3.connect("file:"+sys.argv[1]+"?mode=ro",uri=True,timeout=30)',
    'result=db.execute("PRAGMA integrity_check").fetchone()[0]',
    'db.close()',
    'if result != "ok":',
    '    raise SystemExit("SQLite integrity_check failed: "+result)'
  ))
  $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($program))
  & $python.Source -c "import base64;exec(base64.b64decode('$encoded'))" $Path
  if ($LASTEXITCODE -ne 0) { throw "SQLite integrity_check failed" }
}

function Invoke-MySQLDump([string]$Destination) {
  $prefix = Get-ComposeArguments
  $output = & docker @prefix exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_PASSWORD" mysqldump --single-transaction --quick --skip-lock-tables --routines --events --triggers --no-tablespaces "$MYSQL_DATABASE"' 2>&1
  if ($LASTEXITCODE -ne 0) { throw "MySQL dump failed with exit code $LASTEXITCODE" }
  $body = (($output | ForEach-Object { $_.ToString() }) -join "`n") + "`n"
  [IO.File]::WriteAllText($Destination, $body, $Utf8NoBom)
  if ((Get-Item -LiteralPath $Destination).Length -eq 0) { throw "MySQL dump is empty" }
}

function Invoke-MySQLRestore([string]$Source) {
  Invoke-Compose -Arguments @("up", "-d", "mysql") | Out-Null
  $prefix = Get-ComposeArguments
  $body = Get-Content -LiteralPath $Source -Raw
  $body | & docker @prefix exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_PASSWORD" mysql "$MYSQL_DATABASE"' 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "MySQL restore failed with exit code $LASTEXITCODE" }
}

function Write-Manifest([string]$Dir, [string]$Mode, [string]$Driver, [string]$DbName) {
  $manifest = [ordered]@{
    version = 3
    mode = $Mode
    database = [ordered]@{ driver = $Driver; name = $DbName; size = Get-FileSize (Join-Path $Dir $DbName); sha256 = Get-FileSha256 (Join-Path $Dir $DbName) }
    config = [ordered]@{ name = $ConfigName; size = Get-FileSize (Join-Path $Dir $ConfigName); sha256 = Get-FileSha256 (Join-Path $Dir $ConfigName) }
    security = [ordered]@{ app_secret_sha256 = if ($EffectiveAppSecret) { Get-ValueSha256 $EffectiveAppSecret } else { "" } }
    created_at = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ")
  }
  [IO.File]::WriteAllText((Join-Path $Dir "manifest.json"), ($manifest | ConvertTo-Json -Depth 5 -Compress), $Utf8NoBom)
}

function Get-Snapshot([string]$SnapshotTag) {
  if ([string]::IsNullOrWhiteSpace($SnapshotTag) -or $SnapshotTag.Contains("..") -or $SnapshotTag.Contains("/") -or $SnapshotTag.Contains("\")) { throw "unsafe or missing snapshot tag" }
  $dir = Join-Path $BackupDir $SnapshotTag; $manifestPath = Join-Path $dir "manifest.json"
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw "missing snapshot manifest: $manifestPath" }
  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  $driver = if ($manifest.database.driver) { [string]$manifest.database.driver } else { "sqlite" }
  $dbName = [string]$manifest.database.name
  if (($driver -eq "sqlite" -and $dbName -ne $SqliteName) -or ($driver -eq "mysql" -and $dbName -ne $MysqlName) -or ($driver -ne "sqlite" -and $driver -ne "mysql")) { throw "snapshot database driver/name is invalid" }
  $dbPath = Join-Path $dir $dbName; $configPath = Join-Path $dir $ConfigName
  if (-not (Test-Path -LiteralPath $dbPath -PathType Leaf) -or -not (Test-Path -LiteralPath $configPath -PathType Leaf)) { throw "snapshot files are incomplete: $dir" }
  if ($manifest.config.name -ne $ConfigName) { throw "snapshot manifest file names are invalid" }
  if ((Get-FileSha256 $dbPath) -ne ([string]$manifest.database.sha256).ToLowerInvariant()) { throw "database checksum mismatch" }
  if ((Get-FileSha256 $configPath) -ne ([string]$manifest.config.sha256).ToLowerInvariant()) { throw "config checksum mismatch" }
  if ((Get-FileSize $dbPath) -ne [int64]$manifest.database.size) { throw "database size mismatch" }
  if ((Get-FileSize $configPath) -ne [int64]$manifest.config.size) { throw "config size mismatch" }
  if ($driver -eq "sqlite") { Test-SQLiteIntegrity $dbPath }
  return @{ Tag = $SnapshotTag; Dir = $dir; Driver = $driver; DbName = $dbName; Manifest = $manifest }
}

function Verify-AppSecret([hashtable]$Snapshot) {
  $expected = [string]$Snapshot.Manifest.security.app_secret_sha256
  if (-not $expected) { return }
  if (-not $EffectiveAppSecret) { throw "APP_SECRET is required to restore this encrypted snapshot" }
  if ((Get-ValueSha256 $EffectiveAppSecret) -ne $expected.ToLowerInvariant()) { throw "APP_SECRET does not match the snapshot encryption key" }
}

function Backup-Snapshot {
  $stamp = if ($env:BACKUP_TAG) { $env:BACKUP_TAG } else { Get-Date -Format "yyyyMMdd_HHmmss" }
  $target = Join-Path $BackupDir $stamp; $staging = Join-Path $BackupDir ".${stamp}.tmp"
  $configPath = Join-Path $DataDir $ConfigName
  if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) { throw "missing $configPath" }
  if (Test-Path -LiteralPath $target) { throw "snapshot already exists: $stamp" }
  if ($DbDriver -eq "sqlite") {
    $dbPath = Join-Path $DataDir $SqliteName
    if (-not (Test-Path -LiteralPath $dbPath -PathType Leaf)) { throw "missing $dbPath" }
  } elseif (-not (Test-ComposeAvailable)) { throw "MySQL backup requires a valid Docker Compose project" }
  New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
  Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Path $staging -Force | Out-Null
  try {
    Stop-AppIfRequested
    if ($DbDriver -eq "mysql") {
      $dbName = $MysqlName; Invoke-MySQLDump (Join-Path $staging $dbName); $mode = "mysql-dump"
    } else {
      $dbName = $SqliteName; $snapshotDB = Join-Path $staging $dbName
      $online = Invoke-SQLiteOnlineBackup (Join-Path $DataDir $SqliteName) $snapshotDB
      if ($online) { $mode = "sqlite-online" }
      else {
        $hasSidecars = (Test-Path -LiteralPath (Join-Path $DataDir "$SqliteName-wal") -PathType Leaf) -or (Test-Path -LiteralPath (Join-Path $DataDir "$SqliteName-shm") -PathType Leaf)
        if ($hasSidecars -and -not $AppWasStopped) { throw "active SQLite sidecars detected and Python is unavailable; install Python or stop Compose app" }
        Copy-Item -LiteralPath (Join-Path $DataDir $SqliteName) -Destination $snapshotDB
        $mode = if ($AppWasStopped) { "stopped-copy" } else { "clean-copy" }
        if ($AppWasStopped) { foreach ($sidecar in @("$SqliteName-wal", "$SqliteName-shm")) { $path = Join-Path $DataDir $sidecar; if (Test-Path -LiteralPath $path -PathType Leaf) { Copy-Item -LiteralPath $path -Destination (Join-Path $staging $sidecar) } } }
      }
    }
    Copy-Item -LiteralPath $configPath -Destination (Join-Path $staging $ConfigName)
    Write-Manifest $staging $mode $DbDriver $dbName
    Move-Item -LiteralPath $staging -Destination $target
    Get-Snapshot $stamp | Out-Null
    Write-Host "backup verified: $stamp ($mode)"
  } catch { Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue; throw }
}

function Restore-Snapshot([string]$SnapshotTag) {
  $snapshot = Get-Snapshot $SnapshotTag
  Verify-AppSecret $snapshot
  if ($snapshot.Driver -ne $DbDriver) { throw "snapshot database driver ($($snapshot.Driver)) does not match current deployment ($DbDriver)" }
  Stop-AppIfRequested
  New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
  if ($snapshot.Driver -eq "mysql") {
    Invoke-MySQLRestore (Join-Path $snapshot.Dir $snapshot.DbName)
    Copy-Item -LiteralPath (Join-Path $snapshot.Dir $ConfigName) -Destination (Join-Path $DataDir $ConfigName) -Force
  } else {
    $dbTmp = Join-Path $DataDir ".${SqliteName}.restore.tmp"; $configTmp = Join-Path $DataDir ".${ConfigName}.restore.tmp"
    Remove-Item -LiteralPath $dbTmp, $configTmp -Force -ErrorAction SilentlyContinue
    Copy-Item -LiteralPath (Join-Path $snapshot.Dir $snapshot.DbName) -Destination $dbTmp
    Copy-Item -LiteralPath (Join-Path $snapshot.Dir $ConfigName) -Destination $configTmp
    Move-Item -LiteralPath $dbTmp -Destination (Join-Path $DataDir $SqliteName) -Force
    Move-Item -LiteralPath $configTmp -Destination (Join-Path $DataDir $ConfigName) -Force
    Remove-Item -LiteralPath (Join-Path $DataDir "$SqliteName-wal"), (Join-Path $DataDir "$SqliteName-shm") -Force -ErrorAction SilentlyContinue
    foreach ($sidecar in @("$SqliteName-wal", "$SqliteName-shm")) { $path = Join-Path $snapshot.Dir $sidecar; if (Test-Path -LiteralPath $path -PathType Leaf) { Copy-Item -LiteralPath $path -Destination (Join-Path $DataDir $sidecar) } }
  }
  if ($AppWasStopped) { Invoke-Compose -Arguments @("up", "-d", $AppService) | Out-Null; $script:AppWasStopped = $false }
  $healthPort = if ($env:HTTP_PORT) { $env:HTTP_PORT } else { "8080" }
  $healthUrl = if ($env:UPSTREAM_OPS_HEALTH_URL) { $env:UPSTREAM_OPS_HEALTH_URL } else { "http://localhost:$healthPort/healthz" }
  try { Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 15 | Out-Null } catch { throw "restore completed but health check failed: $healthUrl" }
  Write-Host "restore verified: $SnapshotTag"
}

try {
  switch ($Command) {
    "backup" { Backup-Snapshot }
    "verify" { Get-Snapshot $Tag | Out-Null; Write-Host "snapshot verified: $Tag" }
    "list" { if (Test-Path -LiteralPath $BackupDir) { Get-ChildItem -LiteralPath $BackupDir -Directory | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName "manifest.json") } | Sort-Object Name | ForEach-Object { Join-Path $_.FullName "manifest.json" } } }
    "restore" { Restore-Snapshot $Tag }
  }
}
finally {
  if ($AppWasStopped) { try { Invoke-Compose -Arguments @("up", "-d", $AppService) | Out-Null } catch { Write-Error $_ } }
}
