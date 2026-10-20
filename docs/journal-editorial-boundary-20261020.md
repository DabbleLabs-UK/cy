# Journal generation/editorial boundary

Implementation only, based on production `f0ae8ce`. No inference, merge,
deployment, production-state change or restart is part of this task.

## Evidence and cause

`runner/fixtures/waking-journal-editorial-2026-10-20.json` retains the two
actual accepted natural candidates, their diagnostic sequence IDs and original
validation outcome. Both had 93 output tokens; that limit is not changed.

- 16:52:11.734 BST, diagnostic 2786655, public annotation chunk 2786654:
  `36 words left (and this will end here)`.
- 17:04:22.008 BST, diagnostic 2787007, public annotation chunk 2787006:
  `38 left (<= cy is at cell) [it ends here]`.
- The earlier user-reported regression is retained separately, without inventing
  a timestamp: `3/42 done. Stop here for now. Continue another entry from this point later.`

All three pass the base revision's assistant-frame and malformed-control
detectors. The base checks cover explicit assistant/rewrite/role framing and
malformed control syntax, not these remaining-budget/progress structures.
Ordinary pipes and parentheses are intentionally allowed. Neither normalisation
nor the frontend created the annotation; it was already in the retained candidate.

The 16:08 malformed `im_end`/editorial candidate and 16:34 `Note: I'll be writing
this entry as Cy` candidate were rejected by those existing, different rules.
That did not imply protection against budget/completion commentary.

## Shared boundary and lifecycle

Only `runner/warden.js` changes at runtime. New compositional patterns participate
in `assistantFrameMatches`, used by both publication and feedback:

- Standalone/annotated remaining word, token or character budgets.
- Bare remaining counts paired with a bounded completion/continuation annotation.
- Fractional progress paired with a bounded instruction about the next entry.
- Procedural imperatives or future instructions explicitly constructing,
  continuing or ending a writing artifact.
- Labelled generation progress and explicit entry-completion annotations.

There are no fixed leaked numbers or topic keywords. Ambiguous physical nouns
such as `passage` are not sufficient writing-artifact evidence. Bare quantities,
ordinary quoted stop/continue dialogue, physical endings, legitimate brackets,
pipes and ellipses remain allowed. Wrapped annotation clauses may span lines.

`run.js` buffers a whole candidate before `generateWithCharacterRepair`.
`validateCharacterCandidate` now rejects these frames before chunk publication.
The original grounded prompt receives the existing repair instruction once;
the invalid candidate is not repair input. An invalid repair becomes silence.
No generated candidate is made publishable by deleting just its annotation.
Journal, drawing intent, warden response and postcard validation retain their
existing shared entry points; structured/internal responses are not routed
through a new validator. The existing dream assistant-frame consumer also sees
the extended common detector; its generation path/settings are unchanged.

For already-stored derived context, `sanitizeCharacterContext` uses the same
matcher to keep only the uncontaminated prefix and discard the tainted tail,
as it already does for strong assistant frames. This is context filtering, not
publication salvage. `contextText`, append/load context, selected-memory prompt
filtering, Cy-expression formation sources and queued surfacing context already
call it. There is no reset, migration or historical-public-row edit.

The fixture includes the actual continuation supplied to the second journal:
the first annotation appears there verbatim. Offline tests now remove that
annotation and all later tainted text before continuation selection, while
preserving the source-boundary framing and the 520-character policy.

## Verification

- Twelve dedicated deterministic tests cover actual full candidates, close
  structural variants, ordinary in-world controls, repair/silence, flattened
  context and existing formation/surfacing consumers with mock clients only.
- Regression controls include a physical passage ending, prison work counts,
  appeal-form word limits, ordinary dialogue, brackets, pipes and ellipses.
- Focused suite: 130/130. Full runner suite: 522/522.
- Independent review identified a wrapped-annotation bypass and an ambiguous
  physical `passage` false positive. Both have regression tests and fixes.

Prompt/source organisation, material freshness, ONE_SUBJECT, subjective-tail
budget, model/sampler, 93-token allowance, Tempo/cadence, topic selection and
memory interfaces are unchanged. Only the existing screening decision changes.

## Limits

This deterministic boundary is not a semantic language model or exhaustive
fact checker. Unseen paraphrases without any recognisable writing/control
structure can still escape. An ambiguous statement such as `it ends here` in
ordinary in-world prose is deliberately not forbidden by itself. No remaining
known demonstrated fixture bypass is accepted. Unsupported in-world speculation
and unfinished thoughts are separate issues and are not repaired here.
