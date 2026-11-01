$ErrorActionPreference = 'Stop'
. "$PSScriptRoot/../endpoint-ownership.ps1"
$script:passed = 0
function Check($name, [scriptblock]$body) {
    try { & $body; $script:passed++; Write-Host "PASS $name" }
    catch { throw "FAIL ${name}: $_" }
}
function Must-Fail([scriptblock]$body) {
    $failed = $false
    try { $null = & $body } catch { $failed = $true }
    if (-not $failed) { throw 'Expected closed gate' }
}
function Fixture {
    $policy = @(Get-CyEndpointPolicy)
    $cim = @(); $native = @(); $processes = @(); $hashes = @{}
    for ($i = 0; $i -lt 2; $i++) {
        $e = $policy[$i]; $owner = 100 + $i
        $cim += [pscustomobject]@{
            LocalAddress = $e.Address; LocalPort = $e.Port
            RemoteAddress = '0.0.0.0'; RemotePort = 0
            OwningProcess = $owner; RawState = 2; State = 'Listen'
        }
        $native += [pscustomobject]@{
            Family = 2; LocalAddress = $e.Address; LocalPort = $e.Port
            OwningProcess = $owner; RawState = 2
        }
        $processes += [pscustomobject]@{
            ProcessId = $owner; Name = $e.Name; ExecutablePath = $e.ExecutablePath
            CommandLine = $e.CommandLine; CreationDate = '2026-11-01T08:34:55Z'
        }
        if ($e.Sha256) { $hashes[$e.ExecutablePath] = $e.Sha256 }
    }
    @{ CimRows = $cim; NativeListeners = $native; Processes = $processes; ExecutableHashes = $hashes }
}
Check 'historical LISTEN representation passes with both owners' {
    $f = Fixture; $r = @(Assert-CyEndpointOwnership @f)
    if ($r.Count -ne 2 -or $r[0].OwningProcess -ne 100 -or $r[1].OwningProcess -ne 101) { throw 'Bad receipts' }
}
Check 'old filtered gate fails raw zero; corrected gate verifies listener membership and ownership' {
    $f = Fixture
    foreach ($row in $f.CimRows) { $row.RawState = 0; $row.State = $null }
    $f.NativeListeners[0].RawState = 1 # Actual listener-only diagnostic, not a state inference.
    $f.NativeListeners[1].RawState = 0
    if (@($f.CimRows | Where-Object State -eq 'Listen').Count -ne 0) { throw 'Old control did not reproduce' }
    if (@(Assert-CyEndpointOwnership @f).Count -ne 2) { throw 'Rejected corroborated owners' }
}
foreach ($index in @(0, 1)) {
    $service = @('ollama', 'arbiter')[$index]
    Check "$service missing native listener fails despite correct CIM/process" {
        $f = Fixture; $f.NativeListeners = @($f.NativeListeners | Where-Object LocalPort -ne (11434 + $index))
        Must-Fail { Assert-CyEndpointOwnership @f }
    }
    Check "$service missing CIM endpoint fails despite native/process" {
        $f = Fixture; $f.CimRows = @($f.CimRows | Where-Object LocalPort -ne (11434 + $index))
        Must-Fail { Assert-CyEndpointOwnership @f }
    }
    Check "$service wrong native owner fails" {
        $f = Fixture; $f.NativeListeners[$index].OwningProcess = 999
        Must-Fail { Assert-CyEndpointOwnership @f }
    }
    Check "$service wrong matching owner identity fails" {
        $f = Fixture; $f.Processes[$index].ExecutablePath = 'C:\unreviewed\server.exe'
        Must-Fail { Assert-CyEndpointOwnership @f }
    }
    Check "$service wrong command fails" {
        $f = Fixture; $f.Processes[$index].CommandLine += ' --unreviewed'
        Must-Fail { Assert-CyEndpointOwnership @f }
    }
    Check "$service missing process fails" {
        $f = Fixture; $f.Processes = @($f.Processes | Where-Object ProcessId -ne (100 + $index))
        Must-Fail { Assert-CyEndpointOwnership @f }
    }
    Check "$service duplicate native listener same owner fails" {
        $f = Fixture; $f.NativeListeners += $f.NativeListeners[$index]
        Must-Fail { Assert-CyEndpointOwnership @f }
    }
    Check "$service duplicate genuine owner/listener fails" {
        $f = Fixture
        $extra = $f.NativeListeners[$index].PSObject.Copy(); $extra.OwningProcess = 999
        $f.NativeListeners += $extra
        $process = $f.Processes[$index].PSObject.Copy(); $process.ProcessId = 999
        $f.Processes += $process
        Must-Fail { Assert-CyEndpointOwnership @f }
    }
    Check "$service second genuine server on a different port fails" {
        $f = Fixture; $p = $f.Processes[$index].PSObject.Copy(); $p.ProcessId = 999
        $f.Processes += $p
        Must-Fail { Assert-CyEndpointOwnership @f }
    }
    Check "$service arbitrary raw zero without native listener fails" {
        $f = Fixture; $f.CimRows[$index].RawState = 0; $f.CimRows[$index].State = $null
        $f.NativeListeners = @($f.NativeListeners | Where-Object LocalPort -ne (11434 + $index))
        Must-Fail { Assert-CyEndpointOwnership @f }
    }
    Check "$service accepted connections on same port do not count as listeners" {
        $f = Fixture; $connection = $f.CimRows[$index].PSObject.Copy()
        $connection.RemoteAddress = '127.0.0.1'; $connection.RemotePort = 50432
        $connection.RawState = 5; $connection.State = 'Established'; $connection.OwningProcess = 999
        $f.CimRows += $connection
        if (@(Assert-CyEndpointOwnership @f).Count -ne 2) { throw 'Connection miscounted' }
        $f.CimRows = @($f.CimRows | Where-Object { $_.LocalPort -ne (11434 + $index) -or $_.RemotePort -ne 0 })
        Must-Fail { Assert-CyEndpointOwnership @f }
    }
    Check "$service duplicate CIM endpoint fails" {
        $f = Fixture; $f.CimRows += $f.CimRows[$index]
        Must-Fail { Assert-CyEndpointOwnership @f }
    }
    Check "$service wildcard cannot pass" {
        $f = Fixture; $f.CimRows[$index].LocalAddress = '0.0.0.0'; $f.NativeListeners[$index].LocalAddress = '0.0.0.0'
        Must-Fail { Assert-CyEndpointOwnership @f }
    }
    Check "$service IPv6 cannot replace expected IPv4 endpoint" {
        $f = Fixture; $f.CimRows[$index].LocalAddress = '::1'
        $f.NativeListeners[$index].LocalAddress = '::1'; $f.NativeListeners[$index].Family = 23
        Must-Fail { Assert-CyEndpointOwnership @f }
    }
    Check "$service missing or unknown CIM state cannot default to zero" {
        $f = Fixture; $f.CimRows[$index].RawState = $null
        Must-Fail { Assert-CyEndpointOwnership @f }
        $f.CimRows[$index].RawState = 999
        Must-Fail { Assert-CyEndpointOwnership @f }
    }
    Check "$service changed PID across HTTP checks fails" {
        $f = Fixture; $left = @(Assert-CyEndpointOwnership @f)
        $right = @(Assert-CyEndpointOwnership @f); $right[$index].OwningProcess = 999
        Must-Fail { Assert-CyStableEndpointOwners $left $right }
    }
    Check "$service PID reuse across HTTP checks fails" {
        $f = Fixture; $left = @(Assert-CyEndpointOwnership @f)
        $right = @(Assert-CyEndpointOwnership @f); $right[$index].CreationDate = '2026-11-01T12:00:00Z'
        Must-Fail { Assert-CyStableEndpointOwners $left $right }
    }
}
Check 'wrong pinned Ollama executable hash fails' {
    $f = Fixture; $f.ExecutableHashes[(Get-CyEndpointPolicy)[0].ExecutablePath] = 'bad'
    Must-Fail { Assert-CyEndpointOwnership @f }
}
Check 'missing creation identity fails closed' {
    $f = Fixture; $f.Processes[0].CreationDate = $null
    Must-Fail { Assert-CyEndpointOwnership @f }
}
Check 'unexpected isolated port remains blocked with native raw zero' {
    $f = Fixture; $extra = $f.NativeListeners[0].PSObject.Copy(); $extra.LocalPort = 11535; $extra.RawState = 0
    $f.NativeListeners += $extra
    Must-Fail { Assert-CyEndpointOwnership @f }
}
Check 'unexpected isolated port remains blocked by CIM endpoint alone' {
    $f = Fixture; $extra = $f.CimRows[0].PSObject.Copy(); $extra.LocalPort = 11535; $extra.RawState = 0
    $f.CimRows += $extra
    Must-Fail { Assert-CyEndpointOwnership @f }
}
Check 'stable owners pass even when anomalous reported state changes' {
    $f = Fixture; $left = @(Assert-CyEndpointOwnership @f)
    $f.CimRows[0].RawState = 0; $f.NativeListeners[0].RawState = 1
    Assert-CyStableEndpointOwners $left @(Assert-CyEndpointOwnership @f)
}

