# Delivered-meal lockdown admission: reviewed rollout

## Review and source authority

Final focused review: clean. Candidate
`2c67b2595b7bb7c859ae478d313aaeda6c386f1e` on
`fix/meal-lockdown-consumption-20261024` was clean and remote-matched. Production
was verified remotely as `1790d137cc4efbc2f24508a8761ebc943bfba893`.

No-ff merge: `61f3cd0a4c97a24a44740c6e735e2e19f5eb342b`.
The merge tree exactly equals the tested candidate tree. The production remote
was read back at that merge. An isolated rollout worktree preserved the stale
primary checkout and unrelated work instead of resetting them.

The only runtime diff is in `runner/run.js`: ACTIVE lockdown no longer makes an
already delivered in-cell meal restricted. Lockdown ID/status remains in the
unchanged permission fence. A lockdown onset/release during inference or commit
still invalidates that result. Actual availability, awake CELL location, search,
routine, regime, expiry, cancellation and all other stale-state checks remain.
No location permission, unrelated action, provider, sampler, physiology,
checkpoint schema or terminal-recovery behavior changed. The old random
consumed/partial/refused path did not reappear. No migration was needed.

## Validation

- Focused meal/lockdown/location/checkpoint checks: 98/98 pass.
- Full runner suite: 683/683 pass across 134 root test files with test concurrency
  2; no failures, cancellations or skips. Duration 145.698 seconds is not a
  performance comparison.
- `node --check` passed for runtime/test changes. Data-handling JSON parsed.
  `git diff --check` and merge/candidate tree equivalence passed.
- Disposable tests ran outside the Windows sandbox's known atomic-rename
  restriction. All inference was mocked; no real generation was invoked.

Local evidence directory:
`C:\Users\jodyf\Documents\Codex\2026-09-03\som\cy-meal-lockdown-rollout-evidence-20261024`.

Test log SHA-256:

- `focused-tests.log`:
  `de0077984bec4f50482278bd640132cd7f3ef483f8912b4014843cd834439eae`
- `full-runner-tests.log`:
  `7a7913f7a68a057abd88ee7216d33130c8a5fdd4bfb64b571cd26e9fa2820b1b`

## Backup and deployment

Private DELL backup:
`C:\dev\cy\runner\state\deploy-backup-meal-lockdown-61f3cd0`.
913 files were hash-verified, including the captured current/previous checkpoint
manifests and all referenced content-addressed sections, legacy fallbacks,
bookkeeping, delivery/source spools and original runtime. Decoding verified every
referenced blob's length/hash. Private state was not committed or exported.

Only `C:\dev\cy\runner\run.js` was deployed, atomically, at
`2026-10-24T14:39:09.417759Z`. Original bytes matched the production base, and
installation asserted that only the approved predicate/comment transformation
produced the staged merged bytes. Staged Windows Node syntax passed.

Deployed exact SHA-256:
`6710a7d31d8a9314cf31a560e89cb3b55609ba7b258ef1739a9bf7289e1e544c`.

No public/server file, test, rehearsal, configuration or other runtime file was
deployed. Unchanged meal-choice, environment, location-regime and guarded-restart
dependency hashes were rechecked. Rollback, if separately required, is code-only
plus the guarded restart; never restore old checkpoint/spool data over later
natural activity.

## Guarded restart and health

The existing `cy-restart` helper was invoked once with reason
`deploy:meal-lockdown-61f3cd0`. The watchdog acknowledged it at
15:40:03.971 BST and stopped exactly its one owned runner, PID 4368. The existing
supervisor created replacement PID 1584 at `2026-10-24T14:40:19.125Z`.
The request marker cleared; exactly one runner remained.

Recovered checkpoint generation: `1792852828387-1584-1`, committed at
`2026-10-24T14:40:28.387Z`. Current/previous manifests and section hashes were
read-only validated after restart.

- Breakfast/lunch remain NO_DECISION / STALE_BEFORE_OFFER with null offeredAt,
  decision and effect ID. Their complete episode fingerprints match the backup.
- All 304 feeding records and 128 satiety intake-history records have identical
  before/after fingerprints. Unknown intake remains unknown; INPUT_INCOMPLETE
  remains honest. No historical meal was reopened, offered or applied again.
- Meal outbox empty; delivery queue and memory-source spool both zero bytes.
- World mirror synchronized. All 12 object and 9 thread revision/transition
  identities match SQL, including compacted terminal markers.
- Public stream advanced from seq 2937588 to 2937705, with post-restart data.
- CY and Feddit HTTP HEAD both returned 200.
- Exactly the normal Windows loopback listeners :11434/:11435 remained, with no
  :11535. Ollama API reported 0.34.1. Arbiter health was OK with unchanged
  3072-context/four-thread profile. Heartbeat age was about ten seconds.

Windows listener probes ran through Windows PowerShell; WSL loopback is a
different network namespace and is not evidence of Windows listener health.

## Natural evidence

Post-deployment cutoff: **24 October 2026 15:44:32.899 BST**
(`2026-10-24T14:44:32.899Z`). At cutoff today's private meal diagnostics still
contained only the original four breakfast/lunch availability/failure records;
neither meal had been reoffered.

The next scheduled opportunity is tea at 16:45 BST on 24 October, contingent on
actual availability and normal eligibility. Leave it to the ordinary scheduler.
No meal, clock, state, event or production inference was forced for verification.

The next natural audit should use persisted AVAILABLE -> OFFERED -> COMMITTED ->
APPLIED telemetry, or a clean NO_DECISION/UNKNOWN reason, not journal prose.
The current model's strong semantic preference for eating remains a known
behavior; context-sensitive meal choice remains unproven. Do not tune declines.
