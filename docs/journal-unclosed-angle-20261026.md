# Journal unclosed-angle publication boundary

Rehearsal/source repair only. Base: production merge
`b8a7347b95911eb0068818a567869e99727dda67`.
No inference, production access, history rewrite, merge, deployment or restart.

## Evidence and mechanism

The frozen 50-entry audit retains these four published cases. Offsets are
zero-based JavaScript string offsets in the exact retained published strings.

| Sequence | Local timestamp (BST) | Tokens | `<` offset | Immediate boundary |
| --- | --- | --- | --- | --- |
| 2905496 | 23 October 19:13:58.128 | 93 | 330 | `noise \| <banged up for the...` |
| 2909130 | 23 October 21:30:43.098 | 72 | 219 | `sayin \| <banged up for the...` |
| 2925278 | 24 October 07:48:11.141 | 93 | 237 | `him rn... <banged up 4 so long now...` |
| 2931837 | 24 October 11:59:16.273 | 63 | 73 | `much time... <lunch was available but did they eat it?` |

Sources inspected offline:

- `outputs/journal-natural-audit-gens-20261025.json`
- `outputs/journal-ending-repair-evidence-20261025.jsonl`

These are workspace evidence, not runtime inputs. Exact published values are
preserved in `runner/fixtures/journal-unclosed-angle-natural-20261026.json`.
Only sequence 2905496 has a retained raw repair, ending
`<banged up for the night`. The other original complete model responses and all
four reliable provider termination reasons are unavailable; none is invented.
The 72- and 63-token examples demonstrate independence from the old cap handler.

Existing sanitation recognizes complete flat tags with
`<\/?[A-Za-z][^<>]*>+` and a bare terminal partial tag name with
`<\/?[A-Za-z][A-Za-z0-9]*\s*$`. A multiword unclosed angle prefix matches neither.
The existing malformed-control and editorial checks also accept all four forms.
They therefore survive candidate validation and sanitation; before this repair,
the final publication check also accepts them when no reliable length reason is
available. Feedback sanitation preserves the same malformed strings, so the
publication/feedback fixed-point check alone does not protect this case.

This does not establish which model protocol caused the prefix. It establishes
the exact syntactic boundary that escaped the existing flat-markup grammar.

## Narrow rule

Journal candidates fail if all of these hold:

1. At output/line start, or after sentence punctuation (`.`, `!`, `?`) or a pipe,
   allowing horizontal whitespace;
2. `<` is attached directly to an ASCII letter-led alphanumeric tag-name-shaped
   word;
3. That word is followed by horizontal whitespace and another letter-led word;
4. No `>` closes that flat angle span before the next `<` or candidate end.

Reason: `unclosed clause-initial angle prefix`.

The pipe is only a position delimiter, not forbidden content. Neither arbitrary
unmatched angles nor the English words in the four examples are blacklisted.
Numbers, `<3`, spaced `<`, quoted marks and ordinary mid-clause uses do not match.
Closed tags retain the pre-existing sanitation behavior. This deliberately does
not claim to be a general HTML parser or reject every possible malformed prefix.

## Integration and unchanged behavior

- `validateJournalCandidate` composes the existing character candidate validator
  with this one journal-only check.
- The existing journal `generateWithCharacterRepair` invocation uses that
  validator for initial and existing repair candidates. Invalid initial output
  may use the existing single repair; two invalid candidates become silence.
- `validateJournalPublication` uses the same journal validator on exact staged
  final text before any public text, continuation or expression/Soma feedback.
- No stripping, token deletion, synthetic ellipsis, reconstruction or extra
  generation call is introduced.
- `warden.js`, sanitation, prompts, provider, drawing runtime, repair loop,
  continuation construction, token limit and termination logic remain unchanged.
- Historical published records and saved prior continuation are not scrubbed.
  Only new rejected output is prevented from entering feedback.

Only production runtime files required for a later rollout are
`runner/character-output.js` and `runner/run.js`. Other changes are tests,
regression fixtures and this document. No new persistent state or telemetry
fields are added; the rejection reason uses existing validation diagnostics.

## Regression and review evidence

- All four exact natural forms: old candidate validator accepts, new journal
  validator rejects. The one retained raw repair is also rejected unchanged.
- Real extracted finalization/publication functions: all four produce no public
  text, continuation save, expression feedback or Soma feedback.
- `42 < 43`, a mathematical comparison in ordinary prose, and `<3` remain
  publishable; ordinary slang and pipes remain valid.
- Closed/multiline markup, partial-tag sanitation and existing chat controls
  retain baseline behavior. An inherited terminal `<c` sanitation behavior in
  `a <b and b <c` is intentionally not changed by this task.
- Source comparisons pin non-journal consumers and the deployed finalization,
  termination and retry behavior to the base, apart from the new validator hook.
- Independent read-only review found no material issue with the syntactic scope,
  fixture fidelity, retry/publication placement or unchanged non-journal paths.

### Validation results

| Check | Result |
| --- | --- |
| New unclosed-angle tests | 39/39 |
| Focused publication/journal/provider/drawing/abort suite | 173/173 |
| Full runner suite, serial | 855/855, 141.522 seconds |
| Runner JavaScript syntax | 217 files pass |
| JSON, including manifests and fixtures | 100 files parse |
| Whitespace | `git diff --check` passes |

The first parallel full run passed 854/855: the unchanged mock raw transport
test did not observe connection closure within its short abort assertion window.
That file passed standalone (all five internal checks), then passed in the
complete serial suite. No transport code or test deadline was changed. Both
full-run logs are preserved rather than hiding the initial failure. Tests use
disposable local mocks, not an actual model/provider or production endpoint.

Workspace log basenames under `outputs/` and SHA-256:

- `journal-unclosed-angle-focused-20261026.log`:
  `5b9bf6ff81ab8d775047f5f98a7f834c1caeaea11d5ff6ba685cc53acf41361a`
- `journal-unclosed-angle-full-20261026.log` (initial parallel run):
  `90f9748916bdec50abbaf0ac03693212ee02a2fb79cc66dee965a2a52ffe87fe`
- `journal-unclosed-angle-full-serial-20261026.log`:
  `d76124fa3ae3e2404148f15eda820b89a726e9d7d11443c3733a247727c3d179`

Ready for a separate rollout review only. There is no model-quality claim beyond
deterministic rejection of the demonstrated form. Other unclosed-angle shapes,
already-saved malformed continuation, unknown below-cap endings and a global
pipe policy remain outside this repair.
