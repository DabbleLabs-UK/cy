# Journal verbatim-repeat exposure repair

Base: deployed production `1dc609d2116c0035735c312e69bc64bec0e7c52f`.
Branch: `fix/journal-repeat-exposure-20261025`.
No merge, deployment, restart, production state mutation or model inference.

## Exact boundary

Previously, `streamGenerate` passed the saved buffer to `isRepeat`. That helper
compared the first 240 normalized candidate characters against the last 400
normalized buffer characters. Journals instead exposed the newest word-aligned
at-most-520 raw characters, selected by `selectJournalContinuation`.

`buildPromptRequest` now selects that continuation once, uses it in the unchanged
prompt renderer, and returns the same string as ephemeral `journalContinuation`
metadata. The existing string-returning `buildPrompt` interface remains available.
The main journal call carries the metadata through generation and character
repair. Each existing near-repeat retry constructs its own request/exposure pair.
Acceptance does not query the current buffer again or reconstruct another slice.

Immediately before the existing pre-publication repeat-rejection branch,
`isJournalRepeat` checks the complete sanitized/scaffold-accounted candidate
against the complete carried continuation. It reuses `isRepeat`, setting only
the candidate/context window lengths to Infinity.

Normalization remains lowercase ASCII alphanumeric words with punctuation folded
to spaces. The substantial-copy rule remains any exact run of **40 normalized
characters**. Minimum-length protections are unchanged. This is not fuzzy or
semantic similarity detection and does not reject a topic merely for recurring.

Non-journal callers and within-burst checks retain their previous default
windows/rules. A null/missing exposure retains the legacy fallback; an explicitly
empty journal exposure compares against nothing, not unexposed saved history.

The existing repeat result, logging, accounting and two-discard retry cap are
unchanged. Rejected output never reaches the existing chunk publication/feedback
path. The repair does not add a model call or new retry stage, although catching
more repeats may exercise existing retries more often.

## Natural regression evidence

The JSON fixture contains four retained published outputs and the trailing
at-most-900 characters of their saved buffers. This preserves both relevant old
and new views without copying unrelated prompt/world/memory material. Exact
equality with the original audit export was verified offline.

| Public sequence | Retained BST timestamp | Old guard | Repaired guard |
| --- | --- | --- | --- |
| 2894968 | 23 Oct 12:36:18.410 | Pass | Reject |
| 2909130 | 23 Oct 21:30:43.098 | Pass | Reject |
| 2910793 | 23 Oct 22:33:34.950 | Pass | Reject |
| 2939517 | 24 Oct 16:49:49.897 | Pass | Reject |

The candidate-window cases copy after/crossing normalized position 240. The
other case copies material shown in continuation but outside the old normalized
last-400 window. All use the unchanged 40-character threshold.

Offline replay of the original 50 accepted journal records:

- Old guard flags: **0/50**.
- Repaired guard flags: **4/50**, exactly the four known misses above.
- No other decisions change in that fixed replay.
- No history is edited. No replacement output or natural quality improvement is
  predicted by this validator-only comparison.

Source export SHA-256:
`4f99cf14a0463c5c41244434b0a3531c351b9586136af4cfde639a8c6b1329f1`.
The parent workspace retains the 50-row replay decisions and original audit data.

## Preservation and tests

Tests execute the actual pre-publication guard and existing bounded retry loop
with canned candidates, not a parallel implementation or real provider. They
cover opening/late copies, exposure-window mismatch, all four natural fixtures,
39/40-character boundaries, normalization, short common phrases, materially
different wording about the same concern, absent exposure, no unexposed-history
matching, prompt/exposure identity, later buffer changes, repaired candidates,
ordinary acceptance, repeat-cap silence and success after an existing retry.

All prompt modes are byte-compared with production for representative contexts.
No model-facing instruction, continuation content/limit, subject selection,
memory retrieval, parser/sanitizer, output allowance, sampler, cadence or chooser
changes. Private drawing and the food-retirement scheduler remain byte-identical.
The existing drawing regression permits exactly the intended stream signature
and repeat-condition diff while still comparing the rest of that function.

No new collected/persisted/sent data or data-handling policy change: exposure is
an ephemeral reference to text already supplied in the same existing request.
There is no new storage subsystem, public interface or world mechanic.

Independent final review: looks-good, no material findings; re-review also cleared
the explicit repair/null-exposure coverage and narrowly adjusted drawing assertion.

Final validation:

| Validation | Result |
| --- | --- |
| New exposure regressions | 22/22 |
| Combined focused journal/boundary/drawing/food-retirement tests | 126/126, 4.150 seconds |
| Full runner suite | 788/788, 126.737 seconds |
| Changed JavaScript syntax | Pass |
| All 98 tracked/new JSON files, including manifests | Parse successfully |
| Whitespace / added non-ASCII punctuation checks | Pass |

No failures, cancellations or skips in the final runs. These are correctness
checks, not a performance comparison. The first sandbox runs encountered denied
atomic renames in its redirected TEMP directory and denied connections to the
tests' own random-port loopback servers. Disposable workspace TEMP resolved the
filesystem restriction; the final full suite used the same workspace TEMP with
the loopback test connections allowed. No real model/server was used. An old
drawing assertion also required the whole stream function to be byte-identical;
it was narrowed to permit exactly the intended diff, not removed.

Parent-workspace evidence SHA-256:

| File | SHA-256 |
| --- | --- |
| journal-repeat-exposure-focused-workspace-temp.log | 93d50140e3f17a7e3143e5308115263be5141a3a129f04081f2e51f7c8420390 |
| journal-repeat-exposure-full-verified.log | bc0295e8231387dec2a5786d43cb83b6a4ba1c1bafb4f52696dfc03773650311 |
| journal-repeat-exposure-replay.json | 7ac997c1edd846502102925b6f7b407d231e168465af377a4c0c60902274de84 |

Ready for a separately authorized rollout review, not deployed natural-quality
evidence. Only `runner/prompt.js`, `runner/warden.js` and `runner/run.js` are
runtime changes; the other files are regression coverage, fixtures and this note.

## Limits

This closes the demonstrated window mismatch, not short paraphrased refrains or
every form of thematic fixation. It does not address malformed endings, memory
readiness or journal architecture. The four natural fixtures preserve historical
malformed characters and now-retired food/property references as evidence only.
No historical journal or continuation state is rewritten.
