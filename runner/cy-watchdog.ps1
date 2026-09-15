[CmdletBinding()]
param(
    [ValidateRange(30, 600)]
    [int]$MaxHeartbeatAgeSeconds = 90
)

$ErrorActionPreference = 'Stop'

$runnerDir = Split-Path -Parent $PSCommandPath
$stateDir = Join-Path $runnerDir 'state'
$heartbeatPath = Join-Path $stateDir 'power.json'
$watchdogLogPath = Join-Path $stateDir 'watchdog.log'
$launcherPath = Join-Path $runnerDir 'cy-hidden.vbs'

function Write-WatchdogLog([string]$Message) {
    $line = '[{0}] watchdog: {1}' -f (Get-Date -Format 'dd/MM/yyyy HH:mm:ss.fff'), $Message
    # The runner holds run.out.log open while it is active. Keep watchdog
    # diagnostics separate so an otherwise healthy watchdog cannot fail on a
    # locked runner log.
    Add-Content -LiteralPath $watchdogLogPath -Value $line
    Write-Output $line
}

function Get-CyProcesses {
    @(Get-CimInstance Win32_Process | Where-Object {
        $_.Name -ieq 'node.exe' -and $_.CommandLine -like '*runner*run.js*'
    })
}

function Get-CySupervisors {
    @(Get-CimInstance Win32_Process | Where-Object {
        $_.Name -ieq 'cmd.exe' -and $_.CommandLine -like '*cy-supervisor.bat*'
    })
}

$heartbeatFresh = $false
if (Test-Path -LiteralPath $heartbeatPath) {
    $age = ((Get-Date) - (Get-Item -LiteralPath $heartbeatPath).LastWriteTime).TotalSeconds
    $heartbeatFresh = $age -le $MaxHeartbeatAgeSeconds
}

$runners = Get-CyProcesses
$supervisors = Get-CySupervisors
if ($heartbeatFresh -and $runners.Count -eq 1) {
    Write-Output 'Cy watchdog: runner heartbeat is fresh.'
    exit 0
}

if ($runners.Count -gt 0) {
    Write-WatchdogLog ('stale heartbeat; stopping {0} Cy runner process(es)' -f $runners.Count)
    $runners | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
    if ($supervisors.Count -gt 0) {
        Write-WatchdogLog 'existing supervisor will start the replacement runner.'
        exit 0
    }
}

if ($supervisors.Count -gt 0) {
    Write-WatchdogLog 'runner is absent but its supervisor is present; allowing its restart delay.'
    exit 0
}

if (-not (Test-Path -LiteralPath $launcherPath)) {
    throw "Cy watchdog cannot find launcher: $launcherPath"
}

Write-WatchdogLog 'runner and supervisor are absent; starting the hidden supervisor.'
Start-Process -FilePath 'wscript.exe' -ArgumentList ('"{0}"' -f $launcherPath) -WindowStyle Hidden
