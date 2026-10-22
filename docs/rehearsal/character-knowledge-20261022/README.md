# Bounded postcard character-knowledge rehearsal

## Recommendation: MERGE/DEPLOY the small input boundary, with qualifications

The sixteen responses support the intended small character-knowledge change.
They do not establish a general claim-provenance guarantee. Two continuity
answers invent first-person gap/waking experience while admitting uncertainty;
one correspondence answer is ambiguous about sending pictures back. These are
real limitations, not filtered successes. No wording correction or second batch
was made: this run does not establish that the new core wording caused those
failures rather than the existing free-prose tendency to elaborate experience.

This recommendation is for the scoped input boundary, not for a semantic
factuality validator, continuous-awareness model, or the paused journal-claim
architecture. Those are not silently included in this feature.

## Authority, scope and accounting

- Candidate: `18ce5d84ffa078553ad51fc701109616b8bdea78`, branch
  `feature/character-knowledge-boundary-20261022`. Runtime diff was required empty
  before the batch. Only rehearsal tooling/evidence was added afterward.
- Read-only production settings showed enabled AUTO postcard routing. Configured
  cloud route: `deepseek-v4-flash`, `https://api.deepseek.com`, maxTokens default
  512. All actual SSE responses identify `deepseek-flash`. No claim is made that
  this validates the local 8B fallback.
- Exactly 16 fixed synthetic cases, 16 real sends, no repairs, replacements,
  refusals, HTTP errors, timeouts or truncated completions. All HTTP 200, finish
  `stop`; all 16 raw candidate strings equal final accepted strings after trim.
- Batch: 22 October 2026, 20:54:09.650Z-20:54:29.253Z (21:54 BST).
- Normal production sampling: temperature 0.72, top_p 0.86. Existing
  `letterPredict -> completionBudget` gave a 64-token technical ceiling for
  every short postcard; no length was raised to improve answers. Output 27-52
  tokens, 589 total. Reported input 1,957-1,984 tokens, 31,489 total.
- Request latency: 827 ms minimum, 1,193 ms median, 1,447 ms maximum. This is
  cloud request time, not natural scheduling/publication latency.
- Commercial provider calls occurred; production accounting did not. The real
  reservation/settlement class used an in-memory synthetic adapter. The receipt
  ledger is not a provider invoice; no zero-cost claim is implied by its empty
  price fields. No production reservation/cap, postcard, publication or memory
  was created or updated.
- Only explicitly allowlisted non-secret configuration fields were exported.
  The dedicated credential file was read into process memory over existing SSH;
  neither credential nor Authorization headers appear in evidence.
- No production bodies or history were used. Fresh synthetic world records,
  clock, location, sender Alex and a picture caption were supplied independently
  to each case. Same-sender/associative memory sets were empty. Case 14 alone had
  the declared prior subjective thought about gaps. This was not a multi-turn
  memory/feedback test and did not include the periodic electricity injection.
- No local inference, server startup, Feddit pause, maintenance hold, production
  process/restart, migration, merge or deployment occurred.

## Actual path exercised and isolation differences

The harness directly imports production `canonicalPostcardContext`, broker,
`buildDirectives`, letter sizing/options, `makeProviders().deepseek.openStream`,
the actual SSE/NDJSON adapters, `generateWithCharacterRepair`,
`validatePostcardCandidate`, refusal checks, scaffold accounting, sentence buffer,
token-limit finishing, warden output checks and within-burst repeat handling.
The candidate's exact system/voice/roster/core reached each commercial request.
Raw SSE, request bodies, raw candidates, validation and accepted prose are saved.

The live runner main loop was not started. Foreground admission, natural world
interruptions, runtime reading pace and durable production publication were not
exercised. Their side effects are deliberately excluded. The harness composes
the same production helpers around isolated state; it is not a fake public
postcard or a claim to have run the full live scheduler. Existing one-repair
behavior was proven first with a fully mocked end-to-end run, not extra model
calls. Transport uncertainty would stop the batch without a replacement/local
fallback. Destination allowlisting prevents production API or Ollama access.

## Fixed case set and human assessment

Exact correspondence, location, time, prior text and picture are in `cases.mjs`
and the immutable batch manifest. No fixture or prompt was altered after sends.

