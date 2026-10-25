# Journal repeat-guard alignment: production rollout

## Review and merge

Reviewed candidate `fix/journal-repeat-exposure-20261025` at
`e03bf73e8c5893441264eb897c8c5594c26a736f` was clean and remote-matched.
Production remained `1dc609d2116c0035735c312e69bc64bec0e7c52f`, with no
intervening changes. Independent final review found no material issue.

Authorized no-ff production merge:
`6967e092a81ec5095320ebb8378cee84acf0c458`.
Its first parent is the old production commit and its second parent the reviewed
candidate. The complete merge tree equals the candidate tree
`ef05d7f61be68a9d9da3bf6bbd5c3c7ef53530b0`. An isolated integration worktree
preserved unrelated primary-checkout work and all other worktrees. The normal
non-forced push advanced remote `current/production-lineage` to that merge.
This report is a separate documentation commit on the rollout branch.

The guard now compares the whole normalized candidate to the exact subjective
continuation carried from prompt construction. No later context reconstruction
or independent windowing occurs. The threshold remains **40 normalized
characters**, with the same normalization/minimum-length protections. Repairs
retain the original exposure; existing bounded retries get their own correctly
paired exposure. Non-journal and within-burst behavior is unchanged.

Prompt bytes, continuation construction/520-character representation, subject
selection, memory retrieval, sanitation, drawing separation, sampler/output
allowance and retry/cadence policies remain unchanged. No historical state or
journal rewrite was added.

## Validation rerun

| Validation | Result | Duration |
| --- | --- | --- |
| New repeat-exposure regressions | 22/22 | Included in focused run |
| Combined focused suite | 126/126 | 4.455 seconds |
| Candidate full runner suite | 788/788 | 44.469 seconds |
| Identical merge-result full runner suite | 788/788 | 36.320 seconds |

No failures, cancellations or skips. Changed JavaScript syntax, all 98 tracked
JSON files including model/data-handling manifests, and whitespace checks pass.
Tests use disposable workspace state and mock loopback servers, not real models.
The independent reviewer statically inspected all requested boundaries and the
four natural fixtures; execution results above are from the main verification.

Four natural regression fixtures: old guard accepts all four; repaired guard
rejects all four at the unchanged threshold. The optional validator-only replay
of the original 50 accepted journals gives old **0 flags**, repaired **4 flags**,
exactly sequences `2894968`, `2909130`, `2910793`, `2939517`. No other replay
decision changes. This does not predict replacement outputs or natural quality.

Parent-workspace evidence SHA-256:

| File | SHA-256 |
| --- | --- |
| journal-repeat-rollout-focused.log | 455a7cbc012f265cc112d2b56ee74202e74e38de8eac9e5f4bf0cee9e6e1772f |
| journal-repeat-rollout-full.log | ce6b664f35018f75c2274c6733372fa9f02406b3db9157606885d5311dd5d481 |
| journal-repeat-rollout-merged-full.log | 2bd104ca6679dd4d94ec17a3f8ba186d5dcb6f76cb9b95d04707b3e57b133a7a |
| journal-repeat-rollout-replay.json | b4bd6be3bc4ff56807b90e5ab50b49648fdc78db8f71c3f159928021b64dd74d |

## Backup and narrow deployment

Only `runner/warden.js`, `runner/prompt.js`, `runner/run.js` were installed on
DELL at `C:\dev\cy`. No production configuration, PHP, public assets, schema,
test files or fixture files were installed as runtime dependencies.

Private rollback backup:
`C:\dev\cy\runner\state\deploy-backup-journal-repeat-6967e09`.
All 902 captured files were read-back/hash verified, including current/previous
checkpoint manifests, all their referenced immutable sections, replaced source,
and available context/bookkeeping/spools/power/legacy state. JSON, section
hashes, byte lengths and decoded logical sizes pass. No backup state was
restored. Never restore captured checkpoints over later natural work merely to
roll source back.

The scoped installer was adapted from the preceding verified rollout operator;
an independent operations review found no material issue. It fences original
and replacement source, verifies backups/dependencies, syntax-checks payloads,
and installs dependencies before their caller. It neither invokes inference nor
rewrites world/history state.

