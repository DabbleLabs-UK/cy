# Dream prompt-cue boundary

Source baseline: production `14315366ad7d21cc569889cfd834c4c91cfc48c1`.
This is a source-only repair. No rollout or real inference is authorized here.

## Demonstrated cause

`runner/prompt.js` appended this to every ordinary dream request, after the
complete structured directive and bounded dream packet:

```
[deep under. a murmur surfaces in your sleep, half a word:]
```

The noise-waking branch appended a second narrative-shaped seed:

```
[you come up hard out of sleep, awake for one second:]
```

These are private writing cues, not canonical observations or dream material.
Both production callers in `dreamStep` already supply `dreamGenerationDirective`,
which establishes asleep/noise-waking mode, JSON fragments, limits, and optional
bounded material. The extra terminal prose invites continuation despite that
contract. The first cue substantially recurs as the first fragment of seven of
20 retained public dream sets in the frozen 26-28 October sample:

| Public sequence | UTC publication | First-fragment form |
| --- | --- | --- |
| 3032658 | 27 Oct 00:26:25.447 | bracketed `deep under. a murmur surfaces...` |
| 3037125 | 27 Oct 03:16:35.171 | `a murmur surfaces in your sleep, half a word:` |
| 3039599 | 27 Oct 04:51:08.235 | same |
| 3068601 | 27 Oct 23:12:48.748 | `a murmur surfaces in my sleep half a word:` |
| 3071646 | 28 Oct 01:09:20.457 | `deep under. a murmur surfaces...` |
| 3071881 | 28 Oct 01:18:08.930 | `a murmur surfaces... half a word, fades` |
| 3075948 | 28 Oct 03:53:14.827 | `a murmur surfaces... half a word` |

Public values and exact timestamps are retained in
`runner/fixtures/dream-cue-natural-20261031.json`. The read-only consistent-snapshot
inspection ended at 31 October 17:45:35.900 UTC. All 20 persisted context packets
lack this wording and contain zero actual autobiographical traces. A selected-ID
sidecar is not proof of inserted text. Clean sets occur between echoes.

The original complete provider responses were not retained in these records.
Wrapping published values in the expected JSON contract deterministically proves
admission, not the exact historical wire framing. No available evidence suggests
CY manufactures the phrase in extraction or persistence: its identifiable source
is the appended prompt prose. The unchanged strict parser accepts a complete
`{"fragments":[...]}` response; plain-language cue echoes are valid string values
and are not technical protocol markers.

## Publication and recurrence

`dreamStep` validates returned fragments. `emitDreamFragments` rechecks before
sanitation and after screening, publishes the dream, then queues the exact
fragments as subjective, INTERNAL_ONLY `DREAM_EXPRESSION` formation input.
It does not append dream text to waking continuation or recent grounded world
history. The immediate dream-material pool uses news, ledger and cast material,
not earlier dream output. Formed eligible memories could theoretically return
later, but none of these 20 actual context packets contains a memory trace or the
cue. Feedback amplification is therefore not demonstrated in this sample;
repeated direct exposure exists on every dream prompt instead.

## Small repair

Dream rendering returns the existing trimmed directive block only. Remove both
redundant terminal narrative cues at that one construction boundary. Keep all
actual supplied triggers, grounded material and optional memory context. Empty
diagnostic directives remain empty rather than inventing replacement prose;
legacy fallback directives still work unchanged.

Only `runner/prompt.js` changes at runtime. `run.js`, `dream.js`, provider,
publication, feedback, cancellation, cadence, sampler, 96-token cap and zero-retry
contract remain byte-identical to production. Other prompt modes remain exact.
Older whole-source regression guards reverse only the hash-pinned rendering delta
before applying their original assertions; unrelated edits still fail them.

The existing strict JSON/protocol/role/fence guard remains the final structural
defence, including a second check in the emitter. No new literal blacklist,
similarity heuristic or prose rewriting is introduced. Independently generated
natural wording about murmurs, sleep, words or voices remains valid, including an
unmarked phrase resembling the retired cue. This repair removes its systematic
prompt source; it does not promise semantic non-copy detection. Structural
packaging still fails privately without publication or formation feedback.

No historical dream or durable memory is rewritten. There is no additional
provider call, raw-response retention, recipient, store or public diagnostic.

## Validation

The final expanded focused run passed 211/211, including 17 new boundary tests,
the existing actual dream-step/emitter tests with real prompt construction, sleep
tests and protected journal/memory regressions. Four relevant PHP scripts passed:
Soma API, autobiographical origin kind, memory retention and implementation
registry. Two opt-in isolated MariaDB/API groups passed with zero skips: ingest
replay and generic memory-service fairness/privacy. The disposable database had
zero CY schemas left; its owned process, localhost listener and both temporary
directories were independently verified absent after cleanup.

Fifteen JSON manifests/fixtures and twelve changed JavaScript syntax checks
passed; whitespace checks passed. Independent source/test/document review found
no material issues, including the additional historical source-guard adapters.

The first full runner pass found three additional whole-prompt byte guards that
needed the same exact pinned dream-only reversal; these were test expectation
updates, not runtime failures. The fresh complete serial run then passed
1088/1088 across 153 runner test files, zero failures/skips, in 184.781 seconds.
The expanded focused run took 33.847 seconds; the two isolated API groups took
64.582 seconds. Final logs remain in the private task outputs directory as
`dream-cue-full-runner-20261031-final.log`,
`dream-cue-focused-runner-20261031-final.log` and
`dream-cue-integration-20261031.log`.

Ready for rollout review, not merged or deployed. Deterministic tests establish
boundary and preservation behavior, not post-rollout real-model dream quality.
