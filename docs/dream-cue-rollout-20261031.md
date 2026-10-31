# Dream prompt-cue boundary rollout

Approved candidate: `2644f653d360f4b1e8e3842275fc371a51d46796`.
Production no-ff merge: `3aabfa46af783dcadf52945efce176b3c6c2f18e`.
First parent: `14315366ad7d21cc569889cfd834c4c91cfc48c1`.
Second parent: the exact approved candidate.
Merge/candidate tree: `973197106026546b94f7d4d133d08be61d0f26a7`.

Candidate was clean and remote-matched; production still matched its reviewed
base. The isolated merge preserves other checkouts and unrelated work. Its whole
tree equals the tested candidate. Remote production was verified at the merge
after publication. The older locally checked-out production branch was not reset.

## Scope and fresh validation

The sole runtime change removes the ordinary-dream and noise-waking narrative
suffixes in `runner/prompt.js`. Existing complete directives retain triggers,
context and the structured fragment contract. No blacklist, fuzzy filter, prose
rewriting, additional inference, cadence, retry, validator or unrelated prompt
change was introduced. Historical dreams and memories were not rewritten.

| Gate | Result |
| --- | --- |
| Focused | 211/211, zero skips, 36.002 seconds |
| Full serial runner, 153 files | 1088/1088, zero skips, 200.350 seconds |
| Relevant PHP regression scripts | 7/7 |
| Isolated ingest-replay and generic-memory API groups | 2/2, zero skips, 44.192 seconds |
| Merge-tree dream boundary/emitter checks | 31/31 |
| JSON fixtures/manifests | 15 valid |
| Changed JS/MJS and operator syntax, observation PHP lint | clean |
| Whitespace | clean |

The disposable integration database PID99304/localhost port59358 and both owned
GUID directories were independently verified absent after teardown; zero CY
schemas remained. No real provider call or production test event was used.

Private task-output log SHA-256 values:

- Full: `3172bc92b15ca93b1f7917f0bad60ce22359a2d3a08e446bda0df4b08c08a5c5`.
- Focused: `1801a5f9b82949c91d9c2e6190eba38df15a57af9d8161a47de9ebc38f28b8b6`.
- Integration: `8f5b5ab40315fcdf6d4e4a4ece0850ffc2c52c96082d2bc13886288932872d1a`.

Independent fresh source and exact-package reviews found no material issue.
The existing checkpoint/verified-backup operator was mechanically scoped to the
new pins, slug and two approved paths. No deployment-tool redesign was required.

## Package, installed files and rollback

Package `deploy-dream-cue-3aabfa4` contains exactly six verified members.
Manifest SHA-256:
`e8bc0578aac2393edfa6cf2537fbbdea3d1e14c4b8fa30064e0e9b282cb807e6`.
Archive SHA-256:
`8cd5533bc8ccd2b994c80aabfa31b74e5e4be34f4bf49b5e1bfb4de8f2f3f59a`.

| Installed path | Host | Exact SHA-256 |
| --- | --- | --- |
| `runner/prompt.js` | DELL | `50a3b4bfc274d234c2e97cbfe265f2ee3176d7aa1b41ffb6037af915f65a3b28` |
| `docs/data-handling.json` | DELL and VPS3 | `0a42efef071049a13c679e6b80d985ab2861a2626a6cbdc33703a71ca094e379` |

Payloads are exact merged Git blobs with canonical LF bytes. The tested checkout
uses CRLF and normalizes exactly to those blobs. The old live prompt's CRLF hash
`43dcb4b558d6d88d6c32a4ecc02b5ffe7a786e92dec9dcdd9fd95ba11c583040`
normalizes to base `7009e4c34aaa6e1cee2d07e59e753e52efa704f4f474a177933463f4fb939513`;
this was expected line-ending variation, not source drift.

The additive data-handling comment is matching metadata, not runtime code. No
PHP/API/UI, configuration, schema, FPM or model files changed. All protected
runner dependencies and six server API/library/registry hashes remain exact.

Verified private backup:
`C:/dev/cy/runner/state/deploy-backup-dream-cue-3aabfa4`, 990 files, including both
complete checkpoint graphs, supporting state/spools and exact replaced bytes.
At 18:34:52.411Z the explicit mirror0/0 and empty-spool gates passed before
installation. VPS metadata's exact original is preserved at
`/home/dabblela/cy/.deploy-backups/dream-cue-3aabfa4/original.json`.

