# AWG current-context commit boundary

Source baseline: deployed production `8952baf86dc47e86c7536c84b5f390c762086884`.
This is a source-only correctness repair. No production operation or model call
is needed to test it.

## Demonstrated failure

On 28 October 2026, an AWG call started at 08:00:23, Bailey's search began at
08:04:52, and the returned Bill interaction became canonical at 08:05:44. Another
call started in CELL at 10:06:19; association began at 10:15:03; its CELL interaction
was committed at 10:15:18. The caller checked location eligibility before awaiting
inference, but the detached parser/materialiser validated the old snapshot. The
caller subsequently checked mirror readiness, not current eligibility.

## Authority and scope

`awgLocationEligible` is unchanged. A private call-local fence snapshots existing
location ID, entry timestamp, last transition timestamp, regime activity, and the
ID/start/status of current exercise/regime/routine/search/lockdown episodes. The
latest completed search and lockdown identities remain in that authority, so a
restriction starting and ending in CELL does not restore the original fence.
Physical leave/re-entry changes the entry identity. Observation links/counters,
body drift and diagnostic wording are deliberately excluded.

The final guard rereads that authority and the existing manual regime epoch,
effective waking state, running/pause/maintenance and mirror controls. It adds no
new prison eligibility rule. No persistent fence/desire/candidate is added:
restart cannot resume an old call, and shutdown invalidates its return.

## Commit and delivery ordering

The accepted-result path has one synchronous logical commit:

1. Revalidate current authority against admission, with no asynchronous yield.
2. Install the accepted world result and, if applicable, start the existing
   staged search through `startCellSearchEpisode` at the same commit time.
3. Construct canonical records and project Soma/grounded history immediately,
   in occurrence order. Attach the generated-search receipt to that exact search.
4. Hold canonical/public delivery envelopes in a call-local array. Do not admit
   their memory sources yet.
5. Await the existing vitals checkpoint, which includes those in-memory effects.
6. Deliver the same envelopes and admit the same observed records through the
   unchanged memory-source path. Delivery does not observe/register them again.

Canonical and public occurrence timestamps retain the guarded commit time, not
post-checkpoint time. Movement/search progression is never locked or awaited by
inference. A transition after a valid commit is later history, not permission to
start an additional search or re-observe its opening after completion.

Buffering is opt-in only for this caller; normal canonical capture/publication
defaults are unchanged. It prevents an opening delayed by checkpoint I/O from
reopening a subsequently completed real Soma defensive context.

## Stale and unsuccessful results

A stale accepted result becomes REJECTED with `STALE_LOCATION_REGIME`, no created
world-event IDs or thread changes, and no applied candidate. It cannot create
canonical/public events, Soma/social/history changes, expression feedback or
memory-source input. It buys no replacement/repair inference.

Existing private inference/spend/call accounting remains truthful. Attempt cadence
and a rejected run record are retained using the current authoritative world
state, never the detached candidate state. NO_EVENT, REJECTED, FAILED and CANCELLED
also adopt only attempt metadata, so an unsuccessful pre-call snapshot cannot
roll back concurrent live object state. Provider diagnostics are not relabelled
as successful events.

## Limits and unchanged systems

The local delivery array is NOT a persistent outbox. This change does not claim
new exactly-once delivery or crash/checkpoint-failure convergence for AWG. A crash
after a valid commit/checkpoint but before delivery can still lose delivery under
the pre-existing architecture; this task adds no replay subsystem to repair it.
Checkpoint failure does not publish the buffered records or admit their sources.

No prompts, model/options, generation call count, cadence/probabilities, cast
selection, journal/drawing/dream/yard logic, retrieval/formation policy, historical
records, API or database schema change. No additional data fields or content are
collected; existing rejected-run diagnostic fields are reused. The data-handling
manifest remains unchanged.

## Deterministic verification

`runner/awg-current-context.test.js` executes the actual production caller,
canonical capture/publication helpers, parser/materialiser/validator and grounded
Soma consumers with isolated provider/checkpoint/transport doubles. It reproduces
both natural failures against unchanged production source and rejects them with
the repair. It covers leave/re-entry, search/lockdown open-close, manual regime
round-trip, sleep/pause/shutdown, irrelevant changes, checkpoint-delayed movement,
generated search completion during checkpointing, source/delivery ordering,
unsuccessful-result live-state preservation and non-resurrection after restart.

Historical whole-source guards reverse only exact hash-pinned changed AWG
regions/imports and the exact added location helper. Negative tests ensure that
unreviewed changes within those regions fail, while outside changes still reach
the original comparisons. Dynamic journal, memory and yard regressions remain
active and unmodified.

Validation on 28 October 2026:

- 27 new boundary regressions passed, including the unchanged-production controls.
- 162 focused AWG/location/continuity/cancellation/context checks passed.
- Complete serial runner suite: 1,071/1,071 passed, no skips (145.347 seconds).
- Four PHP scripts passed: world simulation, location API, environment records and
  implementation registry.
- Changed JS/MJS syntax, config/model-spec/data-handling JSON and whitespace passed.
- Independent source/ordering/test-fixture review: no outstanding material finding.
- The requested owned disposable MariaDB/API integration run was blocked by the
  execution permission reviewer before starting. No database was created and no
  production access was attempted. This remaining validation gate requires owner
  clarification/approval; it is not reported as a passing integration run.

The candidate is not yet declared rollout-ready while that integration gate is
unverified. No merge, deployment, restart or real inference occurred.
