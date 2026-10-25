# Ambient food-event retirement: production rollout

## Review and source authority

Candidate `fix/retire-ambient-food-defects-20261025` at
`9ac8f82ac9373ba3f39a67f16d0f877acb40d1f6` was clean and remote-matched.
Production remained `d335e0f6e6642c62d2a955338daea1b2c772027d` without
intervening changes. The authorized no-ff merge is
`1dc609d2116c0035735c312e69bc64bec0e7c52f`, with those commits as first and
second parents. Its complete tree is identical to candidate tree
`8c16eeb139a04d395f4c8bf13b22e2f9e6f4c268`.

An isolated integration worktree preserved unrelated unpublished primary-checkout
tooling and all other worktrees. Normal fast-forward-protected push updated the
remote production lineage. This report is committed separately on the rollout
documentation branch, not as a further production change.

Independent final review found no material issue. No live scheduler, dynamic
caller or alternate producer supplies `no_eggs` or `cold_tea`. The independent
awake-CELL roll, invented tray templates and unsupported meal/partial-deprivation
mapper are removed. Retired direct incident calls return before timestamps,
ledger, incident-clock or Soma effects, without falling back to replacement
texture. Generic compatibility consumers and historical display remain; they do
not originate events. No replacement food-detail mechanism was added.

## Validation rerun

| Run | Result | Duration |
| --- | --- | --- |
| Combined focused suite, including six retirement regressions | 102/102 | 3.933 seconds |
| Full candidate runner suite | 766/766 | 33.630 seconds |
| Full identical merge-result runner suite | 766/766 | 73.835 seconds |
| Standalone offline self-test | Passed | No model/provider call |

All test runs had zero failures, skips or cancellations. Changed/new JavaScript
syntax, data-handling and all twelve model-spec JSON documents, and whitespace
checks passed. The longer merge-result suite duration is not claimed as a runtime
performance result.

Pinned old-production and repaired scheduler controls each execute 200 eligible
passes with independent random sites forced explicitly:

| Effect | Old production | Repaired candidate |
| --- | ---: | ---: |
| `no_eggs` events | 100 | 0 |
| `cold_tea` events | 100 | 0 |
| Canonical capture calls | 200 | 0 |
| Soma observation calls | 400 | 0 |
| Legacy event application calls | 200 | 0 |

Historical incident text remains readable; legitimate neighboring overheard
activity still creates its ordinary incident, observation and public event.
Real meal delivery, eat/decline, failure/restart/idempotency, canonical feeding and
satiety tests pass. Environment, chooser, feeding, physiology, vitals, Soma,
prompt and dream source are unchanged outside the removed producer/caller wiring.

Parent-workspace validation-log SHA-256:

| Log | SHA-256 |
| --- | --- |
| `ambient-food-rollout-focused.log` | `1d0410200ef00ec9f595decc021b8397c83ee37af4d3a38551ccc476cf068adb` |
| `ambient-food-rollout-full.log` | `3d9e01b9e110db22ce18d61ccf8587544e832dc25f37ec2308ef68dccd72a7a8` |
| `ambient-food-rollout-merged-full.log` | `8c60914e896ee892b51ab3543888d08fec41bb19b1cbdd1878b3c566862baaa3` |
| `ambient-food-rollout-selftest.log` | `22a72f035cb36e0d0f35c9986b7b5e4fb256eae283c13c6e67bd76ffe82b6eff` |

## Backup and narrow deployment

Only `runner/incidents.js` and `runner/run.js` were installed on DELL at
`C:\dev\cy`. The changed offline self-test, tests and documentation are source
artifacts, not production dependencies. No PHP/public assets, production
configuration, schema or model/provider changes were required.

Private rollback backup:
`C:\dev\cy\runner\state\deploy-backup-ambient-food-1dc609d`.
All 908 saved files were read-back/hash verified, including both checkpoint
manifests and every referenced immutable section, original runtime files and
available spools/context/bookkeeping/power/legacy state. JSON, section hashes,
byte lengths and decoded logical sizes passed. Never restore captured state
over later natural work; source rollback and historical state restoration are
different operations.