Metadata installed on VPS3 at 18:35:08.867Z. DELL installation/readback completed
at 18:35:14.188Z. Metadata-only VPS publication preserved file permissions, used
an exact-hash verified original backup and atomic replacement, and did not load
application PHP or access application data.

Rollback was ready but not needed: restore only the verified old prompt and
matching metadata, then one guarded restart if necessary. Never restore state,
queues, database, checkpoints or historical records over later natural work.

## Restart and runtime evidence

An initial command-shell precheck failed before creating a restart marker; a
read-only status probe also exceeded its local output buffer. Neither requested
a restart or changed runtime/state. A subsequent bounded Node read proved the
marker absent, prior watchdog tail unchanged and exact `cy-restart` hash intact.
The unchanged existing tool was then invoked once through explicit WSL.
No runtime/operator workaround, direct kill, manual launch or second request was
used. The transport diagnostics did not alter the approved payload or semantics.

The watchdog acted at 18:38:03.102Z, stopped only runner9608 at18:38:03.139Z and
cleared the request at18:38:03.188Z. The normal supervisor started runner23636
at18:38:18.213Z. Startup reported zero replayed satiety intake records, normal
structured sleep-history recovery and Ollama/DeepSeek ready.

At18:38:59.761Z both checkpoint graphs and hashes were valid:

- `1793471904722-23636-0`, created18:38:24.722Z;
- `1793471914400-23636-1`, created18:38:34.400Z.

The second saved naturally at18:38:35.861Z. At18:39:21.427Z persistence reported
stateWriteCount2, failedSaveCount0, valid state, no fallback recovery and no error.
Mirror remained0/0 (12 objects/9 threads), both spools were empty, the restart
marker was cleared, exactly one intended runner23636 existed, CY/Feddit returned
HTTP200, listeners11434/11435 and existing provider/arbiter process identities
were healthy. Arbiter retained context3072/four threads. An ordinary chooser
request naturally entered inference through the coordinator and arbiter; it was
not forced. Stream advanced3212926 ->3213081, live vitals to18:39:19.609Z.

Meal state hash and prior resolved yard decision/projection/delivery identities
were unchanged. A natural search began18:36:52.512Z and completed18:37:52.578Z
before the watchdog acted; its one aftermath observation occurred18:38:34.089Z.
Read-only canonical inspection found exactly one occurrence of each of its six
stages on the same search ID. This is ordinary continuation, not a duplicate or
unexpected recovery outcome. No unexpected replay was observed.

## Independent final review and evidence cutoff

Independent fresh deployed-state review verified active DELL/package/merge
hashes, all staged members and protected dependencies, VPS matching metadata and
original backup, unchanged APIs, checkpoint progression, health and restart
identity. The narrow canonical stage-count receipt confirmed the natural search
crossed restart without duplicate stages. No material issue or gate remains.

Natural-evidence cutoff:

**31 October 2026, 18:39:21.427 GMT/UTC**
(`2026-10-31T18:39:21.427Z`).

No dream occurred in the observed rollout window; the latest retained dream
remained06:25:34.378Z. This establishes deployment correctness, not improved
real-model dream quality. No sleep, dream, noise-waking, journal, memory, world
event or inference was forced. No rollback or historical rewrite occurred.

Private receipt hashes under task `outputs/`:

- Package receipt: `b5fe68fb9b4b3524a5bd1a0f73ec7ac27d4a7b505c000d09ebbb1bc240b10c30`.
- Install: `29a6be6e28762b4c139be80ae0211b9021e4269526255b94a6a00503db6aba91`.
- Postflight: `836031b310092df000415c8701436e8a6ef7858ec5d26a3ad52b5b313b5d0699`.
- Final health/observation: `b40abf99c2ba3aa044fdf056ad15a028b94d7861c842d45c1e1df6c8ace87c6b`.

Dream quality is PASSIVE NATURAL OBSERVATION ONLY. No new dream audit or tuning
was started. Future engineering requires actual new evidence of a remaining
defect, not the absence of behavioral proof during this rollout.

**DREAM CUE BOUNDARY REPAIR: DEPLOYED**.
