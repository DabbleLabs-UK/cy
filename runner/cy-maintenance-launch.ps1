param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('Supervisor', 'Watchdog')]
    [string]$Mode,
    [Parameter(Mandatory = $true)]
    [string]$Directory
)

# Operational opt-in wrapper. Existing launchers and runtime defaults are unchanged.
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $Directory -PathType Container)) {
    throw 'The private maintenance directory must already exist.'
}
$env:CY_MAINTENANCE_DIR = (Resolve-Path -LiteralPath $Directory).Path
if ($Mode -eq 'Watchdog') {
    & (Join-Path $PSScriptRoot 'cy-watchdog.ps1')
} else {
    & $env:ComSpec /d /c ('"{0}"' -f (Join-Path $PSScriptRoot 'cy-supervisor.bat'))
}
exit $LASTEXITCODE