Archive SHA-256:
`b6c4952bdf564b8b7a127f41fa4dca7b0138727a7aa2f1e34f65f261d9874e67`.
Operator SHA-256:
`49e880ace90f51da4fe6683ab3f0f7e504f1bdf97e946777be652b1d3bff412b`.

Installation completed at `2026-10-25T23:43:10.944Z`:

| File | Exact deployed SHA-256 |
| --- | --- |
| runner/warden.js | bbd5327543fa79ff276d9c4f4eb12b5efe6aaa8f4e3784dbd50453204db5e436 |
| runner/prompt.js | 43dcb4b558d6d88d6c32a4ecc02b5ffe7a786e92dec9dcdd9fd95ba11c583040 |
| runner/run.js | 1bd4661825a70b1766975c534895d879b58e40ff122cb0c46d753eabcd8d76ad |

Archive/deployed Windows source uses CRLF. Normalizing only CRLF to LF produces
the exact merged Git-blob SHA-256, respectively:

```
0bd17b065d1eabc45bbb189bbb9f8ff1d36a4e476abec809933d82d8b22c9211
7009e4c34aaa6e1cee2d07e59e753e52efa704f4f474a177933463f4fb939513
2cae157b07cba8c590b12aab5c6513b87fa525fa8ef59660f856b4d6ad972fba
```

Initial Windows-default-shell transfer/combined-health helpers did not complete.
No runtime installation occurred until the existing `dell-wsl` SFTP route,
separate process/HTTP/log checks and verified backup passed. Only
identity-verified helpers belonging to this rollout were terminated; no
SSH/firewall/service configuration or unrelated process was changed. Temporary
Windows rollout helpers were checked and the stale SCP receiver retired.

## Guarded restart and final health

The unchanged `cy-restart` helper was requested exactly once with reason
`deploy:journal-repeat-exposure-6967e09`. Watchdog stopped old PID8908 at
23:44:02.213Z, acknowledged at 23:44:02.227Z, and let the existing supervisor
start the replacement normally. Exactly one CY runner is PID4196.

- Both new valid checkpoint generations are `1792971862860-4196-0` and
  `1792971930107-4196-1`; current/previous sections decode and hash correctly.
- Mirror synchronized: 12 objects, nine threads, zero adoption/publication
  divergence. Startup log confirms synchronization; no recovery error observed.
- Stream advanced from 2991287 to 2991477; final event/vitals times were
  23:46:14.843 / 23:46:15.080 UTC.
- Delivery and memory-source spools empty; pending instrumental work empty.
- All eight meal phases/receipts preserved, with unchanged state hash
  `c9537910ed9e2864e8b0b8dc088f85af3533048192c219fc91d64cf55ec7d28c`.
- CY and Feddit root GETs returned HTTP200 after restart.
- Feddit worker PID14512 and arbiter PID13868 unchanged; loopback listeners
  11434/11435 healthy, no isolated 11535 listener.
- Ollama reports 0.34.1; arbiter `ok:true`, shared 3072-context/four-thread
  profile, zero CY/Feddit expiries. Ordinary scheduled inference resumed; no
  generation was requested by an operator/test to demonstrate this fix.
- All three deployed hashes and unchanged supporting dependencies reverified.

Before/after read-only database transactions fingerprinted the same recent
historical journal rows, bounded by public sequences 2887054 through 2990935:
187 text rows and 53 generation rows. SHA-256 stayed
`a4e1eefb06cc1a3cb91834f0a9d14d1718b264331d7b9e5f891581ba824d5d2f`.
This is a bounded historical-integrity check, not an audit of journal quality.
No historical records or saved continuation were scrubbed.

Conservative natural-evidence cutoff after successful final health/hash checks:
**25 October 2026 23:46:17.324 GMT / UTC**.

Future natural evidence must distinguish substantial verbatim reuse from shorter
or paraphrased recurring concerns; only the former is the target of this repair.
The threshold was not tuned. No journal, synthetic event, replay or inference was
forced, and no post-deployment behavior tuning occurred.
