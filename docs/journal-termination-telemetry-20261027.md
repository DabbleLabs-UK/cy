# Private waking-journal termination evidence

Base: production lineage aca4c404cf95f4597234a72ce96365c4adb7b50e.
Branch: fix/journal-termination-telemetry-20261027.
Implementation only; no merge, deployment, restart, real model call or forced
production activity is authorized by this task.

## Existing path and reliability

1. Ollama `/api/generate` supplies a terminal NDJSON object. The provider passes
   its native `done_reason` unchanged. `readNdjsonStream` passes that object to
   `onDone`; each `collectCandidate` invocation retains it as `stats`.
2. DeepSeek supplies SSE `choices[0].finish_reason`. Its existing adapter copies
   that value into both `done_reason` and `finish_reason`. If none arrives, it
   synthesizes `stop`. That fallback remains unchanged for compatibility, but
   must not be mistaken for provider-confirmed completion in diagnostics.
3. `journalTerminationEvidence` already reads the supplied reason for final
   publication validation. Explicit `length` alone enables its existing
   conservative ending check. Token count alone does not enable that check.
4. `collectCandidate.finishRequest` finishes its existing coordinator lease.
   The private `inferenceStats` projection retains token counts and durations,
   but drops finish reasons. Finalization outcomes already retain termination
   evidence for candidates reaching that stage; they do not cover every initial
   or repair request, early rejection or interrupted request.

Thus there is reliable provider termination metadata where actually supplied;
there is not reliable metadata for every request. `stop` means a provider stop
(including EOS or configured stop), not proof of semantic completeness. An
absent terminal object, missing reason or unrecognised reason remains unknown.
The historical below-cap endings `cos...`, `durin` and `b4` are not thereby
established as truncation defects, and historical records are not reconstructed.

## Minimal addition

Each acquired waking-journal request, including the existing repair attempt,
adds one best-effort record through `recordInferenceDiagnostic`, after existing
request cleanup. The same private `runner/state/inference-requests.jsonl` and
existing `[cy-infer]` stdout diagnostic receive it:

```json
{"schema":"cy.inference-request.v1","event":"journal-termination","id":"infer-N","at":"ISO timestamp","termination":"length"}
```

`termination` is only `stop`, `length`, `other` or `unknown`:

- Ollama requires its native `done_reason` on an actual terminal object.
- DeepSeek requires a reported native `finish_reason`. A journal-only internal
  boolean records whether that reason actually arrived, distinguishing it from
  the adapter's legacy fallback. Non-journal adapter output is unchanged.
- Classification reuses the unchanged finalization evidence helper; conflicting
  native and helper-selected fields fail to unknown rather than asserting a
  reason different from finalization. Known DeepSeek filter/tool/resource endings
  map to `other`; future unrecognised values map to unknown.
- Missing/count-only metadata never becomes length evidence. No text is examined
  by this diagnostic. Cancelled or rejected requests may have terminal metadata;
  always join their existing end/outcome records before inferring publication.

The existing request ID links to `max_output_tokens` and `output_tokens` already
present on private request-end records. No second token counter or tokenizer is
introduced. No raw reason, candidate, prompt, hidden reasoning, provider payload,
new recipient, public event, store or retention policy is added. The adapter's
source-presence boolean is not rendered by the explicit public generation stats
projection. No schema migration or historical rewrite is needed.

The new recorder catches synchronous sink/metadata failures and asynchronous
sink rejections. Existing asynchronous append failure handling is retained. A
missing diagnostic is missing evidence, not a reason to change a journal.
This is not a durable transaction or a guarantee of logging across a crash.

## Behavior intentionally unchanged

Network requests, options, model/provider selection, 93-token allowance, bounded
repair/retry, Tempo, cadence, prompts, acceptance, finalization and publication
are unchanged. No ending heuristic is added. A normal/unknown below-cap fragment
has precisely its prior treatment. Explicit-length incomplete text still fails;
the complete natural cap-hit question remains eligible. Rejected journals still
create no public prose, continuation or downstream expression feedback; accepted
continuation still receives exactly published bytes.

Runtime files: `runner/run.js`, `runner/provider.js` and new
`runner/journal-termination-telemetry.js`. Matching privacy metadata is documented
in `docs/data-handling.json`. Existing source-pinning regressions permit only the
literal telemetry insertion and source-presence marker; a new whole-file test
pins their inverse against the exact production base. Character-output, warden,
prompt, coordinator and memory/API implementations remain byte-identical.

## Validation

- Focused journal/provider/angle/memory/drawing-isolation regressions: 160/160
  passed, zero failures/skips, 13.363 seconds, on the final reviewed code.
- Full serial runner suite: 908/908 passed, zero failures/skips, 143.577 seconds.
- Four existing isolated PHP/MariaDB integration suites: 4/4 passed, 95.158
  seconds. These cover journal liveness/status round trip, formation delivery,
  formation inference accounting and associative recall. The exclusively owned
  disposable database was confirmed stopped. No real provider call occurred.
- All eight PHP memory regression scripts passed.
- Changed/new JavaScript syntax checks, all 100 tracked JSON parses and whitespace
  checks passed.
- Deterministic fake streamed provider responses cover normal/length/absent and
  fallback reasons, unchanged request bytes and call counts, actual stream
  decoding, actual request cleanup, no diagnostic content, and nonfatal sinks.
  Actual journal publication bodies demonstrate invariant acceptance, public
  bytes and exact feedback for unknown/normal/length cases and failed logging.
- Independent read-only review initially requested strict native-field evidence
  in the diagnostic. That tightening is applied and regression-tested; the final
  rereview returned looks-good with no remaining material finding. Finalization's
  existing generic evidence behavior was deliberately not changed.

Ready for separate rollout review. Successful instrumentation tests do not
explain old missing termination reasons or prove future natural journal quality.
Natural post-deployment records, if later authorized, can answer that question.
