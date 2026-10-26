# Bounded journal angle-prefix repair: rollout

## Reviewed identity and scope

Approved candidate: `793a047e57cecb6b92dbecf5d3cc0b4d676c17a5` on
`fix/journal-unclosed-angle-20261026`.

No-ff production merge: `ecd0064974f440394935cf297b901230c2368b91`.
First parent: `b8a7347b95911eb0068818a567869e99727dda67`.
Second parent: exact approved candidate above.
Merge/candidate tree: `cc059dca8e09e78f475e90b16adc2fa682f07dba`.

Remote `current/production-lineage` was advanced by normal non-forced push. The
unrelated local production-lineage ref/worktree at `a08107b` was preserved.
Integration used a separate branch based on remote deployed production. This
rollout report is a separate documentation commit, not an additional runtime fix.

Independent final review returned looks-good with no material source findings:

- The rule is journal-only, narrowly matching unclosed tag-shaped multiword
  prefixes at clause boundaries, not arbitrary unmatched angles or pipes.
- `42 < 43`, mathematical prose, `<3`, ordinary mid-clause angles and existing
  closed-markup sanitation retain their tested baseline behavior.
- Initial and existing repair candidates and exact staged publication text use
  the journal check. Rejected output cannot publish or append continuation or
  expression/Soma feedback.
- The previously deployed finalization, explicit-length/missing-reason behavior,
  93-token limit and bounded retry policy are unchanged.
- Prompts/style/cadence, provider/sampler, memory, drawing runtime and historical
  records are unchanged. No global angle/pipe rule or telemetry was added.

## Validation and transport-test investigation

| Check | Result |
| --- | --- |
| Focused candidate suite | 173/173, 6.931 seconds |
| Full candidate runner suite, serial | 855/855, 69.563 seconds |
| Full identical merge runner suite, serial | 855/855, 70.801 seconds |
| JavaScript syntax | 217 files pass |
| JSON/manifests | 100 files parse |
| Whitespace | `git diff --check` passes |

The earlier parallel failure was `ollama-raw-transport.test.js:119`, asserting
server-observed connection closure after a 20-ms wait. That test and provider
are unchanged and do not import either changed runtime module. Prior standalone
and serial passes, plus both new full serial passes, show no candidate-caused
regression. The exact environmental cause of the historical timing miss cannot
be proved from the retained log. No transport code/deadline was tuned.

Tests used disposable local state and ephemeral mock transports. No real model
or production inference was used for validation.

## Private backup and exact installation

Only these two runtime paths were installed, dependency before caller:

| Path | Deployed byte SHA-256 |
| --- | --- |
| runner/character-output.js | cdaad33bcb26f16abe8bd91f12aced7494e8587e51a8b5cd275c9a85524d518e |
| runner/run.js | a70d3a31de89c6c03e8fd915c729148a1792547f51fd146da35f3fd34dc395d5 |

Windows checkout CRLF normalization to LF matches merged Git-blob SHA-256:

```
9b0cd9cabfe352448ed5e0f33f02019d3dc977daba0d53fa83cb32b716a552db
18391cc9fed663c9b2c047bf944efe97108066fe3e2c8cd43c762bc588cc2966
```

No metadata/manifest changes were needed. `warden.js`, drawing files, provider,
prompts, public assets, server source and runtime configuration were not deployed.

Private rollback backup:
`C:\dev\cy\runner\state\deploy-backup-journal-angle-ecd0064`.
The reviewed scoped operator captured and read-back/hash verified 935 files,
including both valid checkpoint generations and all referenced immutable
sections, available context/bookkeeping/spools/power/legacy state, and the two
replaced runtime files. All indexed backup bytes were checked again immediately
before installation. No captured state was restored; rollback must never restore
old state over subsequent natural activity.

Pre-install observation: `2026-10-26T17:59:10.875Z`. Mirror: 12 objects, nine
threads, zero adoption/publication required. Stream head: 3022424. Both spools
and pending instrumental work were empty. Existing 11 meal episodes/phases had
hash `4a9f90c7607cc7186565ad6478e176968ed131c30a00092ff6987a4454cd1498`.

Installation/readback completed at `2026-10-26T17:59:26.166Z`.

Independent package review verified the exact two-file allowlist, manifest,
payload hashes and unchanged-dependency fences against merged source, and the
backup/syntax/readback gates. The operator is the prior approved scoped pattern,
not a new transaction subsystem; a copy/readback failure would stop rollout.

Windows SCP/SFTP staging attempts stalled before copying any package bytes.
Only the two identity-verified owned local transfer pairs were stopped. The same
package transferred successfully over the existing DELL WSL SSH endpoint into
the same Windows handoff directory; all archive/manifest/operator hashes were
verified before extraction. No gate was skipped and no runtime had been
installed during those transfer attempts. Unrelated SSH/SFTP processes were not
terminated.

