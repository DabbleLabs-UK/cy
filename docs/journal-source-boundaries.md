# Journal source boundary

Implementation only, based on deployed `684fa5e`. No merge, deployment, restart,
state reset, model experiment or inference is authorized by this change.

## Traced routes

1. `ZONE_A` shared real-looking first-person voice examples with every expression
   path. The gym/lockup sentence was copied in journal 2779166 and returned in
   journal 2779918. Its "style only" warning did not make its concrete story safe.
2. `buildPrompt` selected at most 520 characters of earlier writing, once, but put
   it after an ordinary prose heading. It remained easy to continue the words as
   narrative rather than distinguish a previous guess from a new observation.
3. `buildCtx` used the existing privacy-filtered broker. Its journal renderer
   flattened current facts, estimates, memories and a mixed incident ledger into
   ordinary notes. The ledger's organizational heading became public prose in
   2779918. The fallback and one-shot directions also used prose-like headings.
4. The no-continuation seed said a day began and mentioned the ceiling even when
   no source supplied that observation. The empty journal path now starts with
   instructions and supplied context, not an invented autobiographical sentence.

## Correction

This is an input representation change, not a new factual validator or memory
system. The same already-selected broker items are serialized as separate JSON
source records. The model is still asked for Cy's prose, not JSON output.

| Material | Journal representation |
| --- | --- |
| Current facts and observed events | `world_evidence`, with original content/origin |
| Selected autobiographical memory | `recollection`, preserving origin/uncertainty, including dream provenance |
| Mixed ledger impressions/open concerns | `subjective_belief`; bullet content retained, organizational headings omitted |
| Prior journal prose | One quoted `prior_subjective_thought`, unchanged 520-character selector |
| Soma projection | Each existing labelled datum retains its value and observed/estimated/unknown status |
| Directions, ONE_SUBJECT, fresh/no-new steer, length and one-shot cues | Separate `instruction` records |

The source contract says that repeated thoughts are not corroboration and cannot
establish that somebody said or did something. Observed reports establish what
was heard, not that the reported claim is true. Recollections retain their origin
and uncertainty; they are not erased or forbidden as remembered experience.

The existing material-freshness selector is untouched. Its selected canonical
subject is also represented as evidence, separately from its existing turn
instruction, so broker budget omission cannot make that legitimate source vanish.
Source identifiers are not printed to the model.

Concrete voice examples are replaced with form/features, not different example
incidents. This replacement is in the shared fixed voice so the old example
cannot enter journal continuity through a drawing or another expression path.
The base rough/slang voice and standing cast descriptions are unchanged.

No keyword blacklist removes gym, Bill, food or incident-related words. Ledger
headings are omitted by the existing bullet-record format; the same words in a
genuine supplied observation remain available. There is no output deletion,
exhaustive fact-checker, added generation call, or provider response-schema change.

## Before/after evidence

Retained public inputs from 20 October are in
`runner/fixtures/journal-source-boundaries-20261020.json`. Full prepared system/user
prompt snapshots are in `runner/fixtures/journal-source-prompts-20261020.json`.
These are pre-provider-template text, not assertions about a new model response.
`node runner/journal-source-snapshots.mjs` reconstructs them offline. It does not
import the runner, read runtime state, contact a provider, or write history.

### Gym: 2779166 (12:34 BST), recurs in 2779918 (12:59 BST)

Before fixed style material:

```text
HOW HE WRITES - examples of the register only, never reuse the words:
- b4 lockup they said gym. no gym. course not. rain on the mesh, cant see it, hear it tho.
```

After fixed style material:

```text
STYLE ONLY - instructions about form, not events or memories:
Lower-case, British prison slang, contractions, rough grammar and readable shorthand.
Fragments may carry a thought; keep the words needed to identify who and what it concerns.
No salutation, audience, polished essay structure or neat conclusion.
```

The replacement supplies no number, person, object or prison incident as a style
example. Existing copied gym prose is not deleted from history or continuation;
where still recent, it stays inside the explicitly subjective prior-thought record.

### Bill: 2779274 (12:37 BST)

Before, the preceding thought appeared as ordinary continuation text:

```text
Earlier private writing by Cy (subjective, may be mistaken or outdated; not evidence that its claims are true):
...maybe bill's right, there isnt nothin 2 lose, we're just data fer...
```

After, that same text is JSON-quoted once with `source` equal to
`prior_subjective_thought`. A separate instruction explicitly says:

```text
Keep guesses as guesses unless independent world evidence confirms them; repeating a thought does not turn it into something someone said or did.
```

The regression checks that none of the supplied world records corroborates Bill
saying this. A separate deterministic positive case supplies an actual Bill
statement and verifies it remains a world-evidence record. No model generation
is used to claim the later wording has been fixed.

### Heading: 2779918 (12:59 BST)

Before, a subjective source contained `INCIDENT NOTES (...)` and `STILL OPEN:`
alongside its entries. After, only the entries appear in the content array, under
`subjective_belief`; no organizational heading is journal subject matter. All
field names/source labels and instructions are explicitly non-world metadata.

### Size and preservation

| Retained record | Before system + prompt characters | After characters |
| --- | ---: | ---: |
| 2779166 | 9,372 | 10,467 |
| 2779274 | 9,482 | 10,577 |
| 2779918 | 9,828 | 10,941 |

These are character counts, not exact tokenizer counts. No model/tokenizer probe
was run. The regression compares every actual bullet-prefixed Soma datum's value
and origin before/after, rather than accepting an apparent size saving from
dropping live facts. Snapshot selection is already captured; it does not rerun
the memory or world retrieval process.

## Verification

- Focused source/context/freshness/continuation/publication/repeat tests: 66/66.
- Full runner suite: 510/510, zero failures/skips.
- Independent read-only review: initial real-producer Soma prefix defect fixed;
  reviewed recheck found no material outstanding code defect.
- `git diff --check` clean.
- Existing 30-entry freshness replay still yields 19 fresh / 11 continuation;
  selector code, receipt handling and its underlying policy are unchanged.
- Base voice, ONE_SUBJECT, 520-character selection, model/sampler, context setting,
  93-token allowance, Tempo/cadence, near-repeat logic, publication validation,
  one-repair-then-silence, memory interfaces, state and history are unchanged.

## Remaining boundaries

This makes provenance explicit; it does not prove that the local model will obey
it. It can still repeat speculative prose, infer an unsupported detail, or echo
a metadata word. No inference was run, so output-quality improvement is unproven.

Old copied examples remain in existing subjective continuation until normal
recency removes them. They have not been reclassified as facts or silently erased.
Stored memories keep their current epistemic origin and selection policy; this
task does not audit or repair their contents.

Drawing-intent, postcard and warden consumers retain their existing context
rendering. Their prose can later enter the rolling continuation; the journal now
quotes that continuation as prior subjective thought, but those other consumers
have not received this journal-only serialization. Shared concrete voice-example
removal applies to them too. Legacy one-shot cues still mix directions and scene
wording; they are marked instructions, not independent corroboration. Static cast
descriptions also remain tempting material despite their non-event label.

New source keys/JSON wording are themselves visible tokens and could be echoed.
No provider framing, stop handling, validator or publication behavior was changed
to claim that risk has disappeared. Natural evidence after a separately approved
deployment is needed before judging this correction's behavioural effectiveness.
