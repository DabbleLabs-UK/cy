# Journal-memory queue-liveness rollout

## Source and review

Approved candidate: `8f1eeb24c23ed75d04954f042f6859447d9d1706` on
`fix/journal-memory-surfacing-liveness-20261026`.

Production no-ff merge: `a8d4d0ea0cbbb35f399536bed8f1fb2cfbe3ad51`.
Parents: deployed `ecd0064974f440394935cf297b901230c2368b91` and the exact
candidate. Merge tree `99df745e7fd8c6e0d748161c7760f19e17b12f94` is identical to
the reviewed candidate. Remote production advanced by normal non-forced push.
The unrelated local production worktree/ref at `a08107b` was preserved.

Independent source and deployment-plan review returned looks-good. Only exact
no-sender `journal:<decimal timestamp>` work is governed by the current desired
compatible fingerprint. There is no new age threshold; the existing ten-minute
interrupted-processing recovery is not the supersession criterion. Incompatible
open journal rows retire before claiming/retrieval, with runtime compatibility
checks before/after search/model work and before activation. Explicit null after
restart means no live journal desire, not a persisted historical request.

Formation, durable memories, eligibility/privacy/world-truth policy, journal
nonblocking construction, prompts, cadence, token limit, repeat/finalization,
providers and generation settings are unchanged. PENDING result counters are
null, not fabricated zero-hit search results; attempted status remains unknown
from prompt readiness alone. No migration or manual queue purge was used.

## Revalidation

| Gate | Result |
| --- | --- |
| Focused runner memory/liveness/search-retirement | 65/65, 11.203 seconds |
| Full candidate serial runner suite | 873/873, 195.314 seconds |
| Full identical merge serial runner suite | 873/873, 196.503 seconds |
| Real isolated PHP/MariaDB HTTP suites | 4/4, 131.530 seconds |
| New PHP namespace/authority checks | 15 passed |
| Existing PHP memory suites | Eight passed |
| JavaScript/PHP syntax, JSON, whitespace | Passed; 100 JSON files |

Integration tests used only synthetic data in a new owned loopback MariaDB
10.10.2 instance and copied PHP 8.4 API. It was verified stopped afterward.
Tests made no real provider/model requests.

## Package, backups and exact installed files

Private package: workspace `deploy-journal-memory-a8d4d0e`.

- Manifest SHA-256:
  `3e251b80abcbe9843ee635f9217c30329fcaa479e777ccd04d9d989a6c5a0ffa`
- Archive SHA-256:
  `97a31f82d5de3175cbbcf35619bfd1f298c2d8ca9e3d81643b1a1b42065f89e7`

Independent package review verified all seven distinct payload files against
exact merged Git blobs and declared hashes. All runtime base hashes matched
production after CRLF normalization. Server data-handling metadata lagged behind
source; inspection found historical metadata lag, not server-only policy or a
runtime conflict. The manifest pinned its actual old normalized hash
`8fa08bc90b8b6d84a1f44ebaf2adb8754c06809f22faaf22e8c5d99f97bc2342`.
Only the already-approved changed metadata path was updated.

Server private rollback backup:
`/home/dabblela/cy-deploy-backups/journal-memory-a8d4d0e`.
All four replaced server files were copied, hashed and verified before mutation.

Runner private rollback backup:
`C:\dev\cy\runner\state\deploy-backup-journal-memory-a8d4d0e`.
The existing scoped operator verified 925 files, including both complete valid
checkpoint generations/sections, existing supporting state/spools and replaced
runtime files. Backup hashes were rechecked immediately before installation.
No saved state was restored; old state must never overwrite later natural work.

| Deployment | Path | Exact deployed SHA-256 |
| --- | --- | --- |
| Server | lib/autobiographical_memory.php | 05bf3f74f3c49c707ac59d73d8ec2b2bcbbc4f963abf5640a3d250144d8abfe5 |
| Server | public/api/memory.php | 42166facfc9c852cd4c3f7fcb5079f466b31cb4e8fdabd8a914c41e1e1671d99 |
| Server | public/api/memory-inspection.php | fba23ca9f4478e56d5346ada8cf9f3d12582428981263ed05e7d363506e282ac |
| DELL | runner/client.js | 207b5003e1910f87df5d37180ecf6f6519760c1be604b90ae32ae3b57ca4dc19 |
| DELL | runner/autobiographical-memory.js | 332b401d0257f57d49789b24cb532f29e28a8ed9cd2ef551877489ba6cb59338 |
| DELL | runner/memory-runtime.js | b8fd5ff757368e0f34e959550e7569db78d281f3e60c568f4d846aec213ad3f5 |
| Both | docs/data-handling.json | 68cf7e2bf57e749757c020382be3da510262d0866cdcba6d9fb115e3427fbf8a |

No tests, prompts, runtime configuration, other source files or historical
journals/memory records were deployed or rewritten.

## API-first compatibility sequence

Server installation completed at `2026-10-26T20:25:45Z`:

1. Publish the additive PHP library atomically.
2. Verify that serving FPM sees the new helper before publishing its API caller.
3. Publish the API, then owner inspector, then matching metadata.
4. Verify exact hashes and ordinary memory GET HTTP 200.
5. Only then install all three runner files and metadata, completed at
   `2026-10-26T20:26:06.533Z`, and request the normal guarded restart.

Serving PHP 8.5.12 had OPcache enabled, timestamp validation enabled, two-second
revalidation/update protection and no restricted API. A private root/www-data
probe outside the web root was called only through the existing FPM socket.
It invalidated only each approved changed PHP file and verified the library
helper/API compilation in serving FPM. No service reload, global cache reset or
persistent configuration change occurred. The exact temporary probe and its
private `/run/cy-journal-memory-a8d4d0e` directory were verified removed afterward.

