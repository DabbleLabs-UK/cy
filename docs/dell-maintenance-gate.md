# DELL maintenance admission gate

Default-off operational control, not an owner pause or a model setting. Set
`CY_MAINTENANCE_DIR` to the same existing private local directory in the runner
supervisor AND watchdog environments. Neither configuration nor directory is
created automatically. It must not be a public web directory.

Atomically write `request.json` containing `{"version":1,"id":"unique-window-id"}`.
The runner stops admitting generation iterations, inbox claims and background
memory jobs. Already admitted work runs normally, including its existing timeout,
follow-on inference, result handling and source writes. Already claimed inbox
items drain before acknowledgement. This never invokes pause, abort or retry.

Read `cy-status.json`: version, pid, requestId, state, active, updatedAt. Require
the actual live PID, exact request ID, `held`, zero active work and repeatedly
fresh timestamps before using exclusive inference resources. Also verify the
shared inference arbiter is empty and every other client is held. An error,
stale status or slow drain is not permission to force termination.

Malformed/unreadable requests, missing directories and status write failures
block new admission. They do not cancel admitted work. There is no timeout or
automatic resume: remove only `request.json` to restore normal admission.

While held, the generation loop and memory claims do not run. Independent
world ticks are held, with ordinary power telemetry retained as a heartbeat.
No maintenance event is injected into Cy's social or memory streams. Existing
network delivery and owner control handling remain operational. A restarted
runner acknowledges the request before loading state; the watchdog accepts only
a fresh matching zero-work `held` acknowledgement from its actual runner PID.

## Bootstrap limitation

This implementation cannot retrofit itself into an already-running old Node
process. Install the files/configuration only at a separately proven safe
boundary, or stage them for a naturally occurring supervisor restart. The old
operator pause, restart-request, SIGTERM and process kill are not safe drain
mechanisms. Do not use them to claim this gate was safely installed. No existing
live model process or live data is modified by the mocked regression tests.
