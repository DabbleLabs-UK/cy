$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
. "$PSScriptRoot/endpoint-ownership.ps1"
$before = Get-CyEndpointSnapshot
$processes = $before.Processes
$runners = @($processes | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'runner[\\/]run\.js' })
if ($runners.Count -ne 1) { throw "Expected one CY runner, found $($runners.Count)" }
$ollama = Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/version' -TimeoutSec 10
if ($ollama.version -cne '0.34.1') { throw 'Unexpected Ollama version' }
$arbiter = Invoke-RestMethod -Uri 'http://127.0.0.1:11435/health' -TimeoutSec 10
if ($arbiter.ok -ne $true) { throw 'Arbiter is not healthy' }
$http = @()
foreach ($url in @('https://cy.dabblelabs.uk/','https://feddit.dabblelabs.uk/')) {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 20
    if ($response.StatusCode -ne 200) { throw "Unexpected HTTP status for $url" }
    $http += @{url=$url;status=$response.StatusCode}
}
# Corroborate ownership across the HTTP checks, including creation identity
# so replacement/PID reuse cannot turn separate observations into one receipt.
$after = Get-CyEndpointSnapshot
Assert-CyStableEndpointOwners -Before $before.Listeners -After $after.Listeners
$runnersAfter = @($after.Processes | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'runner[\\/]run\.js' })
if ($runnersAfter.Count -ne 1 -or $runnersAfter[0].ProcessId -ne $runners[0].ProcessId -or
    $runnersAfter[0].CreationDate -ne $runners[0].CreationDate) { throw 'CY runner changed during health check' }
$workers = @($processes | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'arbiter|dell-worker|worker\.mjs' } | Select-Object ProcessId,Name,CreationDate)
$spools = @(Get-Item -LiteralPath 'C:\dev\cy\runner\state\queue.jsonl','C:\dev\cy\runner\state\memory-sources.jsonl' | Select-Object Name,Length,LastWriteTimeUtc)
[pscustomobject]@{
    observedAtUtc=[DateTime]::UtcNow.ToString('o')
    runners=@($runners | Select-Object ProcessId,Name,CreationDate)
    workers=$workers
    listeners=$after.Listeners
    spools=$spools
    restartRequestPresent=(Test-Path -LiteralPath 'C:\dev\cy\runner\state\restart-request.json')
    http=$http
    ollama=$ollama
    arbiter=$arbiter
} | ConvertTo-Json -Depth 8 -Compress
