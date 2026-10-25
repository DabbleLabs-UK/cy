# Retired legacy property handover/retention scenario

Candidate only; no merge/deployment/restart/inference. Built cleanly from remote
production `76cfd0285d95cf5ecaa130c074da05dc4b3902b2` on
`fix/retire-property-handover-20261025`.

## Boundary

- Removed the `cell_search_handover` definition and both authored property
  outcomes. Generic `officer:search` therefore has no instrumental branch.
  The existing ordinary officer-search fallback is unchanged, not a new substitute.
- Staged PROPERTY_RESULT still inspects the existing available object or records
  NOTHING_FOUND, but no longer offers HAND_OVER_OR_WITHHOLD. Its runner and offline
  soak callers no longer open that branch.
- Removed the legacy latest-search mutation helper and the runner's associated
  custody transfer/incident/publication block. No unrelated object helper changes.
- Recovery's existing active-definition validation drops retired pending work.
  Dispatch also drops raw legacy entries; direct resolution returns null. No
  property outcome, replacement scenario, search/object mutation or cancellation
  world event is invented. The next ordinary checkpoint saves the filtered queue.
  Repeated crashes before that save only repeat harmless filtering.
- Unrelated pending work and its round-robin counters remain valid. No schema
  migration, provider change, new IDs, receipt or outbox are needed.

The lost behavior is only the engineering-selected demand/handover/withhold and
its branch-specific transfer, confiscation or retention. Searches still begin,
instruct Cy, progress, inspect existing objects, complete and record aftermath.
Search probability, minimum stage interval, movement restrictions and officer
selection remain unchanged. Canonical object lifecycle and world mirror code
outside this branch are byte-identical to the production base.

## Abandoned repair work

The old `fix/search-object-binding-20261024` worktree at `67d1864` is preserved
unchanged, including uncommitted runtime experiments and adversarial evidence.
This branch does not contain its private resolution envelopes, property outbox,
new Client enqueue method, commit/exposure barriers or mirror recovery changes.
Its binding/resolution machinery is unnecessary when the scenario cannot run.

The new diagnostic retains the original failure orders as positive controls,
using git-pinned production code and private synthetic checkpoints. It executes
the actual old/new runner dispatcher, not a replacement resolver. Old property
work rewrites an unrelated completed Bailey search and publishes again over two
restarts; retired work produces zero canonical/public outcomes with objects and
search history unchanged. No network transport or model is invoked.

Commands:

```
node --test runner/retired-property-handover.test.js
node runner/dev-retired-property-replay.mjs
```

Existing historical rendering/Soma fixtures and historical correction tools are
retained. This does not erase false events already published, historical memories
of them, or already queued delivery payloads from an older process. It prevents
new openings and pending-resolution replay. Rollout should use the normal guarded
stop/checkpoint/restart; never restore old state over later production activity.

## Validation

- Focused retirement, instruction/social, ordinary search, restart/checkpoint,
  object lifecycle and mirror suites: 60/60 Node test results pass, no failures,
  cancellations or skips; 7.409 seconds.
- Full runner suite: 708/708 pass, no failures, cancellations or skips;
  36.950 seconds. Timings are not a performance benchmark.
- Four old/new positive-control pairs cover both actions with/without an object:
  old code produces three world/public outcomes and mutates a different completed
  search over the initial process plus two restarts. Retired code produces zero,
  with the search/object/ledger unchanged.
- Changed/new JavaScript syntax, both changed JSON manifests and whitespace pass.
- Independent read-only final review: no material findings. The review checked
  both routes, legacy recovery/dispatch/direct resolution, removals, ordinary
  search behavior and unchanged adjacent mechanics.
- SHA-256 snapshots confirm every dirty/untracked file in the abandoned worktree
  is unchanged from this task's start. Its HEAD remains `67d1864`.

The focused run initially exposed a test assumption of 20-second minimum stages;
the unchanged production constant is 15 seconds, so the new test now uses that
constant. The first full run caught an existing static test expecting four
instrumental admission call sites; three is now correct because the staged
property call is removed. No runtime timing or location gate was changed for
either test correction.

Parent workspace log hashes (SHA-256):

- `retired-property-focused-final2.log`:
  `adaf260caaf792a2da9413588cdc667585455f3391d4f557a209eae687ceaefb`
- `retired-property-full-final2.log`:
  `f1eb1c7d7df074e59948631661a0acc39cc39dbabf498484c4f722a45b0dd315`

No production evidence was manufactured. Future rollout needs only the three
changed runner runtime files plus the changed model-spec metadata if deployed;
tests/diagnostics and documentation are not runtime dependencies.
