# Private drawing subject boundary

Candidate only, based on production merge
`227b294ef411fa2b9e7125fb44f63420c71050c6`. No merge, deployment or restart.

## Defect and boundary

The 23-25 October natural sample contained 18 genuine draw choices, 12 ordinary
interruptions, six completed intent calls, five rejected prose subjects and one
actual drawing. The old first call was journal-mode `streamGenerate`: the fixed
reflective system, ONE_SUBJECT and full prose buffer surrounded a naming cue.
Shared prose screening published its surviving diary text and appended it to
continuation before the six-word subject check. The misleading log then called
that failure missing strokes even though no stroke request had run.

The first call is now private `rawGenerate`, still purpose `drawing` and attempt
`drawing-intent`, using the existing active provider, sampler, 40-token allowance,
foreground ceiling, Tempo, coordinator, shared arbiter and visible cancellation
slot. It uses the existing native JSON-schema transport. No repair/replacement
call or new creative selector is introduced.

The sole response property is:

```json
{
  "type": "object",
  "properties": { "subject": { "type": "string", "minLength": 1, "maxLength": 60 } },
  "required": ["subject"],
  "additionalProperties": false
}
```

The complete returned field must pass before the unchanged DSL call can start:
at most six words and 60 characters, one naming phrase, no newlines, sentence/
control punctuation, extra fields or obvious first/second-person reflection.
Ordinary names with a title abbreviation are supported. Outer whitespace is
trimmed; prose is never truncated, mined for a noun, stripped into acceptance or
replaced with "the same shape again". This is a small naming/format boundary,
not a general semantic world-fact verifier; a short but inappropriate noun phrase
can still pass. Rehearsal is needed to measure actual subject usefulness.

## Prompt/context before and after

Before (representative source structure, not a retained exact natural prompt):

```
SYSTEM: You are writing ... the running commentary of your own head.
TONE - JOURNAL ... train of thought ...
PROMPT: [full previous prose buffer, potentially 4600 characters]
ONE THING ... stay on it for this whole entry ... a man thinking ...
[shared sources including recent expressive prose]
FORM ... NAME the concrete thing ... do NOT keep the journal going ...
```

After (synthetic deterministic fixture only):

```
SYSTEM: Select a concrete subject for Cy to sketch. This is private drawing preparation.
[existing character knowledge boundary, not the journal system or roster]
Return only a JSON object with one field: subject.
It names one drawable thing, view or visible action.
Use at most 6 words and 60 characters.
Plain naming, not a sentence, explanation or reflection.
```

```json
{"sources":[{"origin":"WORLD FACT","uncertainty":null,"content":"Cy is in CELL; movement is restricted."},{"origin":"OBSERVED BY CY","uncertainty":null,"content":"Cy heard the meal trolley outside the cell."},{"origin":"SUBJECTIVE MEMORY","uncertainty":"fallible recollection","content":"Cy remembers the yard gate."}],"requestedSubject":null}
```

The broker's existing policy, source budgets and privacy filtering run first.
Only selected current state, grounded soma, recent events/impressions and eligible
autobiographical memory are projected, retaining origin and uncertainty. Canonical
source IDs remain in private broker inspection, not model-facing naming material. Drawing
does not call journal `buildCtx` or consume its one-shot prose directives. No raw
context buffer or `recent_expression` section enters the request. Recent world
history, incident context and selected memory provide relevant source material
instead. Broker failure stops the attempt rather than falling back to raw prose.

## Public/feedback safety and preservation

Subject preparation has no `streamGenerate`, `onChunk`, `appendContext`,
`observeOutput`, public `text` or expression-memory enqueue path. Rejected,
transport-failed and interrupted intents return empty/aborted, never emitted.
Even a valid subject is not published as prose. Only the existing successfully
validated drawing can emit `draw` and `draw_saved`.

The old six-word/prose-intent helpers remain legacy diagnostic compatibility
exports only; the live path does not use them. Existing journal continuation
tests for those helpers do not establish production drawing semantics.

The genuine journal/draw chooser, cadence state machine, model/provider, sampler,
journal generation, journal continuation, geometry parser, DSL prompts/options,
pass construction and successful artifact format are not changed. A downstream
geometry failure now correctly ends empty rather than counting a preparatory
line as public prose. Private-subject paid usage, if configured, is not labelled
as published prose. No history is rewritten.

## Private diagnostics

The existing private inference JSONL ledger records:

- `subject-selection-failure`: parser reason, provider failure or context unavailable;
- `interrupted-before-subject` / `interrupted-during-subject`: actual model-start
  boundary and cancellation reason, not an inference from request creation;
- `subject-accepted`;
- `downstream-drawing-failure`: empty DSL or unusable strokes.

It adds no raw subject, prompt or memory text to that ledger. Existing request
IDs/provider timings and optional owner-only prompt logging remain available.
Technical diagnostics are not narrative events.

## Rehearsal boundary

No real model calls were made. The existing `runner/drawtest.js` borrows its
configured Ollama endpoint and runs the obsolete prose-intent wrapper plus DSL;
it is not an isolated paired comparison of this production boundary. Existing
hardened LENO packages are pinned AWG experiments, not a prepared drawing
comparison. They were inspected but not altered or launched. Building a new
paired harness or borrowing the shared production listener would exceed the
request's readily-available rehearsal condition. No Feddit pause/update hold,
model unload or inference server start occurred. Deterministic regressions are
not presented as evidence of real-model efficacy.

## Validation

- New boundary suite: 38/38 tests pass. These execute the actual extracted
  `doDraw` and `rawGenerate` bodies with isolated dependencies, not replacement
  implementations. They cover rejected/error/empty/context-failed intents,
  interruption before/during inference and during awaited spend/lease cleanup,
  zero publication/continuation/observation/stroke calls on failure, and the
  unchanged DSL/artifact path on valid input.
- Combined focused boundary, shared-context, character/soma, journal, chooser,
  inference wait and cancellation checks: 106/106 pass, 8.191 seconds.
- Full runner suite: 746/746 pass, 73.483 seconds, no failures, cancellations or
  skips. These timings are not a performance benchmark.
- Syntax, data-handling JSON and whitespace checks pass. Executable journal,
  postcard, stream validation and Tempo functions are compared byte-for-byte
  against the deployed base after line-ending normalization. The downstream DSL
  path comparison permits only the truthful empty return when no picture or
  preparatory prose was published.
- The first compatibility run found two static expectations explicitly requiring
  the old public prose-intent call/log. They now assert the private raw call and
  fail-closed subject result; journal protections were not removed or weakened.
- Independent review caught an abort window during awaited accounting/lease
  cleanup and unnecessary model-facing canonical source IDs. Both were corrected
  in this boundary with targeted regressions. Re-review: looks-good, no remaining
  material findings. No implementation changes followed the passing full suite.

Parent-workspace log SHA-256:

```
drawing-subject-focused.log
a89d963c9932ce74f35a80bed8155076c6c5c9fc38e8b9af5edb4f3001c26c62
drawing-subject-full.log
3e9eebed81333255926ccbd3e6d449ab91b55e5eda89dee48289ffc06fad10d3
```

The candidate is ready for rollout review, not an empirical claim that the local
model now selects useful subjects reliably. A later isolated real-model check or
separately authorized natural deployment evidence must establish that behavior.
