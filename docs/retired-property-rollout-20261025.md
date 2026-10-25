# Legacy property scenario retirement: production rollout

## Source and review

Candidate `fix/retire-property-handover-20261025` at
`87f538c73696d1ceee316e8c2dbfd7d43972652b` was clean and remote-matched.
The no-ff production merge is `227b294ef411fa2b9e7125fb44f63420c71050c6`,
with production parent `76cfd0285d95cf5ecaa130c074da05dc4b3902b2`.
The merged tree equals the reviewed candidate tree. Remote production was
read back at the merge. The primary checkout's unrelated, unpublished
accelerated-soak work was not reset, merged or deployed.

Final independent read-only review found no material issue. Both generic and
staged admissions are removed. Existing definition-based reconciliation drops
legacy pending work; raw dispatch also drops it, and direct resolution returns
null. The latest-search mutator and branch-specific consequence/publication
block are removed. No alternative caller or abandoned private-plan/outbox/barrier
machinery is carried in this clean candidate. Already-created delivery payloads
and historical records are not rewritten. Normal staged inspection, completion,
aftermath, instructions, timing and canonical object/mirror mechanics remain.
See [feature boundary](retired-property-handover-20261025.md).

## Validation

- Focused retirement/search/instrumental/checkpoint/object/mirror checks: 60/60,
  7.654 seconds. Candidate full runner suite: 708/708, 37.618 seconds.
- Full suite on the merge result: 708/708, 34.006 seconds; no failures,
  cancellations or skips. Merge and candidate have identical complete trees.
- Changed JavaScript syntax, JSON manifests and whitespace checks pass.
- Offline old/new false-possession and crash controls: four paired cases
  (handover/withhold, with/without a canonical object). Pinned old production
  produces three distinct world/public outcomes and mutates the wrong completed
  search over two restarts. The retirement produces zero outcomes and preserves
  search, object and ledger state.
- A redundant post-deployment local replay hit Windows sandbox EPERM on a
  disposable checkpoint rename. The same unchanged replay passed outside that
  sandbox. No production fixture, network or inference was involved.

Parent-workspace log SHA-256:

| Log | SHA-256 |
| --- | --- |
| retired-property-rollout-focused.log | fefeafe96dd445954ea6090067b2a2bb3d86ddf28a82cd3400f8f4a344b1295e |
| retired-property-rollout-full.log | e61efec180486e1ed40dc82bda7311a9af456856d5ae3d8a4b1e6c879a56a0c6 |
| retired-property-merged-full.log | c5b78c693d3185df0d278ba60c44a6573751d16708e1959812f8b0fa6fd49a42 |

## Deployment and hashes

Four approved files were installed on DELL at `2026-10-25T15:23:08.227Z`.
Only matching model-spec metadata was published on VPS3; there were no PHP,
public-asset or schema changes. Tests, diagnostics and documentation were not
deployed as runtime dependencies.

| DELL runtime path | Deployed SHA-256 |
| --- | --- |
| runner/run.js | 7945a13f14c3d8cb477a78987898684f2b0446a68f55dbc07b8378742fd65b49 |
| runner/instrumental-agency.js | cb706d64367a8babdc8b24d25024d343e33a71cc6428861b0b1fab0147d977ed |
| runner/location-regime.js | 19d75353268424009131d8b6fda5d6ddcd50fe5a85c4217c16fc96e26ebbb18b |
| config/model-specs/prison-instrumental-opportunities.json | 4fb922717fa804f3bf0d95a75ad0461260fbe3976da4e0b6943cb547985972ba |

The VPS3 metadata hash equals the final row. Windows git archive exports CRLF;
normalizing only CRLF to LF gives these exact merged Git-blob hashes, respectively:

```
a416294fea29a0333d383d098bf4942d9cb615d094144165ebb8f013b3b0f91f
aa9d7c3666f676659fe062423727bb0592a58e5b1a9acac547d98bd48ce0cd64
b8f6683b832a961631a528303ba60371c226c9a90e1bb911a09d26b435498b57
ffce98bc41aa855e8983606b348f9cc8c60c72f22cc02bfea03bc6595be43c7e
```

The verified package hash is
`e56d42bf0762635c21993617fe2feb5ef95f40c76d566d56f2f2b141bdd75cc2`.
A stalled SCP was stopped before any runtime installation; transfer succeeded
over authenticated SSH and hashes were verified before use.

Private backup on DELL:
`C:\dev\cy\runner\state\deploy-backup-retired-property-227b294`.
All 917 backup entries were read back and hash-verified, including both checkpoint
manifests and referenced section blobs, original runtime files and available
spool/state fallbacks. The checkpoint decoder verified JSON, bytes, hashes and
logical lengths without invoking cleanup/recovery writes. Original VPS metadata
is backed up at `/home/dabblela/cy/ops-backups/retired-property-227b294`.
Never restore these state snapshots over later natural activity.

## Restart, recovery and live checks

The existing guarded `cy-restart` helper was requested once. Watchdog stopped
old runner PID 4824 at 15:24:02.915Z; supervisor started replacement PID 2996.
New application startup is recorded at `2026-10-25T15:24:25.702Z`.

- Exactly one CY runner; normal checkpoint recovery, then valid generations
  `1792941866034-2996-1` and `1792941901015-2996-2`.
- No pending instrumental opportunities, including no legacy property work.
- Existing Bailey search remains COMPLETE/AFTERMATH_OBSERVED with its original
  identity, timestamps, officer, null object and NOTHING_FOUND result. The only
  snapshot difference was one naturally appended linked event, independently
  identified as `lockdown_started` at 15:25:00.783Z, not a property resolution.
- All 12 canonical object revisions/transitions unchanged. Mirror: 12 objects,
  nine threads, zero adoption/publication divergence; startup confirms sync.
- Delivery and memory-source spools empty. Public stream advanced from 2976904
  to 2977092 with fresh vitals; no synthetic event was submitted.
- CY and Feddit HTTP 200. Feddit worker PID 14512 and arbiter PID 13868 unchanged.
- Ollama 0.34.1 listens on loopback 11434; arbiter listens on 11435 and reports
  healthy with the unchanged 3072-context/four-thread profile. No 11535 listener.
  Natural CY activity and queued Feddit work remained resource-arbitrated.

Read-only before/after SQL fingerprints over the fixed pre-rollout scope:

| Records | Count | Unchanged SHA-256 |
| --- | --- | --- |
| Public handover/withhold rows through seq 2976927 | 520 | 77e8c9a8f93f549e7a14072edadb7a208c84580f81096e43e35ae63c31020f44 |
| Canonical legacy property records through 15:21:31.048Z | 520 | 5cdec56a51319b3d244ac747a62cd536470a0c2565fef95a251648643fd332ce |

No new legacy property resolution occurred after that scope timestamp. No old
payload was modified or purged. Ordinary search/object behavior is preserved by
diff and regression tests; no new search/object event was forced as live proof.

Conservative natural-evidence cutoff after successful verification:
**25 October 2026 15:29:23.173 GMT / UTC**. The UK clocks changed that day;
this timestamp is not BST.

The retired scenario is now disabled in production. No replacement behavior,
forced inference or world event was introduced. The abandoned dirty worktree
at `67d1864` remains preserved separately and was not merged or deployed.