During the server-first interval, old clients without current authority cannot
claim new journal work; unrelated optional consumers remain compatible. Existing
old in-flight completion remains accepted. No claim, retrieval or generation API
was invoked by deployment verification. Do not roll the compatible API back
while this runner remains installed.

## Restart and natural queue evidence

One guarded restart request was made. Existing watchdog evidence:

- Accepted at `2026-10-26T20:27:02.863Z`.
- Stopped old runner PID15408 at `20:27:02.880Z`.
- Cleared/acknowledged at `20:27:02.896Z`.
- Existing supervisor started replacement PID10808 at `20:27:17.133Z`.
- Startup diagnostic at `20:27:24.969Z`.

The old runner had an ordinary journal inference active. Its lease expiry
counter increased once across the guarded restart; subsequent arbiter health
was normal. No manual inference replay/retry was requested. Startup's existing
TPM reconstruction reported 2147 structured observations and synchronized the
world mirror; this was normal reconstruction, not a manufactured world event.

Read-only consistent database snapshots at `20:24:52Z` and `20:28:07Z` found:

| Evidence | Result |
| --- | --- |
| Prior open recognized journal jobs | 221 |
| Naturally SUPERSEDED | All 221, at 20:27:24.180 UTC |
| Previously unattempted jobs | 218; all remain attempts=0 |
| Prior prepared queue rows | All 2518 unchanged |
| Durable memories | 24; complete table hash unchanged |
| Memory source links | 69; complete table hash unchanged |
| Memory tags | 178; complete table hash unchanged |
| Memory revisions | 69; complete table hash unchanged |
| Formation queue | 9865; complete table hash unchanged |
| Formation attempts | 9733; complete table hash unchanged |

Two already-attempted old jobs incremented during the old-runner interval around
20:25:08, before API installation. The one added completion was PREEMPTED at
20:25:08.587. This was not retrieval caused by retirement. No new attempt was
created for the 218 unattempted retired jobs. Metadata snapshots retain no raw
memory/source prose; their private hashes/counts and queue identities are not
committed. Queue retirement was performed solely by normal runtime claiming.

## Final persistence, health and evidence cutoff

The ordinary write-behind timer was allowed to run unchanged. Startup generation
`1793046443220-10808-0` was followed naturally by
`1793047050236-10808-1`, created at `2026-10-26T20:37:30.236Z` and successfully
committed at `20:37:31.617Z`. The scoped postflight validated both complete
checkpoint graphs, content hashes and logical sizes. No save was forced.

At final diagnostic observation, stateWriteCount was 2, failedSaveCount was 0,
lastValidationResult was valid, lastError was null and startupRecoveryUsed was
false. A subsequently pending/coalesced save is normal write-behind, not a failed
checkpoint. The maximum ten-minute dirty-state interval is unchanged.

Final health at `20:38:04.6745399Z` verified exactly one intended runner PID10808,
no outstanding restart request, CY/Feddit HTTP 200, Ollama 0.34.1, expected
11434/11435 loopback listeners and no 11535 isolated listener. The shared arbiter
was healthy with unchanged 3072-context/four-thread profile. Its restart-related
CY expiry count remained 2, with normal subsequent grants/releases. Startup
reported both configured providers ready; no paid/provider probe was made.

The mirror remained synchronized: 12 objects, nine threads, zero adoption or
publication required. Both delivery/source spools and pending instrumental work
were empty. All 11 existing meal episode phases and the complete meal-state hash
remained unchanged. Stream head advanced from 3026276 before installation to
3026701 at the cutoff; rich live vitals also advanced.

The final read-only database snapshot at `20:38:22Z` still showed 221 SUPERSEDED
rows, 218 with zero attempts, and 2518 historical prepared rows. Memories,
sources, tags, revisions and formation-attempt table counts/hashes remained
unchanged. The formation-queue count also remained 9865, but its hash changed:
three old ENVIRONMENT_EVENT rows (4178-4180) became EXPIRED at
`20:30:13.955Z` under the pre-existing 30-day generic-source retention rule.
Existing worker diagnostics at that instant reported CADENCE, not a new
formation inference. This unchanged normal maintenance is not a manual purge,
new formation policy or memory mutation introduced by this repair.

Independent live SSH review checked server and runner byte hashes against merged
Git blobs and package receipts, confirmed temporary FPM-probe removal and
correlated natural queue retirement with the private read-only snapshots.
No unexpected recovery/replay or memory mutation was demonstrated. Normal TPM
startup reconstruction and the old-runner completion are explicitly recorded
above rather than described as no replay of any kind.

Conservative post-rollout natural-evidence cutoff:
**26 October 2026 20:40:09.522 GMT / UTC**
(`2026-10-26T20:40:09.522Z`).

No journal, memory retrieval, provider/model call, synthetic event, queue retry or
other world activity was forced. Natural runtime activity continued normally.
No historical journals, prepared recall history or canonical memories were
rewritten. Only normal claiming retired obsolete optional journal work.

## Unresolved separate boundary

Selected-memory projection still drops `status`, while activation requires
`ACTIVE`, potentially leaving the activated set empty. This pre-existing defect
was not repaired or concealed. The rollout establishes queue supersession and
avoided obsolete work, not successful journal memory enrichment. Current
compatible readiness, real relevance, consumption and that projection issue
remain separate natural-evidence/investigation questions.
