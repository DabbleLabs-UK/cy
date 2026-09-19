# cy-watchdog-lib.ps1 - pure, dependency-free logic shared by cy-watchdog.ps1
# and its test. No process queries, no file I/O, no side effects: every
# input is passed in explicitly so this can be exercised with synthetic
# values, the same way run.js exports readNdjsonStream/generationHitTokenLimit
# for its own test to call directly.

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