# Exercise the actual snapshot projection with offline command doubles. No CIM,
# TCP inspection, executable reads, HTTP, spools or service calls occur below.
$script:f = Fixture
function Get-CimInstance { param($ClassName, $ErrorAction) $script:f.Processes }
function Get-NetTCPConnection {
    param($ErrorAction)
    foreach ($r in $script:f.CimRows) {
        $copy = $r.PSObject.Copy()
        $copy | Add-Member NoteProperty CimInstanceProperties @{ State = @{ Value = $r.RawState } }
        $copy
    }
}
function Get-FileHash { param($LiteralPath, $Algorithm, $ErrorAction) @{ Hash = $script:f.ExecutableHashes[$LiteralPath] } }
function Get-CyNativeListenerRows { $script:f.NativeListeners }
Check 'snapshot preserves raw zero while rendered state is null' {
    $script:f = Fixture
    foreach ($r in $script:f.CimRows) { $r.RawState = 0; $r.State = $null }
    $s = Get-CyEndpointSnapshot
    if ($s.Listeners.Count -ne 2 -or $s.Listeners[0].CimRawState -ne 0) { throw 'Projection lost zero' }
}
Check 'snapshot preserves missing state as unknown and fails' {
    $script:f = Fixture; $script:f.CimRows[0].RawState = $null
    Must-Fail { Get-CyEndpointSnapshot }
}
Check 'native collector failure is fatal, not HTTP fallback' {
    function Get-CyNativeListenerRows { throw 'offline native table failure' }
    $script:f = Fixture
    Must-Fail { Get-CyEndpointSnapshot }
}

