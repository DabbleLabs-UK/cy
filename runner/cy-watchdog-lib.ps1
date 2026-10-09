# cy-watchdog-lib.ps1 - pure, dependency-free logic shared by cy-watchdog.ps1
# and its test. No process queries, no file I/O, no side effects: every
# input is passed in explicitly so this can be exercised with synthetic
# values, the same way run.js exports readNdjsonStream/generationHitTokenLimit
# for its own test to call directly.

function Test-CyMaintenanceHeld {
    param($Request, $Status, [int]$RunnerPid, [datetime]$Now)
    try {
        $age = ($Now.ToUniversalTime() - ([datetime]$Status.updatedAt).ToUniversalTime()).TotalSeconds
        return $Request.version -eq 1 -and $Status.version -eq 1 `
            -and [string]$Request.id -match '^[A-Za-z0-9_.-]{1,128}$' `
            -and $Status.requestId -ceq $Request.id -and $Status.pid -eq $RunnerPid `
            -and $Status.state -ceq 'held' -and $Status.active -eq 0 `
            -and $age -ge 0 -and $age -le 5
    } catch { return $false }
}

# A freshly restarted runner inherits whatever power.json the PREVIOUS
# (already-dead) process last wrote, which can be arbitrarily old. Judging
# that file's raw age would call a brand-new, healthy process "stale" before
# it has ever had a chance to write its own first heartbeat (power.json saves
# roughly every 30s - see power.js), producing exactly the false-positive
# restart loop the watchdog exists to prevent, not cause. So: if the
# heartbeat file predates the current runner process's own start, freshness
# is judged by how long THIS process has been alive instead of the stale
# file's age - the startup grace falls naturally out of the same
# MaxAgeSeconds threshold rather than a second magic number. Once a process
# has run longer than that threshold with still no heartbeat of its own, it
# is judged exactly as before: genuinely stale.
function Test-CyHeartbeatFresh {
    param(
        [Parameter(Mandatory)] [datetime]$Now,
        [Parameter(Mandatory)] [datetime]$HeartbeatMtime,
        [Nullable[datetime]]$ProcessStart,
        [Parameter(Mandatory)] [int]$MaxAgeSeconds
    )
    $effectiveAge = if ($ProcessStart -and $HeartbeatMtime -lt $ProcessStart) {
        ($Now - $ProcessStart).TotalSeconds
    } else {
        ($Now - $HeartbeatMtime).TotalSeconds
    }
    return $effectiveAge -le $MaxAgeSeconds
}

# Decides what to do with a manual restart-request marker file (see
# cy-restart-request.sh), keyed on epoch milliseconds rather than parsed
# datetime strings so a plain-JSON request written from bash (or anywhere
# else) never depends on culture/format-specific date parsing.
#
#   'NONE'  - no request is pending; caller proceeds exactly as before.
#   'ACT'   - a fresh request exists; caller should stop the owned runner
#             process and let the existing supervisor restart it, then clear
#             the request file.
#   'STALE' - a request file exists but is too old (or has a nonsensical
#             future timestamp) to act on - e.g. it survived a reboot with no
#             watchdog tick in between. The caller clears it WITHOUT
#             restarting anything, so a leftover file can never cause a
#             restart loop.
function Get-CyRestartRequestDisposition {
    param(
        [Parameter(Mandatory)] [double]$NowMs,
        [Nullable[double]]$RequestedAtMs,
        [Parameter(Mandatory)] [int]$MaxAgeSeconds
    )
    if ($null -eq $RequestedAtMs) { return 'NONE' }
    $ageSeconds = ($NowMs - $RequestedAtMs) / 1000
    if ($ageSeconds -lt 0) { return 'STALE' }
    if ($ageSeconds -gt $MaxAgeSeconds) { return 'STALE' }
    return 'ACT'
}