The exact merged two-file archive was transferred byte-exactly through the
established SSH route, hash-verified and restricted to approved archive paths.
Archive SHA-256:
`ad551934e11fe3dd396cb14bad9d992d17513ff2bec77d007adc5b0959360284`.
Scoped backup/hash/install operator SHA-256:
`dc876d57a6b199805fbfe79d05adde61ad52335f642a833220169be0525eeb87`.
The operator does not start CY, invoke inference or mutate world state.

Installation at `2026-10-25T21:57:37.963Z`, dependency before caller:

| File | Exact deployed SHA-256 |
| --- | --- |
| runner/incidents.js | c549492794b9f488b02a9983b13a33769e3f9265e21514b0919704265d9be60c |
| runner/run.js | 7ef8ddd279c361bccdede771065bd7aedb9015bd0497848bd1fd4e70ee49b740 |

Windows archive bytes use CRLF. Normalizing only CRLF to LF gives the exact
merged Git-blob hashes, respectively:

```
eae4e98a88f068a6a74727b38f0dfff172089a3f0ba26733d7d066e269e5511f
2d843b537a63f3ef924a354f69e134c929c1b80d4242467e73a04ca9c210083d
```

## Guarded restart and health

The existing `cy-restart` helper was requested exactly once with reason
`deploy:ambient-food-retirement-1dc609d`. Watchdog stopped old PID4908 at
21:58:02.555Z, acknowledged the request and let the normal supervisor start the
replacement after its existing delay. Exactly one CY runner is now PID8908.

- Valid new checkpoint generations `1792965502832-8908-0` and
  `1792965504821-8908-1`; no recovery error observed.
- All eight existing meal receipts/phases are preserved byte-identically:
  `c9537910ed9e2864e8b0b8dc088f85af3533048192c219fc91d64cf55ec7d28c`.
  No closed meal was reopened or fabricated intake added.
- Mirror synchronized: twelve objects, nine threads, zero adopt/publish divergence.
- Stream advanced from 2988404 to 2988466 with fresh world/vitals timestamps.
- Delivery and memory-source spools empty; pending instrumental work empty.
- CY and Feddit HTTPS each returned 200.
- Feddit worker PID14512 and arbiter PID13868 unchanged. Windows-loopback
  listeners 11434/11435 healthy; no isolated 11535 listener.
- Ollama reports 0.34.1; arbiter `ok:true`, 3072-context/four-thread profile,
  zero CY/Feddit lease expiries. Ordinary scheduling/lease activity continues.
- Deployed hashes match merged source; unchanged meal, physiology, vitals, Soma,
  dream and shared context dependencies were reverified after restart.

This verifies preserved mechanics and state, not a new naturally observed meal
transaction. No meal was forced to obtain behavioral evidence.

## Historical integrity and natural evidence

Read-only database transactions fingerprinted historical records before/after
deployment, bounded at public sequence 2988372 and canonical occurred time
`2026-10-25 21:47:36.902`:

| Store | Rows | Unchanged SHA-256 |
| --- | ---: | --- |
| Public food-defect events | 2961 | ffa9c5f09400a161e637fcc17c54bfbed318a5e552cb7dcb6ff0aec5962a1495 |
| Canonical food-defect records | 1754 | 0015626ba5a73f9f9d8215d1f2c24767d551cb668a624d18f8cefeb7de373361 |

The bounded post-restart query found zero new canonical `no_eggs`/`cold_tea`
records after watchdog acknowledgement. This short observation is corroboration,
not a long-run frequency experiment. Code/control evidence establishes removal
of the producer. Historical records, old journal text and saved context were not
scrubbed; later prose may still refer to old food material.

Conservative natural-evidence cutoff after final successful health/hash snapshot:
**25 October 2026 21:59:33.844 GMT / UTC**.

Both unsupported ambient producers are retired in production. Ordinary meals
remain on their existing natural schedule and guarded choice/intake lifecycle.
No meal, food event, journal or model inference was forced; no synthetic
production behavior, historical rewrite or post-deployment tuning occurred.
