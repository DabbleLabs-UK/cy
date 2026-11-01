# Explicit writer-role output boundary

Base: production `3aabfa46af783dcadf52945efce176b3c6c2f18e`.
Branch: `fix/journal-writer-role-boundary-20261101`.

## Evidence and cause

The retained 31 October 2026 17:11:21 UTC journal generation (seq 3210759)
contains `Please respond as Cy would write.` after Cy-like prose. Its initial
validation passed without repair; raw/surviving counts were both 89, with no
recorded scaffold removal. It published and appears in the retained 18:22:29
continuation. Neither the retained input nor relevant prompt builder contains
that exact request. Collection appends provider response tokens; sanitation and
publication do not invent this sentence. The evidence supports an initial
Ollama-generated instruction, not a repair-generated or application-added tail.
The original complete provider transport response was not separately retained;
the fixture labels the retained accepted output accurately, not as raw transport.

The old shared task detector requires narrower action/artifact constructions.
It misses this role-imitation grammar, so final validation and feedback
sanitation also accept it. Continuation faithfully repeats accepted text; there
is no separate continuation insertion defect.

## Rule and boundary

Only `runner/warden.js` changes at runtime. A new pattern in the existing
reported-instruction-aware task bank requires:

- An imperative authored-output action: respond/reply/answer/write/compose/
  generate/produce, optionally with a bounded output object.
- An explicit Cy imitation relationship: as Cy would/might/does write or speak;
  as if/though the addressee were Cy; a bounded `as Cy` role; or Cy's voice/style
  or the voice/style/role of Cy. Possessive continuations such as Cy's solicitor
  or mother are not mistaken for Cy's identity.
- An output/sentence/existing clause edge. An unpunctuated newline alone is not
  enough for an unqualified imperative: that position requires a polite request
  or explicit task/writer/assistant label. An attached preceding `to` remains
  an infinitive, including CRLF and polite continuations. Existing attached
  in-world reporting remains exempt; it cannot excuse a later independent task.

This is deterministic grammar, not model-based or fuzzy semantic classification.
Plain references, first-person experiences and self-talk remain valid. In
particular, `Keep going...` remains accepted, even after unexplained residue.
An ambiguous unqualified `cell went quiet\nWrite as Cy.` also remains outside
the new rule. This is intentionally conservative, not an exhaustive classifier.

## Publication and feedback

Initial and repair candidates use the existing shared validator. A bad initial
candidate gets the existing one clean repair from the original prompt; two bad
candidates become silence. No contaminated prefix is published as salvage.
The actual held journal pipeline rejects before text enqueue, context append,
Soma expression feedback, occurrence bookkeeping and expression-memory input.
Truthful private inference, termination and spend accounting remain intact.

The shared historical-context sanitizer removes identified task tails from
derived continuation/recent expression and Cy-expression source projections.
It does not rewrite public history or durable memories. Clean accepted prose
continues through the existing publication and feedback path unchanged.

No prompt, cadence, provider, token limit, retry policy, formation policy,
retrieval behavior, new data field or store is introduced. The data-handling
manifest only clarifies the existing rejection and derived-context semantics.
Other waking prose surfaces use the same explicit-task boundary; ordinary
postcard replies remain valid. Drawing, dreams, AWG and yard code are unchanged.

## Deliberate exclusions

`|{...}`, `|{}|`, escaped-newline residue, opaque codes and bare `Keep going...`
are neither classified nor repaired here. Rejected raw candidates elsewhere
prove that the provider can emit brace residue, but do not establish its
original protocol/schema source or distinguish feedback copying from original
generation. No brace, pipe, code or literal-sentence blacklist is added.

BRACE/CONTROL RESIDUE: CAUSE INSUFFICIENT - NO REPAIR.

## Validation

Deterministic tests pin old acceptance of the natural example, current rejection
without relying on braces, close grammar variants, ordinary/self-talk/reported
speech controls and unchanged excluded residue. Actual runtime collection,
repair, publication, bookkeeping and memory-admission bodies execute with fake
providers and in-memory sinks: two contaminated calls create zero public,
continuation, expression, memory or cadence effects; clean stop/complete-length
results publish exact authored bytes with one call. Existing repeat, angle,
termination, finalization and memory tests remain part of focused validation.

Older whole-source byte guards reverse only the exact hash-pinned detector
addition before performing their existing comparisons. Unrelated differences
remain visible. Source and test review found and corrected a multiline
non-imperative false positive before acceptance.

Final validation passed 208/208 focused tests and 1134/1134 full serial runner
tests across 154 files, zero skips/failures (15.367 and 77.146 seconds). The new
coverage adds 44 boundary tests plus two actual-runtime integration tests.
Seven PHP scripts passed: implementation registry, environment events,
autobiographical origin/retention, generic memory service, postcard inference
and journal queue liveness. Two isolated MariaDB/API groups passed with zero
skips: ingest replay and generic memory fairness/privacy, in 30.190 seconds.
The owned database PID145952/localhost port61563, all CY schemas and both
disposable database/API temporary directories were verified removed.

Seven changed/new JS/MJS files passed syntax checks; all 102 tracked/new JSON
files parsed; whitespace and offline self-test checks passed. Existing source
guards retain the unchanged prompt, call budget, memory boundaries and journal
finalization/termination behavior. The initial sandboxed full run encountered
test temporary-file rename and localhost-connection denials, and sandboxed DB
initialization was refused; reliable reruns used explicitly scoped offline
test execution and owned disposable state, not application changes or retries
against production.

Final independent source/test/document review is clean. It separately verified
the corrected multiline/CRLF controls and exact base reconstruction by the
hash-pinned adapter. No branch merge, deployment, production state change or
real inference occurred. Ready for rollout review, not a production claim.
