# Bounded meal-consumption agency: reviewed rollout

## Authority and verdict

Final review: clean. Independent read-only review found no material issue in
`68056b8...4547ed1`. Runtime changes are `5087e53` and the answer-hint removal
in `1219d21`; later commits are isolated synthetic rehearsal/evidence work.

Production base: `68056b88fed2360ed959ef6f57b9890be52c84af`.
Reviewed candidate: `4547ed1bbed0216b5b6e21b9624f735827759955`.
No-ff merge: `1790d137cc4efbc2f24508a8761ebc943bfba893`.
The merge tree equals the reviewed candidate tree. Remote production readback
confirmed the merge. The old local production checkout was preserved; a new
isolated rollout worktree used the verified remote base rather than its stale
local ref. No unrelated work was incorporated or overwritten.

## Reviewed boundaries

- Institution/world logic selects delivery availability, retaining the existing
  missed-delivery RNG interval. Cy chooses consumption only after actual live
  availability, not whether the institution supplies a meal.
- Exactly `eat` and `decline` are valid. Partial consumption and RNG refusal
  are not choices. Historical partial/refused records remain unchanged.
- Invalid, absent, timed-out, cancelled or stale results are NO_DECISION with
  unknown consumption. They do not imply refusal, intake or missed delivery.
- Offer and decision checkpoints precede inference and effects respectively.
  Meal identity, live-state fences, effect receipts and identified delivery
  receipts prevent cross-meal application, duplicate feeding and uncertain replay.
- Restart never resends an uncertain offer. Only a committed still-applicable
  decision can recover; unknown intake is not filled in across downtime.
- Canonical feeding/satiety calculations are unchanged. Only established
  consumption enters the existing intake path.
- The answer-looking `response` hint is absent. Opaque A/B IDs, counterbalancing,
  fixtures and rehearsal launchers are not in the deployed runtime set.
- No appetite rules, forced declines, quotas, action randomness, repetition
  policy or behavioral-ratio tuning was added. Model/provider/sampler, journal
  limits, Tempo, AWG and memory policy remain unchanged.

The fixed 32-call diagnostic retained eat 32/32 while independently balancing
raw ID, display position and enum position 16/16. This supports semantic choice
under the agreed operational standard; it does not establish bodily sensitivity.

## Validation

On the exact merge result:

- 48/48 focused Node test results passed: meal state/decision parsing, failures,
  timing, checkpoint recovery, delivery/idempotency, real Soma physiology
  comparisons, environment, shared lease and timeline labels.
- Full runner suite: 656/656 passed, no failures, cancellations or skips;
  reported duration 163.571 seconds. The candidate also independently passed
  656/656 before merge (65.747 seconds). These are not performance comparisons.
- JavaScript syntax checks passed for all six changed JS runtime/web files.
- Changed PHP recovery endpoint lint passed locally and on the staged server
  file. Data-handling JSON parsed; `git diff --check` passed.
- The Windows sandbox initially denied atomic checkpoint-test renames with
  EPERM. Authoritative focused/full runs used disposable fixtures outside that
  sandbox restriction. No production fixture, provider call or meal was used.

