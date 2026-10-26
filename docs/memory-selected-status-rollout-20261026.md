# Selected-memory authoritative status rollout

## Approved source and review

Candidate: `bf545550df4712e3e28886f627d2d2168b903cb6`,
`fix/memory-selected-status-20261026`.

Production no-ff merge: `aca4c404cf95f4597234a72ce96365c4adb7b50e`.
Parents are deployed `a8d4d0ea0cbbb35f399536bed8f1fb2cfbe3ad51` and the
exact candidate. Tree `9c88d6e3138c1c12d00717ec9d23c2f28fd3ccbc` is identical
to the tested candidate. A normal non-forced push advanced remote
`current/production-lineage`; the unrelated local production worktree at
`a08107b` and all other worktrees were preserved.

Independent source review found no material issue. The sole runtime behavior
change is `status: memory.status` in `filterMemoriesBeforePrompt`, after the
unchanged exact ACTIVE/privacy filter. No default or constant is added.
Activation still requires exact ACTIVE. All other selected fields, IDs,
provenance, privacy/eligibility/world-truth handling, prompts, ranking, cadence,
limits, nonblocking behavior, formation and relevance policy remain unchanged.
Queue-liveness/supersession and desired-fingerprint fencing are byte-unchanged.

## Revalidation

| Gate | Result |
| --- | --- |
| Focused memory/status/liveness/runtime | 73/73, 7.964 seconds |
| Full serial runner suite | 891/891, 136.101 seconds; no skipped tests |
| Full identical merge serial runner suite | 891/891, 116.378 seconds; no skipped tests |
| Identical merged-tree status/liveness regressions | 36/36, 7.053 seconds |
| PHP journal-liveness authority | 15 checks passed |
| Existing PHP memory scripts | All eight passed |
| Isolated real PHP/MariaDB API integration | 4/4, 99.575 seconds |
| Syntax, tracked JSON and whitespace | Passed; 100 JSON files |

Integration used synthetic fixtures in an owned disposable local MariaDB
instance, which was confirmed stopped. No real model/provider call was made.
The tests reproduce old selected-one/activated-zero behavior, preserve exact
ACTIVE through the actual API/prepared JSON round trip, reach the actual journal
context renderer deterministically, and retain missing/non-ACTIVE/privacy,
supersession, stale and empty-result controls.

## Exact package and installed paths

Private package: `deploy-memory-status-aca4c40`.

- Manifest SHA-256:
  `774bfda6536d41ce67a2d9dbc32d8635bdfcd356c10432aabc5f4375cf54f26d`.
- Archive SHA-256:
  `1621e8ae8eedd073ba3ab5d2ae948752a40c5624dd52545b3f9df51301c95689`.

Independent package review verified the exact two-file payload against merged
Git blobs, the allowlists and the existing checkpoint/backup operator. DELL's
initial staging transports selected Windows scp under its WSL shell and stalled
without copying a payload. They were stopped; the exact owned residual scp
process was terminated. Binary-safe SSH input to absolute `/usr/bin/tar` then
transferred the unchanged package and verified its hashes before installation.
An early preflight invocation while staging was incomplete did not execute the
operator. The subsequent complete preflight passed before live files changed.
No source/runtime workaround was made for transport.

Runner private rollback backup:
`C:\dev\cy\runner\state\deploy-backup-memory-status-aca4c40`.
The existing scoped operator preserved and hash-verified 924 files, including
both complete checkpoint graphs, supporting state/spools and replaced files.
Server metadata rollback backup:
`/home/dabblela/cy-deploy-backups/memory-status-aca4c40/data-handling.json`.
No backup/state was restored and no later natural state may be overwritten.

| Host | Path | Exact deployed SHA-256 |
| --- | --- | --- |
| DELL | runner/autobiographical-memory.js | d484bd813c6929d19728836693e1bd2e3d877a8ddfcf605cf89a89ac766c6833 |
| DELL and VPS3 | docs/data-handling.json | b8628ab627d1be347c5573bffe29c1ce403f949c07cc536fdce60dd6f42f3e14 |

Server metadata installed at `2026-10-26T21:40:16Z`; runner installation/readback
completed at `2026-10-26T21:40:18.963Z`. No PHP/API/runtime configuration change
was required. In particular the deployed liveness API/library and runner client/
memory runtime were not replaced. Their existing hashes remain verified.
No tests, historical journals, memories, prepared payloads or queues were
installed, repaired or manually edited.

## Guarded restart and evidence cutoff

Exactly one normal guarded restart request was made with the existing
`runner/cy-restart` helper. The watchdog:

