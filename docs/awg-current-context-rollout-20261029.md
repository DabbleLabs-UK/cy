# AWG stale-context rollout

Approved candidate: `6f64ec882cf672a8b316050127ead45516e54263`.
Production no-ff merge: `14315366ad7d21cc569889cfd834c4c91cfc48c1`.
First parent: `8952baf86dc47e86c7536c84b5f390c762086884`.
Second parent: the exact approved candidate.
Merged/candidate tree: `ecb50e67a233f8a04d0eead72e7bd20e6238157b`.

Remote candidate and production were verified before merge and publication.
The isolated integration worktree preserved all other checkouts, including the
older locally checked-out production branch. The complete merge tree is identical
to the tested candidate. No runtime semantics changed for rollout.

## Fresh validation

| Gate | Result |
| --- | --- |
| AWG boundary plus two isolated MariaDB/API groups | 29/29, 128.726 seconds |
| Focused | 162/162, 44.136 seconds |
| Full serial runner, 152 files | 1,071/1,071, 536.056 seconds |
| PHP world simulation/location/environment/registry | 4/4 scripts |
| JS/MJS syntax | 6 files, clean |
| Config/model-spec/manifest JSON | 17 files, clean |
| Whitespace | clean |

No failures or skips were excused. Disposable localhost MariaDB PID 69432 and
port 62584 were independently verified absent after cleanup. The harness removed
all fixture schemas, its two owned GUID directories and its nonsecret defaults
file. No test accessed production or called a real provider.

Fresh log SHA-256 values (private task outputs):

- Focused: `66c97f9fe72ebc266a5bb877a9b6de8a27f817fa23033987455cdbb8a862f391`.
- Full: `eaaf996d7adaa4911e6575d3313160e36ad7f12710dd3643c9b9a9af13ffe646`.
- Integration: `f7bcd1aff2b17a45e9667f894a6c3283ab4215560064b53ab8e9fd52e8b2d5c5`.
- PHP: `7e5edd2c78d7dbea9d8e1700ef32783d48ea4f6780b6cb7227990cbeb707fc33`.

These fresh results supersede the explicitly historical incomplete integration
gate recorded in the candidate's 28 October implementation report. They do not
retroactively claim that the earlier blocked run succeeded.

## Independent source/package reviews and scope

Independent reviews found no material issue in source, the operator/rollback
plan, or the exact generated package. Final live authority is checked immediately
before synchronous world/search/canonical/Soma/history mutation, without an
avoidable asynchronous yield. Stale results retain truthful attempt accounting
but create no world event, prose, grounded/social consequence, memory source or
replacement inference. Movement remains independent.

The call-local delivery buffer is not a new durable outbox. No new crash-replay
or exactly-once convergence guarantee is claimed; that acknowledged limitation
was deliberately not expanded into another project.

Package: `deploy-awg-context-1431536`, exactly six members.
Manifest SHA-256:
`4ee45e376c275bbc57455e17e3e8ea914706f51f41c0254c26ad6c861cb9c8c5`.
Archive SHA-256:
`378e63d2b2e4dc2d799fd82c7bbee50e6541d7bae703f924a30e90b68e9e86ea`.

Both payloads equal exact merged Git blobs. The tested checkout's CRLF bytes
normalize to those canonical LF bytes; there is no semantic package difference.
All unchanged dependency/API/metadata hashes match base and merge. No PHP/API,
public UI, configuration, migration or matching metadata content needed updating.
No FPM operation was performed.

## Installation, backup and rollback

Only these DELL runtime files were installed, helper before importer:

| File | Deployed SHA-256 |
| --- | --- |
| `runner/location-regime.js` | `efe7a099d0e7dd4c11a08afcce8cfecc891897aa161e3db7976f8c0ea880f635` |
| `runner/run.js` | `aaf7f4eed73a5cc8cba1994252fdd33a58a569901b14cc5a4063e3bf57bbb82d` |

All staged members were verified on DELL before execution. Pre-install source,
syntax, dependencies and exact old-byte checks passed. The old location helper's
CRLF hash `19d75353268424009131d8b6fda5d6ddcd50fe5a85c4217c16fc96e26ebbb18b`
normalizes to the expected base hash; it was not unexplained drift.

