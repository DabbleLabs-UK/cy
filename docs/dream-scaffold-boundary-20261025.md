# Dream scaffolding publication boundary

Source-only repair based on production `8c788901b01ace7bea70046682f00fadadcf4ff5`.
No merge, deployment, restart, inference or historical-state correction.

## Natural evidence and limitation

Read-only canonical/public event inspection confirmed both records used
`cy.dream-fragments.v1` and were marked `PASSED`:

| Sequence | Public time (BST) | Event ID | Retained fragment evidence |
| --- | --- | --- | --- |
| 2911856 | 23 October 2026 23:14:28.200 | cd1190f0-d9a2-458b-af7d-3bc25af6d5f3 | Escaped JSON fragment objects and literal `>assistant` |
| 2919034 | 24 October 2026 03:50:11.618 | 1d4f208f-0f2c-4335-a5ea-fa007209a5b2 | Literal `{`, escaped `fragments` array header and JSON-like string tails |

Exact retained public fragment arrays are regression fixtures. Full original
provider responses were not retained, so their precise original parsing route
cannot be established. Tests explicitly label joined-line raw reconstructions;
they do not present those as original provider captures. Both joined-line
reconstructions and valid JSON wrapping the retained fragment values pass the
pinned old validator and fail the new boundary.

## Cause and full path

Both ordinary dream-murmur and noise-waking dream calls already request a JSON
fragment object, with a 96-token output allowance and zero retries. Dream context
is sleep-only, privacy-filtered world residue/material plus eligible public
autobiographical traces, not journal continuation or sender-private text.

The former parser extracted the first-to-last brace substring. If extraction or
the expected array failed, it accepted non-empty raw lines. Shaping then capped
words, characters and fragment count, but did not distinguish packaging from
language. Validation checked broad assistant framing and non-empty output, not
technical syntax in each value. Consequently malformed packaging could become
fragments, and valid JSON could also carry scaffold strings as fragment values.

The emitter sanitized/screened those values, emitted a public `dream` event with
`PASSED`, and could queue that same subjective expression for normal memory
formation. Those actions did not create world truth, but still published and
fed back invalid expression. Existing cancellation/liveness gates surround
generation and run again immediately before emission.

## Repair

- Parse the complete response as exactly `{ "fragments": [non-empty strings] }`.
  No embedded-JSON extraction, code-fence stripping or raw-line fallback.
- Reject the whole response for obvious structural JSON, response fences,
  role/chat-template syntax or parser/debug scaffolding in any original value.
  Check before caps so a truncated tail or sixth fragment cannot conceal it.
- Preserve the existing compact presentation caps for valid natural language.
- Repeat value validation after shaping and at the emitter before sanitation and
  after screening. Invalid preparation cannot create a public event or memory
  source, even through a direct emitter caller.
- Use existing private rejection diagnostics, including
  `REJECTED_INVALID_SHAPE` and `REJECTED_TECHNICAL_SCAFFOLDING`; no repair or extra
  inference call, no invented fallback dream.

English role words, ordinary braces/brackets used within dream language, broken
grammar and surreal imagery remain supported. This is syntactic scaffolding
detection, not a claim that dream meaning is semantically validated.

Prompts, model/provider/options, cadence, dream drawings, memory selection,
chronology/grouping, cancellation and historical published records are unchanged.

## Verification

- New boundary regressions: 14/14 pass.
- Combined dream/cancellation focused run: 31/31 pass, including the new tests,
  existing fragment caps, dream regime/world isolation, viewer and cancellation.
- Full runner suite after final review corrections: 760/760 pass; no
  skipped/cancelled tests (26.615 seconds).
- Integration fixtures execute the actual murmur/waking `dreamStep` and
  `emitDreamFragments` functions with offline stubs, checking publication,
  subjective-memory feedback and cancellation after generation/during screening.
- Syntax checks pass for both changed runtime files and the new test. The
  data-handling manifest and all 12 model-spec JSON documents parse; whitespace
  checks pass.
- Independent final review initially found an overly broad bare-role-word
  rejection and unfinished/spaced chat-control bypasses. Both were corrected,
  regression-tested, and independently re-reviewed with no material findings.
  Bare role words now require actual marker syntax; unfinished `<|` controls
  and delimited spaced `im_end` mutations reject before sanitation.

Final local validation logs (outside the repository):

| Log | SHA-256 |
| --- | --- |
| `dream-scaffold-focused.log` | `faf4cbed4029df16884802f124233c990e0bd3f2a3f3bb1340e8c08310a046aa` |
| `dream-scaffold-full.log` | `ad9319241f2b3c575df1c13dedb6b7bb8e872202e3d350bf115e3df0ae7525d0` |

No deployment is authorized here. Real-model formatting success after this
stricter boundary remains a question for later natural production evidence.

Changed runtime files: `runner/dream.js` and `runner/run.js`. Tests are in
`runner/dream-scaffold-boundary.test.js`; documentation is here, in `dreams.md`
and the existing data-handling manifest. No new subsystem or persistent state.
