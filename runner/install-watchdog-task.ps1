[CmdletBinding()]
param(
    [switch]$Remove
)

$ErrorActionPreference = 'Stop'
$taskName = 'Cy Runner Watchdog'
$runnerDir = Split-Path -Parent $PSCommandPath
$watchdogPath = Join-Path $runnerDir 'cy-watchdog.ps1'

if ($Remove) {
    schtasks.exe /Delete /TN $taskName /F
    exit $LASTEXITCODE
}

if (-not (Test-Path -LiteralPath $watchdogPath)) {
    throw "Cy watchdog is missing: $watchdogPath"
}

$taskCommand = 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "{0}"' -f $watchdogPath
schtasks.exe /Create /TN $taskName /TR $taskCommand /SC MINUTE /MO 1 /RU SYSTEM /RL HIGHEST /F
if ($LASTEXITCODE -ne 0) {
    throw "Could not create scheduled task '$taskName'."
}

schtasks.exe /Run /TN $taskName
if ($LASTEXITCODE -ne 0) {
    throw "Could not start scheduled task '$taskName'."
}

Write-Output "Installed and started scheduled task '$taskName'."
