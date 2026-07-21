param(
  [string]$BaseUrl = "http://127.0.0.1:5700",
  [Parameter(Mandatory = $true)][string]$GroupId,
  [Parameter(Mandatory = $true)][string]$UserId,
  [string]$AccessToken = $env:ONEBOT_ACCESS_TOKEN,
  [string]$FailureGroupId = $env:ONEBOT_FAILURE_GROUP_ID,
  [string]$EvidencePath = $env:ONEBOT_UAT_EVIDENCE_PATH,
  [switch]$RealEndpoint,
  [switch]$Confirm,
  [string]$Message = "UpstreamOps OneBot UAT $([DateTime]::UtcNow.ToString('o'))"
)

$ErrorActionPreference = "Stop"
$BaseUrl = $BaseUrl.TrimEnd('/')

function Invoke-OneBot([string]$Endpoint, [hashtable]$Body, [ValidateSet("bearer", "query")][string]$Mode) {
  $uri = "$BaseUrl/$Endpoint"
  $headers = @{}
  if ($AccessToken -and $Mode -eq "bearer") { $headers.Authorization = "Bearer $AccessToken" }
  if ($AccessToken -and $Mode -eq "query") { $uri += "?access_token=$([uri]::EscapeDataString($AccessToken))" }
  try {
    $response = Invoke-WebRequest -Uri $uri -Method Post -Headers $headers -ContentType "application/json" -Body ($Body | ConvertTo-Json -Compress) -UseBasicParsing -TimeoutSec 15
    $data = $null
    try { $data = $response.Content | ConvertFrom-Json } catch { }
    return @{ Status = [int]$response.StatusCode; Data = $data; Error = $null }
  }
  catch {
    if ($_.Exception.Response) {
      $errorResponse = $_.Exception.Response
      $data = $null
      try {
        $stream = $errorResponse.GetResponseStream()
        $reader = [System.IO.StreamReader]::new($stream)
        $raw = $reader.ReadToEnd()
        if ($raw) { $data = $raw | ConvertFrom-Json }
      } catch { }
      return @{ Status = [int]$errorResponse.StatusCode; Data = $data; Error = $null }
    }
    throw
  }
}

function Convert-OneBotId([string]$Value) {
  if ($Value -match '^\d+$') { return [int64]$Value }
  return $Value
}

function Get-SafeEndpoint([string]$Value) {
  $uri = [Uri]$Value
  $port = if (($uri.Scheme -eq "http" -and $uri.Port -eq 80) -or ($uri.Scheme -eq "https" -and $uri.Port -eq 443)) { "" } else { ":$($uri.Port)" }
  return "$($uri.Scheme)://$($uri.Host)$port$($uri.AbsolutePath.TrimEnd('/'))"
}

if (-not $Confirm) {
  Write-Host "dry-run only: endpoint=$BaseUrl; group/private targets configured; use -Confirm to send"
  exit 0
}
if ($EvidencePath -and -not $RealEndpoint) {
  throw "-EvidencePath requires -RealEndpoint; synthetic fixtures cannot produce release evidence"
}
if ($EvidencePath -and -not $FailureGroupId) {
  throw "-EvidencePath requires -FailureGroupId so the release record contains a deliberate failure"
}

function Assert-OK($Label, $Result) {
  $retcode = if ($Result.Data) { $Result.Data.retcode } else { $null }
  $status = if ($Result.Data) { $Result.Data.status } else { "missing" }
  $hasMessageId = $Result.Data -and $null -ne $Result.Data.message_id -and "$($Result.Data.message_id)".Trim() -ne ""
  $messageId = if ($hasMessageId) { $Result.Data.message_id } else { "missing" }
  Write-Host "$Label`: HTTP $($Result.Status), status=$status, retcode=$retcode, message_id=$messageId"
  if ($Result.Status -ne 200 -or $status -ne "ok" -or ($null -ne $retcode -and $retcode -ne 0) -or -not $hasMessageId) { throw "$Label failed: OneBot did not return a message_id" }
}

$groupResult = Invoke-OneBot "send_group_msg" @{ group_id = (Convert-OneBotId $GroupId); message = $Message } "bearer"
Assert-OK "group" $groupResult
$privateResult = Invoke-OneBot "send_private_msg" @{ user_id = (Convert-OneBotId $UserId); message = $Message } "query"
Assert-OK "private" $privateResult
$failureResult = $null
if ($FailureGroupId) {
  $failureResult = Invoke-OneBot "send_group_msg" @{ group_id = (Convert-OneBotId $FailureGroupId); message = "$Message failure-case" } "bearer"
  $failureStatus = if ($failureResult.Data) { $failureResult.Data.status } else { "missing" }
  $failureRetcode = if ($failureResult.Data) { $failureResult.Data.retcode } else { $null }
  Write-Host "failure-case`: HTTP $($failureResult.Status), status=$failureStatus, retcode=$failureRetcode"
  if ($failureResult.Status -eq 200 -and $failureStatus -eq "ok" -and ($null -eq $failureRetcode -or $failureRetcode -eq 0)) {
    throw "failure-case unexpectedly succeeded"
  }
}
if ($EvidencePath) {
  $safeEndpoint = Get-SafeEndpoint $BaseUrl
  $record = [ordered]@{
    version = 1
    source = "external-onebot-runner"
    real_endpoint = $true
    confirmed = $true
    tested_at_utc = (Get-Date).ToUniversalTime().ToString("o")
    endpoint = $safeEndpoint
    group = [ordered]@{ http_status = $groupResult.Status; status = if ($groupResult.Data) { $groupResult.Data.status } else { "missing" }; retcode = if ($groupResult.Data) { $groupResult.Data.retcode } else { $null }; message_id = if ($groupResult.Data) { $groupResult.Data.message_id } else { $null } }
    private = [ordered]@{ http_status = $privateResult.Status; status = if ($privateResult.Data) { $privateResult.Data.status } else { "missing" }; retcode = if ($privateResult.Data) { $privateResult.Data.retcode } else { $null }; message_id = if ($privateResult.Data) { $privateResult.Data.message_id } else { $null } }
    failure = [ordered]@{ http_status = if ($failureResult) { $failureResult.Status } else { $null }; status = if ($failureResult -and $failureResult.Data) { $failureResult.Data.status } else { "missing" }; retcode = if ($failureResult -and $failureResult.Data) { $failureResult.Data.retcode } else { $null }; message_id = if ($failureResult -and $failureResult.Data) { $failureResult.Data.message_id } else { $null } }
  }
  $parent = Split-Path -Parent $EvidencePath
  if ($parent) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
  $tempEvidencePath = "$EvidencePath.tmp.$PID"
  try {
    $record | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $tempEvidencePath -Encoding UTF8
    Move-Item -LiteralPath $tempEvidencePath -Destination $EvidencePath -Force
  }
  finally {
    Remove-Item -LiteralPath $tempEvidencePath -Force -ErrorAction SilentlyContinue
  }
  Write-Host "UAT evidence written: $EvidencePath"
}
Write-Host "OneBot group/private delivery checks passed" -ForegroundColor Green
