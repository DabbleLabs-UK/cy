# cy-watchdog-lib.test.ps1 - pure logic tests for the watchdog's freshness
# decision (Test-CyHeartbeatFresh). No live processes, no file writes: every
# scenario is built from synthetic timestamps, matching the plain-assertion
# style already used by runner/*.test.js (throws on failure, prints a
# summary on success).
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File runner/cy-watchdog-lib.test.ps1

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'cy-watchdog-lib.ps1')

$n = 0
function Assert-True([bool]$Condition, [string]$Message) {
    if (-not $Condition) { throw "FAILED: $Message" }
    $script:n++
    Write-Output "  ok - $Message"
}

$now = Get-Date '2026-09-18 22:00:00'

# 1. A runner that just started (5s old) whose only visible heartbeat file is
#    a stale leftover from the PREVIOUS, already-dead process (written 500s
#    ago, well past the 90s threshold) must NOT be judged stale - it has not
#    had a fair chance to write its own heartbeat yet. This is the exact
#    false-positive that produced the repeated kill-restart loop.
$freshProcessStart = $now.AddSeconds(-5)
$oldInheritedHeartbeat = $now.AddSeconds(-500)
Assert-True (Test-CyHeartbeatFresh -Now $now -HeartbeatMtime $oldInheritedHeartbeat `
    -ProcessStart $freshProcessStart -MaxAgeSeconds 90) `
    'a freshly started runner is NOT stale merely because it inherited an old power.json'

# 2. A runner just started (5s old) that has ALREADY written its own fresh
#    heartbeat (e.g. an unusually fast first save) is fresh via the normal path.
$freshHeartbeat = $now.AddSeconds(-2)
Assert-True (Test-CyHeartbeatFresh -Now $now -HeartbeatMtime $freshHeartbeat `
    -ProcessStart $freshProcessStart -MaxAgeSeconds 90) `
    'a freshly started runner with its own fresh heartbeat is fresh'

# 3. A runner that has been running for a long time (established) and has a
#    recent heartbeat (within threshold) is fresh - ordinary healthy steady
#    state, including a slow-but-progressing foreground generation (the
#    heartbeat timer is independent of inference - see power.js).
$establishedProcessStart = $now.AddSeconds(-3600)
$recentHeartbeat = $now.AddSeconds(-20)
Assert-True (Test-CyHeartbeatFresh -Now $now -HeartbeatMtime $recentHeartbeat `
    -ProcessStart $establishedProcessStart -MaxAgeSeconds 90) `
    'an established runner with a recent heartbeat is fresh, even mid slow generation'

# 4. A runner that has been running for a long time and has NOT written a
#    heartbeat in far longer than the threshold (its own heartbeat, not an
#    inherited one - the mtime is AFTER process start) is genuinely stale.
#    This is the real hang case the watchdog exists to catch, and must still
#    fire correctly after the startup-grace fix.
$staleOwnHeartbeat = $now.AddSeconds(-400)
Assert-True (-not (Test-CyHeartbeatFresh -Now $now -HeartbeatMtime $staleOwnHeartbeat `
    -ProcessStart $establishedProcessStart -MaxAgeSeconds 90)) `
    'an established runner whose OWN heartbeat has genuinely gone stale is still caught'

# 5. A runner running longer than the threshold that has NEVER written its
#    own heartbeat at all (mtime still predates process start) is also
#    genuinely stale - the grace period must expire, not last forever.
$longRunningNoOwnHeartbeat = $now.AddSeconds(-200)
Assert-True (-not (Test-CyHeartbeatFresh -Now $now -HeartbeatMtime $oldInheritedHeartbeat `
    -ProcessStart $longRunningNoOwnHeartbeat -MaxAgeSeconds 90)) `
    'a runner older than the threshold that has still never written its own heartbeat is stale (grace expires)'

# 6. No process information available at all (ProcessStart null) falls back
#    to the plain heartbeat-age check, exactly as before this change.
Assert-True (-not (Test-CyHeartbeatFresh -Now $now -HeartbeatMtime $oldInheritedHeartbeat `
    -ProcessStart $null -MaxAgeSeconds 90)) `
    'with no process information, a stale file is judged stale (unchanged fallback behaviour)'
Assert-True (Test-CyHeartbeatFresh -Now $now -HeartbeatMtime $freshHeartbeat `
    -ProcessStart $null -MaxAgeSeconds 90) `
    'with no process information, a fresh file is judged fresh (unchanged fallback behaviour)'

Write-Output ''
Write-Output "cy-watchdog-lib.test.ps1: all $n checks passed"