# Run the unchanged surrounding health gates with deterministic snapshots.
# Dot-source the helper once, then load only the wrapper's executable body;
# this skips only its helper import, keeping the exact deployed wrapper logic.
$healthPath = "$PSScriptRoot/../health.ps1"
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path $healthPath), [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw 'Wrapper syntax error' }
$body = ($ast.EndBlock.Statements | Where-Object {
    $_.Extent.Text -ne '. "$PSScriptRoot/endpoint-ownership.ps1"'
} | ForEach-Object { $_.Extent.Text }) -join "`n"
$script:wrapper = [scriptblock]::Create($body)
$script:httpCalls = @(); $script:badApi = $false; $script:changeOwner = $false; $script:snapshots = 0
function Get-CyEndpointSnapshot {
    $script:snapshots++
    $p = @(Fixture).Processes
    $p += [pscustomobject]@{ Name = 'node.exe'; ProcessId = 900; CommandLine = 'node runner/run.js'; CreationDate = 'fixed' }
    $f = Fixture; $listeners = @(Assert-CyEndpointOwnership @f)
    if ($script:changeOwner -and $script:snapshots -gt 1) { $listeners[0].CreationDate = 'replacement' }
    [pscustomobject]@{ Processes = $p; Listeners = $listeners }
}
function Invoke-RestMethod {
    param($Uri, $TimeoutSec)
    $script:httpCalls += $Uri
    if ($Uri -like '*/api/version') { @{ version = '0.34.1' } }
    else { @{ ok = (-not $script:badApi) } }
}
function Invoke-WebRequest { param([switch]$UseBasicParsing, $Uri, $TimeoutSec) $script:httpCalls += $Uri; @{ StatusCode = 200 } }
function Get-Item { param($LiteralPath) @{ Name = 'offline'; Length = 0 } }
function Test-Path { param($LiteralPath) $false }
Check 'wrapper keeps runner, both health APIs, public HTTP and spool receipt gates' {
    $script:snapshots = 0; $script:httpCalls = @()
    $receipt = (& $script:wrapper) | ConvertFrom-Json
    if ($receipt.runners.Count -ne 1 -or $receipt.listeners.Count -ne 2 -or $script:snapshots -ne 2 -or $script:httpCalls.Count -ne 4) { throw 'Lost wrapper gate' }
    if (@($script:httpCalls | Where-Object { $_ -notin @('http://127.0.0.1:11434/api/version', 'http://127.0.0.1:11435/health', 'https://cy.dabblelabs.uk/', 'https://feddit.dabblelabs.uk/') }).Count) { throw 'Unexpected HTTP/inference' }
}
Check 'HTTP health failure still closes gate despite valid owners' {
    $script:badApi = $true
    Must-Fail { & $script:wrapper }
    $script:badApi = $false
}
Check 'owner replacement during HTTP checks closes gate' {
    $script:snapshots = 0; $script:changeOwner = $true
    Must-Fail { & $script:wrapper }
    $script:changeOwner = $false
}
Write-Host "TOTAL $script:passed offline checks passed"
