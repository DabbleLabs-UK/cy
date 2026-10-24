# Bounded meal-choice Tempo exemption: verified rollout

## Review and source authority

Final focused review: clean. Candidate
`51e5f4ff1867eae99fe308f415b662503b409537` on
`fix/causal-action-tempo-20261024` was clean and remote-matched. Production was
verified remotely at `61f3cd0a4c97a24a44740c6e735e2e19f5eb342b`.

No-ff merge: `76cfd0285d95cf5ecaa130c074da05dc4b3902b2`, pushed to
`current/production-lineage` and read back remotely. The merge tree exactly
equals the tested candidate tree. An isolated rollout worktree preserved the
stale primary checkout and unrelated work.

The only runtime change extends the existing central pre-model Tempo exemption
from postcard/warden to meal_choice. Both raw transport pacing checks still run
through that same policy; neither coordinator nor shared arbiter admission is
bypassed. Existing cancellation, wing-noise interruption, episode eligibility,
world-state/lockdown fences, commit barriers and exactly-once consequences remain.
Invalid/cancelled/stale results remain NO_DECISION/UNKNOWN without retry.

Journal/drawing/expressive-choice pacing branches, Tempo equations, background
gates, model/provider, prompts, sampler, execution profile and priorities are
unchanged. Completed meal inference still records pacing debt for subsequent
prose. Terminal meals are not reopened or retried.

## Validation

- Focused pacing, raw transport, meals, real checkpoint recovery, cancellation,
  coordinator and shared-lease checks: 100/100 pass.
- Full runner suite: 698/698 pass across 135 root test files, concurrency 2;
  no failures, cancellations or skips. Duration 61.084 seconds, not a benchmark.
- Runtime/test/replay JavaScript syntax, data-handling/fixture JSON parsing,
  offline timing replay, whitespace checks and merge-tree equivalence pass.
- Tests use disposable state and mock inference only. Checkpoint/full runs
  execute outside the Windows sandbox's known atomic-rename restriction.

Evidence directory:
`C:\Users\jodyf\Documents\Codex\2026-09-03\som\cy-causal-action-tempo-rollout-evidence-20261024`.

Test log SHA-256:

- `focused-tests.log`:
  `72dd99e538d258ad8e6f1842eea3acc6f0bfefa722ee5b69e3d0a7df06706fac`
- `full-runner-tests.log`:
  `edbd5e0aefc72f4a80dc8a9fa25d4c28f0d4dfd0e34698f92bd4090f8ea86a25`

## Verified backup and deployment

Private DELL backup:
`C:\dev\cy\runner\state\deploy-backup-causal-action-tempo-76cfd02`.
907 files were hash-verified, including current/previous checkpoint manifests,
all referenced immutable sections, legacy fallbacks, bookkeeping, delivery/source
spools and original run.js. Decoding validated every section length/hash. Private
checkpoint contents were not committed or exported.

Only `C:\dev\cy\runner\run.js` was deployed, atomically, at
`2026-10-24T16:39:26.306058Z`. Installation verified the original production hash,
the entire staged merged file, and that only the approved exemption/comment
transformation yielded those bytes. Staged Windows Node syntax passed.

Deployed exact SHA-256:
`b1b9c78ddc2d2c7ab2e8a2f96d2243277b19d1f5a4d435393d092acb1e57238a`.

No test, rehearsal, public asset, server file, configuration or other runtime file
was deployed. The unchanged Tempo, meal, environment/location, cancellation,
coordinator, shared-lease and guarded-restart hashes were verified after restart.
No migration or state repair occurred. Rollback, if separately needed, is code
only with guarded restart; never restore old state/spools over later activity.

## Guarded restart and recovery

The existing helper was invoked once with reason
`deploy:causal-action-tempo-76cfd02`. The watchdog acknowledged at 17:40:02.191 BST,
stopped only owned runner PID 1584 and cleared the request. The existing supervisor
created replacement PID 4824 at `2026-10-24T16:40:17.198Z`. Exactly one runner
remained; no experimental model/listener was started.

Recovered checkpoint: `1792860024592-4824-1`, committed
`2026-10-24T16:40:24.592Z`. Current and previous checkpoint/section integrity
were read-only verified after recovery.

- Breakfast/lunch remain terminal NO_DECISION / STALE_BEFORE_OFFER.
- Tea remains terminal NO_DECISION / STALE_OR_CANCELLED_RESULT with its original
  offer timestamp and null decision/effect IDs.
- All three complete episode fingerprints match the backup. No meal was reopened.
- All 306 feeding records and 128 satiety intake-history records have identical
  before/after fingerprints. Last known intake is unchanged; INPUT_INCOMPLETE
  remains honest. No consumption was inferred across downtime.
- Meal outbox empty; delivery queue and memory-source spool both zero bytes.
- World mirror revisions/transition IDs match SQL for all 12 objects and 9 threads,
  including compacted terminal markers.
- Public stream advanced from seq 2940792 to 2940873 with post-restart timestamps.
- CY/Feddit HTTP HEAD both return 200.
- Normal Windows loopback listeners :11434/:11435 are healthy, with no :11535.
  Ollama API reports 0.34.1; arbiter OK, unchanged 3072-context/four-thread profile.
  Natural journal work acquired the shared lease after restart without a probe.

## Natural evidence cutoff

**24 October 2026 17:41:55.220 BST**
(`2026-10-24T16:41:55.220Z`).

The next scheduled natural meal is supper/snack at 21:00 BST on 24 October,
subject to real availability and normal eligibility. No meal, clock, inference,
state replay or synthetic world event was forced for demonstration.

After that opportunity, use private authoritative AVAILABLE -> OFFERED -> model
decision -> COMMITTED -> APPLIED telemetry, or a clean NO_DECISION/UNKNOWN reason.
Journal prose is not evidence of consumption. The model's observed strong eating
preference remains a behavioral characteristic; context-sensitive variation is
not established, and refusal frequency was not tuned.
