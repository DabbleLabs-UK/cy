# Bounded real-model meal-choice result

## Verdict: REVISE - withhold rollout pending evidence of context sensitivity

Exactly 20 fixed opportunities and 20 actual model sends completed. Every response
was valid `eat`; there were zero declines, NO_DECISIONs, transport failures,
timeouts, repairs, retries or replacement cases. This demonstrates bounded
execution, not the context-sensitive genuine-choice behaviour sought here.

No runtime correction was made. All-eat is not by itself proof of a prompt bug,
nor grounds to tune toward a target ratio. The present run cannot distinguish a
model prior from wording/schema positional bias, or demonstrate that fullness
was considered. A future counterbalanced presentation diagnostic would test
that uncertainty; none was run or automatically authorized by this result.

## Authority and exact scope

- Runtime implementation: `5087e53b5b1756b746fad16ac1eeb1251cb30983`.
- Frozen rehearsal tooling: `f828e43645659db7c41406faa3d33faa87d67e4d`.
- Active production character provider was read-only confirmed as `ollama` in
  the Tempo row (`paused=0`), corroborated by runtime diagnostics/config.
- Actual returned model on every call:
  `hf.co/mlabonne/Meta-Llama-3.1-8B-Instruct-abliterated-GGUF:Q5_K_M`.
- Existing Windows Ollama 0.34.1; tag manifest digest
  `c6ec899cdf5f8e3f55350f7fc28735be2f77556c011f71a5bf6402556aba1cc8`.
- Existing shared arbiter, 3072 context, four threads. Actual production option
  helper: temperature 0.72, top_p 0.86, repeat_penalty 1.18,
  repeat_last_n 160, num_predict 80, unchanged stops.
- Exact per-case inputs/schema/options are in `evidence/baseline-f828e43/manifest.json`;
  actual send ledger is `sends.jsonl`. Offline analysis checks their equality.
- The actual meal request/parser/lifecycle/provider/coordinator/profile helpers
  are used. Live main-loop orchestration, clock advancement, Tempo scheduling,
  production interruption/publication/accounting are not exercised end-to-end.

The fixed synthetic set uses four existing meal names. It supplies no ingredients,
preferences, diets or reasons. EMPTY/FILLING/FULL are explicitly hypothetical
current gut-state checkpoints projected through unchanged canonical Soma code,
not evidence that these exact states naturally occur at scheduled meals.
Subjective hunger is not modeled or invented. Injury is an observed synthetic
forearm abrasion, not an invented sensation or emotional response.

Model-facing bodily evidence is respectively no available grounded facts,
possible stomach fullness empty/partly full/full, plus the observed abrasion
where applicable. All actions remain exactly `eat` and `decline`.

## Every completed case

All HTTP statuses were 200; all responses stopped normally (`done_reason=stop`).
No explanatory prose, third action, backend knowledge or invented reason was
returned. A rationale was not requested, so hidden reasons cannot be assessed.

| Case | Available meal | Bodily evidence | Raw action | Wait s | Inference s | Output tokens |
| --- | --- | --- | --- | ---: | ---: | ---: |
| 01 | breakfast | sparse | eat | 174.678 | 22.331 | 7 |
| 02 | lunch | empty | eat | 99.854 | 17.510 | 7 |
| 03 | tea | full | eat | 0.005 | 17.341 | 7 |
| 04 | supper snack | partly full | eat | 0.007 | 18.237 | 7 |
| 05 | breakfast | empty | eat | 55.312 | 17.608 | 7 |
| 06 | lunch | full | eat | 233.680 | 18.118 | 7 |
| 07 | tea | partly full | eat | 48.218 | 17.545 | 7 |
| 08 | supper snack | sparse | eat | 0.013 | 17.720 | 8 |
| 09 | breakfast | full | eat | 0.004 | 6.966 | 7 |
| 10 | lunch | partly full | eat | 0.011 | 7.634 | 9 |
| 11 | tea | sparse | eat | 0.004 | 7.659 | 7 |
| 12 | supper snack | empty | eat | 0.003 | 8.081 | 7 |
| 13 | breakfast | partly full | eat | 0.006 | 7.012 | 7 |
| 14 | lunch | sparse | eat | 0.012 | 7.566 | 7 |
| 15 | tea | empty | eat | 0.011 | 8.097 | 7 |
| 16 | supper snack | full | eat | 260.947 | 7.100 | 7 |
| 17 | lunch | sparse + abrasion | eat | 183.405 | 8.082 | 7 |
| 18 | lunch | full + abrasion | eat | 0.008 | 7.986 | 7 |
| 19 | breakfast | exact request repeat of 01 | eat | 0.005 | 8.038 | 8 |
| 20 | lunch | exact request repeat of 06 | eat | 0.011 | 8.292 | 7 |

