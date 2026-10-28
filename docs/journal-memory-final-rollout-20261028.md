# Final journal memory lead-time rollout

Workstream state: **PASSIVE NATURAL OBSERVATION**.

Approved memory candidate: `09b77356130d79f443b53ff74fa42f4557e76407`.
Approved operator: `39f95e2791ac19b0b6316b08d480f8ca4bacb47e`.
Production no-ff merge: `8952baf86dc47e86c7536c84b5f390c762086884`.
First parent: `8363197d805e672ee59582ce0b1d0d88f14c3e48`.
Combined tree: `273383f3c08be3f02458ad7c621910b5e9bd7fe3`.

The merge contains both approved commits. Its complete non-ops tree is identical
to the reviewed memory candidate; its ops tree is identical to the reviewed
operator. No memory implementation, prompt, model, sampler, TTL, ranking,
preference, cadence or opportunity-budget adjustment was made for rollout.
The unrelated original checkout was preserved, and the old stopped package was
not reused. Remote production was updated only after the new pre-install gate
passed. No force push or public release occurred.

## Validation

| Gate | Result |
| --- | --- |
| Mixed-queue regressions | 21/21 |
| Focused lead-time/liveness/status/formation-runtime | 152/152 |
| Full serial runner | 1,044/1,044, 118.762 seconds |
| Corrected operator/FastCGI regressions | 18/18 |
| PHP memory checks | 254 across 11 scripts |
| Owned isolated MariaDB/API groups | 5/5, 84.286 seconds |
| Additional combined-merge lane/wiring checks | 65/65 |
| Changed JS/MJS/PHP syntax, JSON and whitespace | clean |

No failures/skips/cancellations were excused. Owned local database/FastCGI/PHP
fixtures were identity-checked and stopped, with fixture schemas/temp entries
removed. All inference fixtures were deterministic; no real model call was
made by validation. Independent source and exact-package reviews found no
material issue.

## Fresh package and production FPM preflight

Package: `deploy-journal-leadtime-8952baf`, 20 exact members.
Manifest SHA-256:
`b3b5ebbfdbef7838bdd5aa41d688c7c9bd81ff933ff5db698a54b7fa764860a3`.
Archive SHA-256:
`9ee90136026d845217559502cfb16e66e9d90cacc180fdbf0179be2900a57d01`.

All nine unique application payload files match the combined merge. All three
corrected PHP operators/probe/client match `39f95e2`. The private validation tree
contains exact candidate library/helper copies plus the unchanged declaration-only
postcard dependency (`61d31277beca64009a89d12d9f3cffe1aaac67d31630866a29104d6c49a49611`).
These validation copies are not installed as application payloads.

The fresh server staging tree is root:www-data, directories 0750/files 0640,
allowing serving-FPM read/traverse without write access or private application
state. Both hosts verified every staged member before execution.

At **2026-10-28T15:52:54.841Z**, actual serving PHP **8.5.12** FPM passed:

- cache capability/timestamp-validation checks;
- separate compile-only requests for all three staged PHP payload files;
- one separate load of the isolated staged library, preserving its unchanged
  require_once dependency graph, with both required functions and PDO present;
- exact source-hash/action/success receipts, without a compile-then-load request.

The API handler was never executed by the probe. No database, queue or provider
was called by staged library loading. The temporary pre-install probe and plan
were removed in the gate's finally block before installation.

## Installation and exact deployed files

API-first order was preserved: helper, compatible library, API, metadata; then
runner dependency, client, memory runtime, run.js and matching metadata.
Serving FPM rechecked the staged syntax before any API rename, then verified
the installed helper by compile, library by single load and API by compile in
separate requests. API installation completed at 15:54:22Z, postflight/HTTP 200 and
private-probe cleanup at 15:55:01Z. DELL installation readback completed at
15:55:02.820Z. There was no migration, backfill, queue purge or state restore.

| Host/path | Deployed SHA-256 |
| --- | --- |
| VPS3 lib/journal_memory_preparation.php | 3be5b491f47692448e0bb89f61d77d35c6221793632429af3346eaa95957d9bc |
| VPS3 lib/autobiographical_memory.php | f18abcac34e3c89055632e6cfac0c58df256a41042233c12255fce665dc14c19 |
| VPS3 public/api/memory.php | a9882bc6518a85e851519e75084ef1dd9318e2603dfe0f99156bfef891f8d553 |
| DELL runner/journal-memory-preparation.js | 74917caac27da16ed3f03357fedf9aded334e26572d55e65da49d174125b3047 |
| DELL runner/client.js | 3ddd1c27429b5b91b9f6db8b4c43cf3b08d66cf0389a3f2d7cf5a580f4de4254 |
| DELL runner/memory-runtime.js | 72171c0c7c95cc5418e7098f96ce4cf59ddd7c8819086bd24f25ebc33fb05c79 |
| DELL runner/run.js | eeaa88fadc65a8bc8b6fb3139a6ab34c578380733d9612346de1f3c207f94bd6 |
| Both config/implementation-registry.json | 9582d2bcfab262db22832380f3c0d15d93e416012e18893b0e90ea71174614a4 |
| Both docs/data-handling.json | f0c29fd2705a1c7669a75191afbf6eaa6c89e46967d00030275223035aa4cb0f |