- accepted at `2026-10-26T21:41:02.253Z`;
- stopped old runner PID10808 at `21:41:02.271Z`;
- cleared the request at `21:41:02.305Z`;
- let the existing supervisor start replacement PID1932 at `21:41:17.165Z`;
- recorded startup at `21:41:25.332Z`.

The old runner had an ordinary ambient-world inference active. The shared
arbiter's CY expiry counter increased from two to three across restart, as
expected for the stopped lease; no manual retry/replay was requested. Startup
reported the existing 2147-observation TPM reconstruction, both providers ready
and a synchronized mirror. This normal reconstruction is not a new world event.

The first complete healthy postflight, including actual installed hash checks,
defines the natural post-change evidence cutoff:

**26 October 2026 21:41:40.548 GMT / UTC**
(`2026-10-26T21:41:40.548Z`).

Old prepared selections missing status remain fail-closed. Only newly prepared
results can naturally demonstrate the repaired projection. No old prepared
payload was reinterpreted or backfilled. Preparation timing is not changed.

## Natural evidence and final health

Read-only consistent snapshots at `21:36:25Z` and `21:42:03Z` verified all 2518
old prepared selected-memory payload hashes unchanged, including 605 sets with
nonempty statusless selections. Canonical memory/source/tag/revision table
counts and hashes remained unchanged (24/69/178/69), as did the formation queue
and attempt table hashes/counts (9868/9734).

The unchanged normal claiming path retired the one pending unattempted journal
job on restart: SUPERSEDED increased from 222 to 223, and unattempted superseded
rows from 218 to 219. No manual queue purge, claim, retrieval or mutation was
performed. There was no newly prepared set or post-cutoff journal consumption
in this initial observation. The newest prepared set and owner query remained
the pre-change `16:48:17` records.

The final read-only snapshot at `21:52:28Z` still showed zero newly prepared
sets, zero post-cutoff prepared-set consumption and zero post-cutoff owner
memory-query records. All old prepared payload hashes, canonical tables and
formation-attempt hashes remained unchanged. The formation queue naturally grew
by one (9868 to 9869): a new ENVIRONMENT_EVENT source was queued at
`21:47:36.321`, remained PENDING with attempts=0 and had no completion at the
`21:53:07Z` metadata observation. This is normal source enqueueing, not new
durable memory formation, retrieval, backfill or a deployment-initiated event.

The ordinary five-second tick kept coalescing routine persistence. Its unchanged
ten-minute maximum write-behind interval was allowed to elapse. Checkpoint
generation `1793051490611-1932-2` was created naturally at `21:51:30.611Z` and
successfully committed at `21:51:32.221Z`, following startup generation
`1793050885651-1932-1` at `21:41:25.651Z`. Both complete content-addressed graphs
were validated by the unchanged operator. No save or checkpoint was forced.
Live diagnostics showed stateWriteCount=3, failedSaveCount=0,
lastValidationResult=valid, lastError=null and startupRecoveryUsed=false. A new
pending routine write after that successful save is normal coalescing, not a
failed checkpoint.

Final operator postflight at `21:51:58.528Z` verified synchronized mirror state
(12 objects, nine threads, zero adoption/publication required), empty delivery
and memory-source spools and no pending instrumental work. All twelve existing
meal episode phases and the meal-state hash remained unchanged. The stream head
advanced from 3028287 before installation to 3028612, with fresh live vitals.

Final health at `21:52:26.9648068Z` verified exactly one intended runner PID1932,
no outstanding restart request, CY/Feddit HTTP 200, Ollama 0.34.1 and only the
expected 11434/11435 listeners (no isolated 11535 listener). The existing Feddit
worker/arbiter process remained PID13868. Arbiter health and the unchanged
3072-context/four-thread profile passed, with normal leases continuing and the
restart-related CY expiry count stable at three. No paid/provider probe was
made. Both configured providers reported ready during normal startup.

Independent deployed-state review checked actual byte hashes against merged
Git blobs, unchanged runtime/API dependencies, health, checkpoint recovery and
the later natural checkpoint advancement. No material discrepancy, unexpected
recovery/replay or durable memory mutation was found. The expected TPM startup
reconstruction, stopped old inference lease and new unattempted environment
source are explicitly distinguished above from a claim that nothing changed.

No journal, retrieval, model/provider call, synthetic event, queue operation or
other production behavior was forced. Historical journals and memories remain
untouched. This rollout proves deployment correctness and deterministic metadata
preservation, not natural journal-memory enrichment or preparation readiness.
