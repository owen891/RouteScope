param(
  [string]$BaseUrl = "http://127.0.0.1:5700",
  [Parameter(Mandatory = $true)][string]$GroupId,
  [Parameter(Mandatory = $true)][string]$UserId,
  [string]$AccessToken = $env:ONEBOT_ACCESS_TOKEN,
  [string]$FailureGroupId = $env:ONEBOT_FAILURE_GROUP_ID,
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
    return @{ Status = [int]$response.StatusCode; Data = ($response.Content | ConvertFrom-Json) }
  }
  catch {
    if ($_.Exception.Response) { throw "${Endpoint}: HTTP $([int]$_.Exception.Response.StatusCode)" }
    throw
  }
}

function Convert-OneBotId([string]$Value) {
  if ($Value -match '^\d+$') { return [int64]$Value }
  return $Value
}

if (-not $Confirm) {
  Write-Host "dry-run only: endpoint=$BaseUrl; group/private targets configured; use -Confirm to send"
  exit 0
}

function Assert-OK($Label, $Result) {
  $retcode = $Result.Data.retcode
  $status = $Result.Data.status
  $messageId = if ($null -ne $Result.Data.message_id) { "present" } else { "absent" }
  Write-Host "$Label`: HTTP $($Result.Status), status=$status, retcode=$retcode, message_id=$messageId"
  if ($Result.Status -ne 200 -or $status -ne "ok" -or ($null -ne $retcode -and $retcode -ne 0)) { throw "$Label failed" }
}

Assert-OK "group" (Invoke-OneBot "send_group_msg" @{ group_id = (Convert-OneBotId $GroupId); message = $Message } "bearer")
Assert-OK "private" (Invoke-OneBot "send_private_msg" @{ user_id = (Convert-OneBotId $UserId); message = $Message } "query")
if ($FailureGroupId) {
  $failure = Invoke-OneBot "send_group_msg" @{ group_id = (Convert-OneBotId $FailureGroupId); message = "$Message failure-case" } "bearer"
  $failureStatus = $failure.Data.status
  $failureRetcode = $failure.Data.retcode
  Write-Host "failure-case`: HTTP $($failure.Status), status=$failureStatus, retcode=$failureRetcode"
  if ($failure.Status -eq 200 -and $failureStatus -eq "ok" -and ($null -eq $failureRetcode -or $failureRetcode -eq 0)) {
    throw "failure-case unexpectedly succeeded"
  }
}
Write-Host "OneBot group/private delivery checks passed" -ForegroundColor Green