The verified private backup is
`C:/dev/cy/runner/state/deploy-backup-awg-context-1431536`: 989 files, complete
current/previous checkpoint graphs, supporting state/spools and exact replaced
runtime bytes. At 10:51:41.947Z, mirror comparison was 0 adoption/0 publication,
12 objects/9 threads, and both spools were empty. The explicit zero/zero gate
passed before installation. Runtime installation/readback finished at
**2026-10-29T10:52:15.334Z**.

Rollback, if needed, restores only the two verified old runtime files and uses
one guarded restart. It must never restore checkpoints, queues or database/history
over later natural work. No rollback has been needed.

## Guarded restart and initial health

Exactly one normal `cy-restart` request was issued. The watchdog acted at
10:53:03.160Z, stopped only old runner 16900 at 10:53:03.191Z, and acknowledged
the marker at 10:53:03.234Z. The existing supervisor started runner 9608 at
10:53:18.149Z. A probe at 10:53:12 observed the expected zero-runner interval
inside the supervisor's normal 15-second delay, not a failed replacement. The
completed-restart probe ran the same health script as one encoded PowerShell
script and passed. No extra restart, manual runner launch or direct kill occurred.

Startup replayed zero satiety intake records, recovered existing structured sleep
history, and reported Ollama/DeepSeek ready. At 10:54:11.676Z exactly one runner
9608 existed. Worker/arbiter 13868 and Ollama listener 14268 were unchanged;
11434/11435 listeners were healthy, 11535 absent, restart marker cleared, CY and
Feddit HTTP 200. The arbiter retained context 3072/four threads.

At 10:54:15.677Z both checkpoint graphs/hashes were valid, with new generation
`1793271204919-9608-0` and previous generation `1793270969278-16900-191`.
Mirror remained 0/0 and spools empty. All 21 meal phases/hash and the previous
resolved yard greeting's decision/projection/delivery identities were unchanged.

At **2026-10-29T10:54:34.039Z**, SELECT-only observation showed stream head
3124988 (preflight 3124582), live vitals advancing, valid persistence, save count
1, failed saves 0 and no fallback recovery. Recent AWG/world identities showed
no restart-manufactured event or replay. Latest AWG run remained the pre-existing
09:29:48.673Z run; no post-cutoff natural AWG result was yet observed.

Natural-evidence cutoff:

**29 October 2026, 10:54:34.039 GMT/UTC**
(`2026-10-29T10:54:34.039Z`).

## Final verification

The normal write-behind window was allowed to elapse without a forced save.
Generation `1793271812885-9608-1` was created at **11:03:32.885Z** and saved at
**11:03:34.403Z**. SELECT-only verification at **11:04:00.452Z** reported save
count 2, failed saves 0, valid persistence and no fallback recovery. Stream head
advanced to 3125239 and live vitals to 11:03:53.428Z.

Full checkpoint/hash postflight at **11:04:02.127Z** verified both generations,
the two exact deployed hashes, unchanged dependencies, mirror 0/0 and empty
spools. Meal state/hash and the prior resolved yard decision/projection/delivery
identities remained unchanged. Final health at **11:04:05.774Z** retained exactly
one runner 9608, unchanged provider/arbiter processes, healthy listeners/arbiter,
cleared restart marker and CY/Feddit HTTP 200. No unexpected recovery, duplicate
world outcome or action replay was observed.

Independent deployed-state review freshly verified active DELL/package/merge
hash correspondence, unchanged runner dependencies, all seven server/API/metadata
hashes, installation/restart receipts and initial state integrity. Its remaining
ordinary-checkpoint gate is satisfied by the final receipts above.

One ordinary `overheard` event occurred naturally at 10:56:57.862Z. Existing live
updates and ordinary inference continued; no post-cutoff AWG result was observed
through final verification. Absence of a natural stale-result race is not a
failed rollout or behavioral proof of that race. Deterministic regression
evidence establishes the boundary; future natural activity is left alone.

No checkpoint, AWG interaction, movement, search, journal, memory/yard activity,
synthetic event or provider inference was forced. Historical data was not
rewritten. Rollback was not needed. No further AWG audit or crash-replay project
was started.

**AWG STALE-CONTEXT REPAIR: DEPLOYED**.
