# Journal mechanical-truncation and final-publication boundary

Status: source-only fix; no merge, deployment, restart, journal or model inference.

Base: verified remote production lineage `6967e092a81ec5095320ebb8378cee84acf0c458`.
Branch: `fix/journal-finalization-20261026`.
The separate local production-lineage ref contained unrelated unpublished work;
it and all existing worktrees were left untouched.

## Old and new behavior

Previously, full candidate validation preceded `SentenceBuffer.flush`.
`finishTokenLimitedTail` could delete the last whitespace-separated token and
append synthetic dots when either a provider reason or token count indicated
a limit. Per-chunk publication did not repeat the full candidate validation.

The buffer now returns literal text. The synthetic-tail helper is removed;
no consumer can delete a word or add dots through that buffer. The new
completion policy is journal-only; provider settings and requests are unchanged.

Journals pass the existing chunk filters, separators and within-burst repeat
checks into a private staging string, without emitting prose or saving context.
Final trailing whitespace is trimmed before validation, matching the existing
feedback normalization. The exact resulting text must pass the full existing
candidate validator and be unchanged by `sanitizeCharacterContext`.
Non-idempotent text fails closed instead of being rewritten into acceptance.
An accepted journal is committed once through the existing publication edge,
then that same text is appended through the existing context function. A
publication exception cannot append that unpublished text. This is the existing
runner emission/enqueue boundary, not a new server-acknowledged transaction.

Staging preserves the existing chunk filter and within-burst repeat decisions.
The publication changes from multiple text chunks to one already-held journal
text event. The rendered wording is unchanged apart from existing whitespace
normalization; there is no new word deletion, punctuation insertion, sentence
salvage or model call. Non-journal callers retain their original chunk path,
with literal buffer flushing rather than invented cutoff punctuation.

## Termination evidence and limits

`journalTerminationEvidence` reads `done_reason` or `finish_reason`, when supplied
by the current completed generation. Only an explicit `length` reason activates
the length-completion check. A token count of 93, absent reason, normal `stop`,
or explicitly non-final stats does not establish length termination.

For explicit length termination, both the original candidate and final staged
publication must end in a word/number followed by terminal `.`, `?` or `!`, with
optional closing quotes/brackets. Trailing ellipses do not establish completion.
If this conservative surface condition fails, the whole journal becomes silence;
no complete-prefix salvage or extra repair is attempted. Ordinary fragments are
not subjected to this rule when termination is unknown or a normal stop.

This is a bounded surface-completion check, not proof of semantic completeness.
It cannot establish that every punctuation-ended thought is coherent. It also
does not diagnose unknown below-cap endings or infer a matched stop sequence.
The DeepSeek adapter already projects provider finish reasons into stats; its
fallback `stop` is not independent proof of a naturally completed thought.

Existing count-derived `token_limited` telemetry remains available but does not
control the new acceptance decision. Existing private inference outcomes now
record final validation reasons and supplied termination reason/null, without
body or prompt logging. The data-handling manifest documents that small addition.

## Natural fixtures

`runner/fixtures/journal-finalization-natural-20261026.json` contains the three
actually retained raw repair candidates and their historical published forms:

| Sequence | Raw ending | Former damaged ending |
| --- | --- | --- |
| 2905496 | `<banged up for the night` | `<banged up for the...` |
| 2935053 | `wonder why bill asked fer` | `wonder why bill asked...` |
| 2980428 | `hows it even` | `hows it...` |

Buffer replay preserves all three raw strings. Explicit-length test metadata
causes their incomplete endings to fail closed with no text, continuation save
or Soma output feedback. Their historical provider reasons were not retained;
tests do not pretend to reconstruct them. Missing reasons do not become a new
heuristic veto, and the separate unclosed-angle gap intentionally remains open.

The complete 93-token question from sequence 2944437 remains eligible under
explicit length, normal stop and count-only metadata. Its fixture is labelled
published text, not an invented original raw provider response.

## Tests and review

| Validation | Result |
| --- | --- |
| New finalization regressions | 24/24 |
| Focused journal/publication/provider/drawing/abort tests | 130/130 |
| Full runner suite | 812/812 |
| JavaScript syntax, all runner files | 216 files pass |
| Tracked/new JSON, including manifests and fixtures | 99 files parse |
| Whitespace validation | `git diff --check` passes |

The focused run covers the three natural raw endings, explicit length failure,
the complete cap-hit question, final validation after chunk filtering, no rejected
feedback, actual `appendContext` behavior, nested entities, word separation,
publication failure, ordinary slang/fragments, unchanged prompt bytes, unchanged
bounded character repair/repeat retry loop, and immutable historical fixtures.

An independent read-only review found a publication/feedback mismatch in the
first draft: continuation could decode a nested entity differently. The final
implementation fails closed on that mismatch, tests the real context body, and
commits a validated journal once. The reviewer reread the applied refinement and
returned `looks-good`, with no remaining material findings. Tests were executed
by the implementation agent, not claimed as reviewer execution.

Initial sandbox runs encountered disposable-file rename restrictions and blocked
loopback mock transport. Workspace-owned temporary files resolved file access;
the final complete suite ran with narrow escalation for ephemeral mock servers
and passed in about 33 seconds. Those servers are test fixtures, not Ollama.
No production endpoints, model requests or production state were used.

## Files and rollout boundary

Runtime files: `runner/run.js`, `runner/character-output.js`, `runner/warden.js`.
Tests: `runner/journal-finalization.test.js`, its natural JSON fixture,
`runner/boundary.test.js`, and the existing drawing isolation source-pin test.
Documentation: this file and `docs/data-handling.json`.

The drawing source-pin adjustment permits only the separately tested journal
finalization block/literal flush in addition to the already-approved repeat fix;
the rest of collection, drawing separation, context and Tempo remains pinned.

No changes to prompts, style, 93-token allowance, provider/sampler, cadence,
subject selection, 520-character continuation selection, memory, historical
journals, the separate angle-prefix gap, or global pipe policy.

Ready for a separate rollout review. Do not merge/deploy under this task.
Future rollout verification should confirm exact reviewed source and normal
runner health without forcing a journal or inference. Natural evidence should
distinguish explicit-length rejection from metadata-unknown fragments; lack of
metadata must remain visible rather than being relabelled as certain truncation.
