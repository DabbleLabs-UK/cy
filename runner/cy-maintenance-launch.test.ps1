$ErrorActionPreference = 'Stop'
$checks = 0
function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw "FAILED: $Message" }
    $script:checks++
    Write-Output "  ok - $Message"
}

# Execute only a copied wrapper with harmless disposable launch targets.
# No live supervisor, watchdog, configuration or process is touched.
$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ('cy maintenance launch test ' + [Guid]::NewGuid().ToString('N'))
$fixtureRoot = [IO.Path]::GetFullPath($fixtureRoot)
$directory = Join-Path $fixtureRoot 'private maintenance'
$wrapper = Join-Path $fixtureRoot 'cy-maintenance-launch.ps1'
$originalMaintenance = $env:CY_MAINTENANCE_DIR
try {
    New-Item -ItemType Directory -Path $directory -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'cy-maintenance-launch.ps1') -Destination $wrapper
    Set-Content -LiteralPath (Join-Path $fixtureRoot 'cy-supervisor.bat') -Encoding ASCII -Value @'
@echo off
echo TARGET=cy-supervisor.bat
echo DIRECTORY=%CY_MAINTENANCE_DIR%
exit /b 37
'@
    Set-Content -LiteralPath (Join-Path $fixtureRoot 'cy-watchdog.ps1') -Encoding ASCII -Value @'
Write-Output 'TARGET=cy-watchdog.ps1'
Write-Output ('DIRECTORY=' + $env:CY_MAINTENANCE_DIR)
exit 23
'@
    $env:CY_MAINTENANCE_DIR = 'wrong-inherited-directory'
    foreach ($mode in @('Supervisor', 'Watchdog')) {
        $output = @(& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $wrapper -Mode $mode -Directory $directory)
        $code = $LASTEXITCODE
        $target = if ($mode -eq 'Supervisor') { 'cy-supervisor.bat' } else { 'cy-watchdog.ps1' }
        $expectedCode = if ($mode -eq 'Supervisor') { 37 } else { 23 }
        Assert-True ($output -contains "TARGET=$target") "$mode invokes the original launch target name"
        Assert-True ($output -contains "DIRECTORY=$directory") "$mode propagates the explicit resolved directory, including spaces"
        Assert-True ($code -eq $expectedCode) "$mode preserves the target exit code"
    }
    Assert-True ($env:CY_MAINTENANCE_DIR -eq 'wrong-inherited-directory') 'wrapper process does not mutate the caller environment'
    # Capture the expected native stderr without turning it into a test-host exception.
    $ErrorActionPreference = 'Continue'
    $failed = @(& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $wrapper -Mode Supervisor -Directory (Join-Path $fixtureRoot 'missing') 2>&1)
    $failedCode = $LASTEXITCODE
    $ErrorActionPreference = 'Stop'
    Assert-True ($failedCode -ne 0) 'missing private directory fails closed'
    Assert-True (($failed -join "`n") -match 'private maintenance directory must already exist') 'missing directory fails for the intended validation reason'
    Assert-True (-not ($failed -match '^TARGET=')) 'missing directory never invokes a launch target'
    Assert-True (-not (Test-Path -LiteralPath (Join-Path $fixtureRoot 'missing'))) 'wrapper does not create a missing maintenance directory'
    Write-Output "cy-maintenance-launch.test.ps1: all $checks checks passed"
} finally {
    $env:CY_MAINTENANCE_DIR = $originalMaintenance
    # This is exclusively the GUID-named fixture created above, not a live path.
    $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
    if (-not $fixtureRoot.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Refusing fixture cleanup outside the temporary directory.'
    }
    if (Test-Path -LiteralPath $fixtureRoot) { Remove-Item -LiteralPath $fixtureRoot -Recurse -Force }
}
