# Final review: rollout blocked by retention crash replay

Candidate runtime: `7d27223cdab7a00b308be0285028db767a88fb54`.
Production remains `76cfd0285d95cf5ecaa130c074da05dc4b3902b2`.

The independent binding review found the null-object, latest-search fallback,
cross-search binding and stale-object defects repaired. Correct object handover
and retention work and the committed search receipt prevents ordinary replay.
Generic search cadence and unrelated officer scenarios are unchanged.

However, the explicit requirement that restart/replay cannot duplicate either
outcome is not satisfied across the publication/checkpoint boundary.

## Reproduction

Run `node runner/dev-search-property-crash-replay.mjs`. It uses only disposable
synthetic state, the actual runner resolver extracted from run.js, actual
sectioned save/load, and the actual client's network-free dry-run delivery.
No production data, provider, model, clock change or server is used.

1. Checkpoint a valid live search, canonical object and pending retention.
2. Execute the actual resolver. It publishes/enqueues the world record and public
   outcome, empties pending, and sets the in-memory property_action receipt.
3. Flush delivery, then simulate a crash before the later checkpoint.
4. Reload the pre-resolution checkpoint and execute/flush again.

Observed: two retained world records and two public outcomes for one search,
object and opportunity, with two world IDs and four different delivery IDs.
The old checkpoint has no property_action receipt. Retention does not change
object revision, so startup world-mirror reconciliation cannot fence the repeat.

The normal resolver does not await saveVitals before enqueueing. The central
emit function mints a new delivery ID. The independent two-second client flush
can publish during a later await before checkpoint completion. Retention itself
does not even mark urgentVitalsDirty; later search advancement normally does,
but it is not a commit-before-publication barrier. Therefore this is a reachable
crash window, not merely a manually duplicated committed pending receipt.

## Validation and decision

- 70/70 focused regressions pass on the local no-ff integration tree.
- 721/721 full runner tests pass, zero failures/cancellations/skips.
- Runtime/test syntax, manifest JSON and whitespace checks pass.
- Additional adversarial crash diagnostic reproduces the missing guarantee.
- The existing checkpoint regression saves the applied receipt before recovery;
  it does not cover a delivered outcome followed by pre-receipt recovery.

Local integration merge `a56b7957f0f5e47a925c22c13ef3d3432650e134` was prepared
for testing only. It was not pushed to production and nothing was deployed.
No runner restart, historical rewrite, production state mutation or inference
was performed. Read-only pre-deploy health found one runner (PID 4824), normal
11434/11435 listeners, Ollama 0.34.1 and healthy arbiter. A read-only mirror query
used the wrong ID column and failed before returning rows; it performed no writes.
No deployment or natural-evidence cutoff exists for this rejected rollout.

Smallest repair boundary: the existing search-property resolution needs its
receipt, consequence and stable identified publication staged atomically in the
existing checkpoint before delivery, with recovery replaying delivery rather
than re-running the consequence. Reuse established checkpoint/outbox conventions;
do not create a general transaction framework or change search behavior. Add a
crash-after-delivery/before-ack regression for retention and handover. An urgent
dirty flag or an unawaited save alone does not close this window.

This review adds only the offline diagnostic and evidence. Runtime is unchanged.