Private package evidence under `deploy-journal-angle-ecd0064`:

- Operator SHA-256: `fc9197afcc0fcd9524aabbaa0776078bd77bcb0bf7a4e4e00ea6fdda239467ff`
- Archive SHA-256: `6cfd862603d494232e9f8c31b79965f711d5400d6e72d6e707eab54d45d28e74`
- Manifest SHA-256: `faf28d28b746c9208d93c7b55a829b4d1ee248e1ea76a48544a82c9528ad0c80`
- Backup-index SHA-256: `445199a7c0e0fa2acdf9ba5524e318b11c11592250fc00876addfe74018f1465`

## Restart, health and evidence cutoff

The unchanged guarded `cy-restart` helper was requested once with reason
`deploy:journal-angle-ecd0064`.

- Watchdog accepted the request at `2026-10-26T18:00:02.725Z`.
- It stopped exactly one old CY runner, PID15516, at 18:00:02.744Z.
- Request acknowledgement/clear occurred at 18:00:02.772Z.
- The existing supervisor started replacement PID15408 at 18:00:17.131Z.
- Startup diagnostic was written at 18:00:25.083Z. No second restart was requested.
- Validated startup checkpoints are `1793037623408-15408-0` and
  `1793037625508-15408-1`.

The 18:00:47.199Z postflight verified both checkpoint section graphs and decoded
logical sizes, all unchanged dependency fences and both deployed byte hashes.
Mirror remained synchronized (12 objects, nine threads, zero adoption or
publication needed). Stream head advanced from 3022424 to 3022457. Both spools and
pending instrumental work remained empty. All 11 existing meal episode IDs/phases
and the complete meal-state hash were unchanged.

At 18:01:03.130296Z, exactly one intended runner was present, the restart request
was absent, CY/Feddit root GETs returned 200 and Ollama `/api/version` reported
0.34.1. Expected 11434/11435 loopback listeners were present, with no 11535 isolated
listener. Arbiter health was `ok:true` with the unchanged 3072-context/four-thread
profile. Arbiter PID13868, Ollama listener PID14268 and Feddit worker PID14512
(separately checked by script identity and creation time) were unchanged.

Startup reported normal TPM sleep-history reconstruction and `world mirror
synchronized`. No state-recovery fallback/error or unexpected property/meal
consequence replay was observed. This does not claim that startup performs no
reconstruction: its existing TPM observation replay is normal, not a new event.

An independent reviewer freshly read the two deployed byte hashes over SSH and
independently hashed merged Git blobs. Both match the manifest/payload/readback
receipts, with no material discrepancy.

The normal write-behind flush occurred without intervention. The
18:10:49.787Z postflight validated generation `1793038230370-15408-2`, created
at 18:10:30.370Z. A further postflight at 18:11:27.299Z validated current generation
`1793038266476-15408-4` (18:11:06.476Z) and previous
`1793038257540-15408-3` (18:10:57.540Z), including their immutable section graphs
and logical sizes. No save, journal, inference or world event was forced to
obtain advancement.

Final stream head was 3022763; mirror remained 12 objects/nine threads with zero
adoption/publication required. Both spools and pending instrumental work were
empty, all 11 prior meal phases and the same meal-state hash were preserved.
Final health at 18:11:07.9283501Z still showed exactly one runner15408, no restart
request, both HTTP 200s and healthy unchanged provider/listener/arbiter controls.
Arbiter CY expiry count remained 1, unchanged from before restart; normal shared
lease activity continued.

Public persistence diagnostics at 18:11:08.346Z reported four successful state
writes, zero failed saves, `lastError:null`, `lastValidationResult:valid` and
`startupRecoveryUsed:false`. The preceding coalesced pending save was normal
write-behind, not a persistence failure. No unexpected recovery/replay was
demonstrated. The independent final receipt review also returned looks-good,
including the beyond-startup checkpoint validation and final cutoff evidence.

Conservative natural-evidence cutoff:
**26 October 2026 18:11:08.346 GMT / UTC**
(`2026-10-26T18:11:08.346Z`).

Historical journals were not rewritten. No inference, journal, drawing, synthetic
event or other production behavior was forced. The drawing comparison was not
started. Future natural journals, not deterministic rollout checks, will provide
behavioral evidence. This intentionally narrow syntactic check does not claim to
solve all malformed-angle shapes, old saved continuation, or unrelated journal
quality issues.

Test logs are retained under the workspace `outputs/` directory:

- `journal-angle-rollout-focused-20261026.log`
- `journal-angle-rollout-full-20261026.log`
- `journal-angle-rollout-merge-full-20261026.log`

Private installation/backup/health/checkpoint/cutoff receipts remain in the task's
`deploy-journal-angle-ecd0064` directory and the matching DELL handoff/backup
directories. No private checkpoint contents or credentials are committed.