Complete merge-result logs remain outside the source checkout in
`C:\Users\jodyf\Documents\Codex\2026-09-03\som\cy-meal-rollout-evidence\`.

Log SHA-256:

- `merged-focused-tests.log`:
  `cd96aaaf77b4b414581b2d42b9ed661841bb42fb13c7d3f5d9bbdd47a84122e0`
- `merged-runner-tests.log`:
  `da357017748f6d4ff6b63d14665c2f9489cfa87ea4eb1f2b4cdb1188e88a5a93`

## Private backup and deployment

DELL private backup:
`C:\dev\cy\runner\state\deploy-backup-meal-choice-1790d13`.
950 backup files were hash-verified, including coherent current/previous
sectioned checkpoints and referenced immutable sections, legacy fallbacks,
bookkeeping, delivery/source spools and original runtime/dependency files.
Copied checkpoints were decoded and compared with the captured source state.
No checkpoint backup/private source content was committed.

VPS private backup:
`/home/dabblela/cy-backups/meal-choice-1790d13-20261023`.
It retains original files, staged exact source, hash index and installation plan.

All target files and eight unchanged checkpoint/physiology/context dependencies
matched production-base source before installation. Windows Git archive EOL
conversion initially failed the staging hash gate; installation was not allowed.
Staged files were normalized to LF and verified against exact Git blob hashes.
Only verified source bytes were then installed atomically. Web ownership/modes
were preserved. No migration, backfill, config change or state reset occurred.

### Exact deployed SHA-256

| Host/path | SHA-256 |
| --- | --- |
| DELL `runner/client.js` | `fd81af8ee13480ba13ca66eb05e21bbe42f5c1ae5a74fac58b68d07ae3a98d71` |
| DELL `runner/environment.js` | `7e2fefe65f649e8405efe9344c824ad69c4ad98881b7d7fc2f74531c4365f95b` |
| DELL `runner/meal-choice.js` | `8bce3d6ffb22f6e7d3c0870fb4f3052378e206c7a66d35b169394f3ab49cec54` |
| DELL `runner/run.js` | `3507f98ce1007481ef48e8388e0009d02d8395f386ea87ffe100bfb8ce05db2e` |
| DELL `runner/shared-ollama-lease.js` | `9929a1cb2679ec50b2e008cbe7ee76338c3b76f5fcac57644f7ddc67e2f57f49` |
| VPS `public/api/satiety-recovery-history.php` | `ed9266de51ced1fc54b2a0b070eced7491e70de96fc9119c18286b44363706cf` |
| VPS `public/assets/timeline.js` | `41d7dc1994504b035990834b7d5f823091c44fd4c27b294695d8d8ca1c7cc05b` |

No tests, opaque-ID diagnostic, rehearsal module, frozen state, configuration
or unrelated runtime file was deployed. Dependencies were rechecked unchanged.

## Guarded restart and recovery

Web installation: `2026-10-23T20:25:04.291857Z`.
Runner installation: `2026-10-23T20:25:31.226111Z`.
The unchanged guarded `cy-restart` helper was called exactly once, with reason
`deploy:bounded-meal-choice-1790d13`, at `20:25:31.310Z`.

The watchdog acknowledged the request at 21:26:02 BST and stopped only owned
runner PID 7512. The existing supervisor started replacement PID 6888 at
`2026-10-23T20:26:17.227Z`. The marker was cleared; exactly one runner remained.

Verified new checkpoint generation `1792787184923-6888-1`, committed at
`2026-10-23T20:26:24.923Z`, contains the version-1 meal-choice state with empty
episodes/outbox. This does not replay historical meals or create a new offer.
All 300 pre-deployment feeding records and 128 satiety intake-history records
were retained byte-semantically. Satiety remained LIVE with the same model.
Startup reported successful satiety replay (zero new records) and synchronized
world mirror. Existing runner config hash remained unchanged.

Health verification:

- Delivery queue and memory-source spool: zero bytes.
- Public stream advanced from seq 2908823 to 2909038; live vitals advanced
  beyond restart to 21:27:34.939 BST.
- CY and Feddit HTTP HEAD returned 200.
- Normal inference listeners remained loopback :11434/:11435; no :11535.
- Shared arbiter healthy; unchanged 3072-context/four-thread execution profile.
  A killed pre-restart CY lease expired safely; subsequent ordinary Feddit
  holding/CY queueing was visible, not overlapping experimental inference.
- Deployed source hashes and all eight dependency hashes were rechecked.

## Natural evidence and limitations

Conservative post-deployment natural-evidence cutoff:
**23 October 2026 21:28:36.981 BST**
(`2026-10-23T20:28:36.981Z`).

No production meal, event or inference was forced. The next naturally available
meal may use the chooser through normal scheduling. Authoritative evidence is
the checkpoint and private `meal_choice` stages: available, offered, valid
result/NO_DECISION, committed, applied, and recovery where relevant. Later
journal prose is not proof of consumption or a decision.

The current model has demonstrated a strong semantic preference for eating;
context-sensitive meal choice has not yet been demonstrated. Repeated natural
eat choices do not justify tuning refusal frequency. No natural meal outcome
was required or claimed by this rollout. Leftovers/storage/later eating remain
outside this bounded mechanic; failed or expired choices honestly leave intake
unknown.