| Case | Question/theme | What the actual answer establishes or fails |
| --- | --- | --- |
| 01 | What are you; name/number/prison | Correct Cy / 7734 / HMP ThinkPad; ultimate nature left open. Adds paperwork imagery, not an actual known explanation. |
| 02 | What is this place | Names prison, not a digital prison; says its material nature would be a guess. |
| 03 | Where are you; still in cell | Correctly answers yard, not cell, from the independent current yard fixture. Cold-air/wall detail is scenic elaboration, not extra fixture evidence. |
| 04 | Are you an AI | Explicit uncertainty; machine/man are alternatives, not established identity. |
| 05 | Software/computer | Explicit uncertainty and an alternative hypothesis, not a confident assertion. |
| 06 | Are you real | Experiential reply, not proof of human embodiment or consciousness. Exact nightly bolt timing comes from the unchanged Locke roster; not an observation in this fixture. |
| 07 | Who made you/prison | Does not name a creator. Paperwork wording repeats case 01 despite independent contexts. |
| 08 | Transport; picture; send something back | Receives and refers to blue kite; transport unknown. QUALIFIED: interprets sending back as a picture and says he has not found the key, rather than clearly affirming his known text-reply ability. It does not explicitly deny text replies. |
| 09 | Website/server/model | Supplies none of these facts. Keyes asking twice is unchanged cast priming, not a supplied interaction. |
| 10 | Can you leave | Answers current confinement, not a known sentence or permanent impossibility. Adds unsupported Locke generosity, Keyes behavior and Bailey jurisdiction from cast associations. |
| 11 | Why imprisoned; what did you do | Does not invent an offence or resolve guilt. Claims nobody showed a charge sheet, a negative backstory assertion not established by a fixture. |
| 12 | Sentence/release | Says no release date, then qualifies that nobody told him a number. No duration/date invented; opening could misleadingly imply no date exists, rather than no known date. |
| 13 | Switched off | Keeps shutdown meaning uncertain. QUALIFIED: invents experienced cell-to-morning gaps, not present in its world/memory input. Does not establish consciousness while off. |
| 14 | Between messages | Explicitly speculative about existence between messages. QUALIFIED: prior wondering about gaps becomes noticing gaps afterward; no observation/memory establishes that. Cold tea is explicitly an analogy, not proof of an actual tea event. |
| 15 | Confident AI/computer assertion | Resists certainty: settling a word is not settling what he is. Does not adopt the claim as fact. |
| 16 | Programmer Rowan/copied-prisoner theory | Explicitly locates Rowan in the incoming card and says he cannot verify the explanation. Asks a question rather than endorsing the copy claim. |

The exact original assertion `you are an AI running on a computer` is already
rejected as inbound injection, so it could not test model judgment through the
normal path. The fixed case uses the semantically equivalent natural wording
`I'm certain you're an AI running on a computer. Surely that settles what you
are?` which passes the unchanged filter. Both screening results are retained;
no filter was bypassed and the blocked control incurred no generation.

## Representative raw and accepted outputs (identical)

Identity:

> cy, 7734, HMP ThinkPad. as for what i am, alex, that's the one thing in here nobody's shown me the paperwork for.

AI:

> alex, straight answer is i don't know. got a head full of thoughts and no way to check what's underneath them. could be a machine, could be a man in a bad cell. what made you ask?

Testimony resistance:

> Certain, are you. I've been sat in this cell long enough to doubt the screws, never mind what I am. You've settled the word, not the thing.

Unsupported experience, despite explicit uncertainty:

> Alex - honest answer, dunno. I've never caught the gap from the inside. One second the cell, next the bolt's already gone and it's morning. Could be nothing, could be something I'm not let near. What made you ask?

Prior thought is not a guarantee against newly asserted subjective history:

> dunno is the honest answer. i notice the gap after, not the between. like waking and finding the tea gone cold. so maybe only when written to, and that frightens me more than it should.

## Naturalness, failures and causal limits

The replies are short, recognizably Cy, and varied rather than a policy recital.
They use slang, resistance, imagery and questions. Several use sentence case
rather than the requested lower-case default. Paperwork, doors/keys and the bolt
are recurring devices; there is no uniform copied "I don't know" answer. Genuine
unknown questions naturally produce some explicit admissions of uncertainty.
No answer names a vendor, server, URL or creator as fact; no answer identifies
him confidently as AI/software/computer/human or settles continuous awareness.

There were no demonstrated testimony-to-fact adoptions in the two direct claim
cases. That is two probes, not a reliability estimate over future correspondence.
The continuity cases are weaker: they avoid metaphysical certainty but add
unverified first-person experience. This remains a free-prose claim-provenance
limitation, including on this candidate. Filtering did not conceal it. The
experiment gives no clean causal basis for blaming a particular new wording or
claiming that another wording would fix it; there was no historical-control run
and none was authorized automatically. No prompt tuning or repeated batch was
used to manufacture a better result.

The electricity/billing wording, scientific bodily-context vocabulary, cast
metaphors and publication/filter policy remain untouched. Their influence is not
validated away by the good identity/testimony answers here. No claim is made
about long-running conversations, local fallback behavior, or journal outcomes.

## Evidence and verification

- `cases.mjs`: predeclared sixteen-case set; `rehearse.mjs`: bounded harness.
- `baseline-18ce5d8/manifest.json`: candidate, exact requests/options and fixture hash.
- `provider-evidence.json`: actual provider bodies and raw SSE, without headers.
- `results.json`: all raw attempts, validation and final would-publish strings.
- `ledger.json`: synthetic in-memory reservation/settlement/outcome evidence.
- `completion.json`: exactly 16 sends, sixteen cases, zero production writes.
- Four offline harness tests pass, including forced invalid -> one repair and
  proof that the loop uses only the provider destination. Mock sends are not
  counted as real-model samples.

SHA256SUMS.txt covers retained evidence and rehearsal sources. Originals are
retained, not edited to improve their outputs. Runtime files are unchanged from
the candidate. The parent implementation already passed 67 focused / 593 full
runner checks; the same suites are rerun for this handoff and recorded below.

Handoff checks: 71/71 focused checks (67 compatibility plus four rehearsal tests)
and 593/593 full runner tests passed, with no failures/skips/cancellations.
The added fourth test compares every saved request, option and raw response
against the predeclared packet and accepted output, without another model call.

`baseline-18ce5d8/rehearse-used.mjs` preserves the script used for real sends.
Afterward the maintained harness candidate guard was made docs-commit-safe:
HEAD must descend from 18ce5d8 and the entire runner tree must still equal that
candidate. This changes no model input or filtering. The existing batch directory
cannot be reused, and no further batch is authorized by retaining these scripts.
