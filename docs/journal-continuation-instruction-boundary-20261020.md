# Waking-prose continuation-instruction boundary

Implementation only, based on production `1458fb2`. No inference, merge,
deployment, restart, history rewrite or production-state correction.

## Retained trace and root cause

The public fixture is in
`runner/fixtures/waking-journal-continuation-instruction-2026-10-20.json`.
Read-only production queries retrieved only public text, validation/settings,
strip accounting and boolean checks of subsequent subjective context. No private
prompt, postcard body or autobiographical-memory content was exported.

- Journal diagnostic `2794236`, 20 October 21:15:54.355 BST: 81 output tokens,
  not token-limited. Initial validation was `ok: true`; no repair was attempted.
- Public chunks `2794231` through `2794235` contain the same text as the retained
  post-provider output, including `Please proceed and write more of Cy's thoughts
  as requested. Continue from where we stopped this entry.</`.
- Strip accounting records no scaffold, narration or state-notation removals.
  Accepted candidates do not retain a separate complete raw-provider snapshot;
  the evidence does not justify inventing one. The output and zero-removal trace
  show that neither frontend rendering nor scaffold stripping created this text.
- Neither instruction nor bare closing fragment was in this turn's retained
  subjective input. Both instructions and `</` were in the next natural journal's
  subjective input (`2794872`, 21:37:48.824 BST).

Before this change, offline calls to the shared validator and feedback sanitizer
accept each instruction and `cold tea.</` independently. The procedural rule
requires a verb directly followed by an entry/response/output artifact; it misses
both the `proceed and write more of` bridge and the `from where we stopped`
construction. Existing tag sanitization needs a tag name or closing `>`, while
malformed-control checks do not recognize a bare closing-tag opener.

## Boundary change

Only `runner/warden.js` changes at runtime. The existing assistant-frame matcher
now recognizes bounded writing-task continuations at sentence/line/annotation
boundaries, optionally wrapped or task-labelled:

- produce/write/generate more or further output, including Cy's thoughts;
- continue/resume/carry on with a writing artifact or Cy's thoughts;
- resume from the point writing stopped, explicitly bound to writing or an entry.

An attached in-world reporting clause can preserve a quoted writing instruction.
This is syntax, not a new grounding engine: it neither certifies an attributed
conversation nor changes claim provenance. A separate task instruction later in
the same text is still detected. Ordinary `continue`, movement directions,
letters, reported statement-writing instructions and literal punctuation remain
allowed. The former direct-artifact instruction rule now shares this attribution
handling; all other editorial/control checks remain in place.

The malformed-control family also rejects bare `</` at a line/output end,
including LF/CRLF and trailing horizontal whitespace. It does not ban ordinary
angles/comparisons, quoted `'</'`, or arbitrary slash punctuation.

## Publication, repair and feedback

`streamGenerate` holds a whole raw candidate and calls
`generateWithCharacterRepair` before `onChunk`. Invalid initial text gets the
existing one repair from the original grounded prompt, never from the rejected
text. An invalid repair becomes silence. No tainted prefix/remainder is salvaged
for publication. Journal, drawing-intent, warden-response and postcard validation
continue using their existing shared entry points; no structured/internal model
route is added.

The same matcher drives `sanitizeCharacterContext`: retain only the existing
safe prefix before a task instruction, exclude the entire contaminated tail.
Bare markup remnants use the shared malformed-control filtering. Context append,
context reads/load, recent-expression and existing Cy-expression memory consumers
already call these helpers. There is no state reset, migration, memory-interface
change or edit to public history. A safe prefix of an old mixed expression may
remain available under the existing policy; its instructions may not.

## Verification and limits

Dedicated deterministic tests cover the complete real candidate, each instruction
independently, paraphrases, task labels, quotes/brackets/pipes, upper case, wrapped
lines, LF/CRLF markup, legitimate world instructions and punctuation, all shared
waking repair paths, silence on failed repair, feedback/formation filtering and
publication ordering. Existing freshness, source-boundary, continuation, marker,
provider, Tempo and token-limit regressions run unchanged.

- Focused suite: **59/59 passed**, including nine new test cases with parameterized
  positive/negative fixtures and shared-route repair/feedback checks.
- Full runner suite: **531/531 passed** with `--test-concurrency=2`.
- The initial sandboxed full runs had two loopback-dependent transport/formation
  failures (`EACCES`); both pass after granting mock-server network access, as does
  the full rerun. A workspace-local temporary directory avoids the sandbox's
  restricted default-temp atomic-rename failure. No runtime workaround was added.
- `git diff --check` passed. Production remote was verified at `1458fb2` before
  creating the isolated feature branch. No other runtime file differs from base.

No demonstrated retained continuation-instruction fixture remains accepted.
This is not an exhaustive semantic detector: ambiguous `continue from where we
stopped` without a writing/task object is deliberately allowed, as is reported
in-world dialogue. Novel paraphrases can still require later regression evidence.
It does not address speculative external claims, repetition or journal quality.

Source-boundary prompts, freshness, ONE_SUBJECT, the 520-character continuation
policy, model/sampler, 93-token allowance, Tempo, memory interfaces, topic selection
and the paused claim-provenance architecture are unchanged.