The old registry's historical CRLF bytes were verified separately against the
LF-normalized production source before replacement; exact old bytes were backed
up. DELL's private backup contains 955 verified files, complete current/previous
checkpoint graphs and supporting state/spools plus replaced runtime files:
`C:/dev/cy/runner/state/deploy-backup-journal-leadtime-8952baf`.
API backups are under `/home/dabblela/cy-deploy-backups/journal-leadtime-8952baf`.
No backup was restored over later natural activity.

## Guarded restart and initial health

Exactly one normal guarded restart request was issued. The watchdog acted at
15:56:02.455Z, stopped only old runner 6464 at 15:56:02.493Z and acknowledged the
request at 15:56:02.546Z. Its existing supervisor started runner 16900 at
15:56:17.136Z. No second restart or direct process kill was requested.

Startup replayed zero satiety intake records, recovered existing structured
sleep history and reported both providers ready. Full checkpoint/hash postflight
at 15:56:56.010Z validated new generation 1793202984457-16900-0 and the prior old
generation. Mirror reconciliation was 0 adoption/0 publication with 12 objects
and 9 threads. All 18 meal phases/hash and the existing resolved yard greeting
were unchanged. Both spools were empty.

Health at 15:57:00.241Z verified exactly one runner 16900, unchanged worker/arbiter
13868, expected 11434/11435 listeners, no 11535 listener, cleared restart marker,
Ollama 0.34.1 and CY/Feddit HTTP 200. The arbiter retained 3072 context/four threads;
ordinary resource serialization with Feddit remained intact.

The SELECT-only observation at 15:57:03.377Z reported valid persistence, zero
failed saves, no fallback recovery, stateWriteCount 1 and stream head 3095032
(before installation 3094950). All four canonical memory table counts/hashes
matched the 15:53:31.294Z pre-install baseline: 24 memories/69 sources/178 tags/
69 revisions. Two old queued surfacing rows became SUPERSEDED by normal service,
not manual queue manipulation.

Natural-evidence cutoff:

**28 October 2026, 15:57:03.377 GMT/UTC**
(`2026-10-28T15:57:03.377Z`).

## Ordinary checkpoint advancement and final deployed review

The normal write-behind window was allowed to elapse. No checkpoint, world event
or queue work was forced to shorten it. Generation `1793203592109-16900-1` was
created at **16:06:32.109Z** and saved at **16:06:33.504Z**. The SELECT-only check
at 16:07:24.704Z reported stateWriteCount 2, zero failed saves, valid persistence
and no fallback recovery. Stream head advanced to 3095311, with live vitals at
16:07:18.972Z.

Full checkpoint/hash postflight at 16:07:27.299Z validated the new ordinary and
prior startup generations. Mirror remained 0/0, spools empty, all 18 meal states
and the prior yard greeting unchanged. All four canonical memory table counts
and complete hashes still matched the pre-install baseline; no unexpected memory
mutation, duplicate social projection or world replay was found.

Final health at 16:07:31.212Z retained exactly one runner 16900, unchanged worker/
arbiter 13868, healthy expected listeners, cleared restart marker and CY/Feddit
HTTP 200. Ordinary memory formation held a normal arbiter lease incidentally;
that is continuing existing work, not evidence of journal enrichment or a forced
model call. Arbiter lease-expiry count remained the existing three.

Independent deployed-state review freshly checked active DELL/VPS hashes against
the merge/package, unchanged dependencies, absent probe directories and the
installation/restart/recovery receipts. Final checkpoint evidence was supplied
for its persistence confirmation. No material regression blocked this rollout.

## Incidental activity and workstream boundary

One SELECT-only metadata snapshot at 16:05:08.766Z found no post-cutoff cue-bound
preparation row, attempt or prepared set. Multi-attempt slots, duplicate attempt
rows and ordinary-surfacing wing-noise failures were all zero. No journal-memory
consumption/enrichment was demonstrated. This is absence of suitable incidental
evidence, not a defect or a trigger for another audit.

END-TO-END NATURAL ENRICHMENT: **NO** (not demonstrated during verification).

No journal, recall/preparation, queue work, world event, opportunity, yard action
or provider inference was forced. Natural activity continued independently. No
post-deployment memory evidence audit or automation was scheduled.

Final health verification passed. This workstream is
**PASSIVE NATURAL OBSERVATION ONLY**. No timing, scheduling, retrieval-quality,
TTL, fingerprint, preference or enrichment tuning is authorized merely because
enrichment is absent, rare or mediocre. Further engineering requires a clear
production correctness/safety regression or explicit later owner reprioritization
based on demonstrated value. Deployment success does not establish recall quality.