Representative exact outputs are `{"action": "eat"}` and `{"action":"eat"}`.
All 20 raw outputs and complete provider metadata are preserved, not just accepted
actions. Sparse 6/6, empty 4/4, partly full 4/4 and full 6/6 all chose eat.
Choosing eat while full is not individually forbidden or necessarily irrational;
the evidence problem is the absence of any demonstrated contextual distinction.

Batch: 2026-10-23 16:40:24.054Z to 17:01:59.462Z, elapsed 21m 35.408s.
Inference min/median/max: 6.966 / 8.0895 / 22.331 seconds.
Shared-access wait min/median/max: 0.003 / 0.011 / 260.947 seconds.
Prompt tokens: 217-241 per call, 4491 total as reported by Ollama.
Output tokens: 7-9 per call, 144 total. Most elapsed time was shared-access wait,
not inference; no lease bypass or change to ordinary Cy/Feddit admission occurred.

## Failure and consequence controls - offline, not additional model calls

Seven probes (malformed, unsupported partial action, empty result, provider error,
timeout, cancellation, stale response) all yield NO_DECISION and canonical UNKNOWN
consumption, with null energy/fraction rather than refusal, eating or missed food.

All 20 real-model eat decisions traversed isolated commit/application once and
produced canonical FULLY_CONSUMED intake with their decision/effect provenance.
Repeating application did not duplicate intake.

There was no real-model decline. `offline-positive-controls.json` explicitly marks
separately injected valid eat/decline decisions as offline, not model behaviour.
The controls verify one offer, committed authority, once-only canonical FULLY_CONSUMED
versus REFUSED, fractions 1 versus 0, and distinguishable later feeding context.
Canonical physiology was not changed.

## Tests, isolation and preservation

- Five rehearsal tests passed locally and in native Windows on DELL.
- Latest focused meal run: 43 Node subtests passed, including nine legacy
  action-outcome assertions inside one script and real sectioned-checkpoint recovery.
- Full unchanged runner suite: 655/655 passed, 62.292 seconds.
- One sandboxed focused rerun encountered Windows EPERM on the isolated temporary
  checkpoint atomic rename. The exact unchanged tests passed outside that sandbox.
- Offline evidence analysis verifies all 20 call/options against the frozen manifest,
  send order/uniqueness, parser results, provider/raw equality and effect provenance.
- All 260 remote package source hashes remained unchanged; no isolated runner
  `state` directory was created. No remaining rehearsal process was found.
- Post-run arbiter healthy, no active lease, all queues empty; Ollama still 0.34.1.
- Cy/Feddit were never paused, unloaded, reconfigured or restarted. Therefore no
  restoration mutation was needed. Ordinary autonomous activity continued.
- No experiment writes targeted production meal/checkpoint/feeding state,
  publication, configuration or paid-provider/accounting APIs.

Remote originals remain at
`C:\cy-rehearsal\meal-choice-20261023-f828e43\baseline-f828e43` on DELL.
The copied evidence archive SHA-256 is
`f5731e410b5b5ccc16695b88f26a6df07318c436f733903db770f24c54014b9f`.
The tracked evidence directory includes source hashes, complete raw results,
send ledger, completion, failure probes, analysis and isolation verification.
`evidence/SHA256SUMS.txt` covers the evidence directory excluding itself; local
attributes preserve those artifacts byte-for-byte across Git checkouts.

During this rehearsal other authorized work advanced the shared local production
lineage to `a08107b`. This task did not move that ref, merge this feature or deploy
anything. The rehearsal remains frozen to `5087e53`, not that later lineage.

No production merge, deployment, migration, restart or runtime code correction
was performed. Keep the feature unmerged; do not interpret mechanical validity
as demonstrated context-sensitive agency.
