$ErrorActionPreference = 'Stop'
$checks = 0
function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw "FAILED: $Message" }
    $script:checks++
    Write-Output "  ok - $Message"
}

# Run the actual watchdog only in a disposable tree with mocked process/time
# providers. Both destructive commands throw; no real process is queried/stopped.
$fixtureRoot = [IO.Path]::GetFullPath((Join-Path ([IO.Path]::GetTempPath()) ('cy watchdog fixture ' + [Guid]::NewGuid().ToString('N'))))
try {
    New-Item -ItemType Directory -Path (Join-Path $fixtureRoot 'state') -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'cy-watchdog-lib.ps1') -Destination $fixtureRoot
    $source = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'cy-watchdog.ps1') -Raw
    $wrapper = Join-Path $fixtureRoot 'fixture.ps1'
    Set-Content -LiteralPath $wrapper -Encoding ASCII -Value @'
$ErrorActionPreference = 'Stop'
$global:enumerations = 0
$global:epoch = [datetime]'2026-10-09T12:00:00Z'
function global:Get-Date {
    param([string]$Format)
    $value = $global:epoch.AddSeconds($(if ($global:enumerations -eq 0) { 0 } else { 10 }))
    if ($Format) { return $value.ToString($Format) }
    return $value
}
function global:Get-CimInstance {
    param($ClassName)
    $global:enumerations++
    [pscustomobject]@{ Name='node.exe'; CommandLine='node runner/run.js'; ProcessId=123; CreationDate=$global:epoch.AddHours(-1) }
}
function global:Stop-Process { throw 'NORMAL_RECOVERY_PATH' }
function global:Start-Process { throw 'UNEXPECTED_LAUNCH_PATH' }
$env:CY_MAINTENANCE_DIR = $PSScriptRoot
try { & (Join-Path $PSScriptRoot 'cy-watchdog.ps1') }
catch { Write-Output $_.Exception.Message; exit 31 }
'@
    Set-Content -LiteralPath (Join-Path $fixtureRoot 'request.json') -Encoding ASCII -Value '{"version":1,"id":"fixture"}'
    foreach ($case in @(
        @{ name='current'; offset=9; legacy=$false; accepted=$true },
        @{ name='old-clock-negative-control'; offset=9; legacy=$true; accepted=$false },
        @{ name='stale'; offset=4; legacy=$false; accepted=$false },
        @{ name='future'; offset=11; legacy=$false; accepted=$false }
    )) {
        $testSource = if ($case.legacy) { $source.Replace('-Now (Get-Date)', '-Now $now') } else { $source }
        Set-Content -LiteralPath (Join-Path $fixtureRoot 'cy-watchdog.ps1') -Encoding UTF8 -Value $testSource
        $status = @{ version=1; requestId='fixture'; pid=123; state='held'; active=0; updatedAt=([datetime]'2026-10-09T12:00:00Z').AddSeconds($case.offset).ToUniversalTime().ToString('o') }
        Set-Content -LiteralPath (Join-Path $fixtureRoot 'cy-status.json') -Encoding ASCII -Value ($status | ConvertTo-Json -Compress)
        $output = @(& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $wrapper)
        $code = $LASTEXITCODE
        if ($case.accepted) {
            Assert-True ($code -eq 0) 'status refreshed during enumeration permits a held acknowledgement'
            Assert-True (($output -join "`n") -match 'fresh maintenance hold acknowledged') 'real watchdog takes maintenance path with validation-time clock'
        } else {
            Assert-True ($code -eq 31) ($case.name + ' is rejected by maintenance validation')
            Assert-True ($output -contains 'NORMAL_RECOVERY_PATH') ($case.name + ' retains normal recovery instead of accepting hold')
        }
    }
    Write-Output "cy-watchdog-maintenance.test.ps1: all $checks checks passed"
} finally {
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if (-not $fixtureRoot.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe fixture cleanup path.' }
    if (Test-Path -LiteralPath $fixtureRoot) { Remove-Item -LiteralPath $fixtureRoot -Recurse -Force }
}
