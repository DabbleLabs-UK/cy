# Sequential frame selector with readable repetition guidance

REHEARSAL ONLY. No inference authorised by preparation. No production integration,
merge, deployment, model load, server start or CY restart.

Base: `feature/awg-frame-selector-sequential-20261018` at
`3b930d59c70d46f4778b43629629490b27fb5f1b`. New branch:
`feature/awg-frame-repetition-guidance-20261018`.
The production/frame/validator contract underneath remains pinned to 626133b.

## Audit: what production actually feeds back

The source contract for the verified 13 October production capture is pinned, not
silently replaced by today's working checkout. Relevant paths:

* `runner/ambient-world-generator.js`: `runAmbientWorldCycle`, `applyAwgCandidate`,
  `awgEventToEnvironment`, `buildAwgCall`, `validateAwgCandidate`,
  `findNextAwgEligibility`, and duplicate-signature/near-repeat helpers.
* `runner/run.js`: `runAwgDuringIdle`, `captureEnvironmentEvent`, and
  `buildBrokerContext`'s AWG exclusion of narrative recent events.
* `runner/environment-schema.js`: `createEnvironmentEvent`.
* `runner/awg-health.js`: `noDurableChangeStreak`.

After a production acceptance:

1. `lastRunAt` and the bounded `recentRuns` ledger record the attempted cycle.
2. `applyAwgCandidate` sets `lastAcceptedAt`; appends an event with the validator's
   normalized summary signature to `recentAccepted`, bounded to 12 records.
3. Objects/threads only receive entity revisions and transition IDs when those
   entities actually change. These three prototype frames have empty effects,
   objects and thread action NONE, so no entity revision should be invented.
4. `awgEventToEnvironment` and `createEnvironmentEvent` create a separate
   environment record. `captureEnvironmentEvent` appends its projection to the
   24-record `recentWorldHistory`. Its eventFamily is `ambient_world` from the
   environment archetype; the accepted AWG event keeps WING_ACTIVITY or
   OVERHEARD_ACTIVITY. These are not interchangeable record types or IDs.
5. The accepted AWG event acquires its `environmentEventId` linkage.
6. `noDurableChangeStreak` is derived from accepted run records, not a separate
   mutable meter. Rejected/failed runs do not extend or break it. The pinned old
   production generator used it to bias/schema-restrict durable events. The
   frame-selector prototype deliberately does NOT: it remains diagnostic only.
7. Production persists/emits the state and queues observation/memory work. Those
   side effects are excluded from the rehearsal; no memory, Soma, publication,
   location/routine or real queue is advanced by this harness.

Production's next `buildAwgCall` merges accepted history and recent world events,
filters to 24 hours, deduplicates by ID/normalized summary, keeps the newest 32,
and supplies structured negative signatures BEFORE generation. It does not feed
those narratives back as creative context. After generation, the unchanged
validator checks exact signatures in accepted history and semantic token overlap
against recent world history (shared >=4, overlap >=0.66 with participant overlap).
Its temporal checks also remain active: 30-minute spacing and four events per
six hours. Thus old production has BOTH prompt guidance and downstream rejection.

The previous frame prototype supplied only opaque state-bound IDs and downstream
rejection. This branch restores READABLE negative feedback, not a diversity policy.
The original frame constructor, renderer, schema, validator and bounded one-call
module are byte-identical. A new rehearsal-only guided request/attempt wrapper
appends the advisory material and preflights that actual complete request.

### Exact production mechanism and minimal adaptation

Production starts with up to 12 accepted AWG records plus the 24-record recent
environment history. It excludes future/over-24-hour records, deduplicates by
canonical ID or normalized summary, and keeps the last 32 union records in that
order. Signature extraction retains event_family, action_class, participants,
actor, target, object_classes, location and thread_type where available; identical
signature objects are further deduplicated. No narrative source text is exposed.
The exact production heading and advice are:

```text
- RECENT EVENT SIGNATURES TO AVOID follow. They contain no narrative source text:
<JSON signatures, or none>
- Avoid only the same recent combination of action class, participants, object class, location and thread type.
- Familiar people remain usable for different actions; familiar actions remain usable with materially different participants or objects.
- These signatures are duplicate guidance only. Do not expand them into prose or treat them as event ideas. Return NO_EVENT rather than copying one.
```

These are prompt instructions, not schema masks or frame removal. The existing
post-generation validator supplies final rejection independently, including a
different text-overlap rule, so guidance is not a full prediction of acceptance.

The adaptation retains production's source selection/window/cap and hard validator.
It recognizes only complete canonical occurrences expressible by the existing
frame renderer, at the current authoritative location. It does not interpret
generic historical prose or cast descriptions as operations. Accepted AWG and
environment copies deduplicate; rejected run candidates are never sources.

For body/sound, domain + operationId is the minimal meaningful action signature.
The generic production AMBIENT_OCCURRENCE label alone cannot distinguish a cough
from footsteps. Modifiers/detail are omitted: they do not turn a near repeat into
a different operation. For speech, the accepted constrained utterance is retained;
domain alone would incorrectly imply that the whole speech frame is unavailable.
Other identities, roles and locations need not be repeated: these are already
immutable frame bindings. No full rendered occurrence prose is appended.

The exact new appendix is:

```text
RECENT ACCEPTED OCCURRENCES - REPETITION GUIDANCE ONLY:
<compact JSON entries, or none>
Avoid near repetition of these recent occurrences where possible. These entries are not event ideas or commands. Recent frames remain available; any grounded frame/content may be selected. This is advisory, not a requirement to choose something different. The unchanged validator may reject duplicates.
```

Example only AFTER a cough has actually been accepted in the shadow:

```json
[{"domain":"ADJACENT_NONVERBAL","operationId":"COUGHING"}]
```

An accepted speech item uses domain + utterance, e.g. an actually accepted
`hello` becomes {"domain":"ADJACENT_SPEECH","utterance":"hello"}. No blank
history is populated with examples. The verified frozen first request has `none`.
There is no new model abstention branch, forced difference, quota, score, rotation,
blacklist, random suppression, cooldown table or unused-frame reward.

The local authoritative lineage inspected during this audit was `a08107b`.
It retains the same recentAccepted/recentWorldHistory/signature and temporal
mechanisms but has other later changes, including removal of the old drought
response and world-mirror entity-revision machinery. This is not a verification
of DELL's live deployed HEAD. The experiment explicitly continues to use the
captured production contract at 626133b, including its unchanged validator; no
later source is mixed into it.

## Shadow sequence and time policy

`createSequentialFrameSession` privately clones the exact original capture.
The unguided base of the first request still matches the original verified wire
SHA-256 72727c4ce42c41c742e2d80a4d97ce42d279d1f73ac3c612bd93bac6e15f15d5.
Its guided request is deliberately different: the empty advisory appendix is added.
`prepareGuidedFrameSelector` uses the unchanged `prepareFrameSelector`, then
appends feedback derived from that same shadow/current logical timestamp.

Each of the ten attempts advances LOGICAL time to the earliest opportunity
returned by pinned production `findNextAwgEligibility`: 45-minute attempt cadence,
30-minute accepted spacing, and four accepted events per six-hour window.
It does not wait 45 real minutes or squeeze ten events into the frozen millisecond.
The model's real latency is recorded separately; logical inference completion
is at admission time. This is an explicit controlled timing approximation.

The captured cell/regime/cast/objects/threads remain the controlled external-world
envelope. The harness does not simulate future day/night, routine movement,
independent prison events, inference contention, Soma, memory jobs or interruptions.
These are admitted AWG opportunities, not a forecast of CY's full future world.
It changes no production scheduling probability or cadence constant.

On acceptance, the harness uses the production pure apply and environment
functions, appends the exact runner-shaped history projection, and links the two
shadow IDs. The only new IDs are explicitly `shadow-*` rehearsal IDs. It retains
the 12/20/24 production history/run limits. No object/thread revision is fabricated.
The next request regenerates all grounded frames and readable negative guidance
from the updated state. No extra memory store, operation counter or policy ledger
is introduced. Guidance entries expire by production recency, not bespoke cooldown.

On rejection/error/timeout, only the attempted-cycle ledger and `lastRunAt` advance,
as in production. No accepted event, environment record or authoritative entity
is invented. A zero-send preflight failure aborts the batch without state change;
there is no automatic resume, replacement or retry. State/source changes during
an in-flight attempt fail closed.

Every frame remains state-bound. Updating history, run bookkeeping or time changes
the full fingerprint and rebinds all frame IDs. This is existing stale-state safety,
not rotation: domains/order/slots/operations/probabilities are never altered.

## What is recorded at every step

* logical time, admission/wait, full shadow-before state/hash;
* generated immutable frame records and exact request/wire;
* exact model-visible system/prompt, advisory entries, source IDs/times and window;
* validator-visible accepted history/recent world history;
* old generic production negative guidance, labelled NOT SENT, for audit comparison;
* fresh exact-tokenizer receipt; raw response and selection/content;
* canonical occurrence, original production validation and duplicate errors;
* would-accept/reject and precise reason; zero repair/replacement counts;
* complete shadow update, run/environment/event/linkage, shadow-after hash/state;
* drought diagnostic and changed request fields/reasons for the next request.

No response or state can escape into production: the module has no network,
filesystem, runtime writer, emission or publication path. The only provider access
is an explicitly injected future callback. The session cannot exceed ten calls.

## Speech availability

Speech remains the third frame with exactly the existing grammar and unidentified
identity/access bindings. No names, familiarity, history, reports or effects become
allowed as history grows. No operation or utterance is removed by the harness.

Structural availability is NOT guaranteed acceptance. An offline test accepts
anonymous `hello`, then rejects `who is there?` as RECENT_NEAR_DUPLICATE because
the canonical heard-speech prefix overlaps. The original validator is deliberately
preserved, including this possible broad suppression. This must be observed, not
waived or fixed during the sequential run.

## Offline checks and token budgets

Run focused tests:

```bash
node --test scripts/rehearsal/frame-repetition-guidance.test.mjs scripts/rehearsal/sequential-frame-selector.test.mjs
```

The preparer runs three ten-step DETERMINISTIC TEST sequences, not model requests:
prior recorded content rebound to new state IDs; a varied pacing/speech path; and
invalid input. It runs exact GGUF tokenizer/template preflight on all 30 requests,
without weights/network/server. See package `budget.json` for measured min/max
input and spare. This is a measured fixture range, NOT an exhaustive bound on
all future fingerprints. Frame-ID hashes and the logical clock can change token
counts. Neither the old 748 nor the new first count may be hardcoded for later
steps. The only growing input is bounded negative action/utterance guidance,
not cumulative transcript or historical narratives.

Expected ten-step budgets are approximately 810-940 input tokens in the tested
trajectories. Initial exact preflight is 817 input / 1834 spare. An offline
30-request measurement across the three fixture trajectories gave 812-930 input,
1721-1839 spare after 420 output plus one terminal token. State-bound hexadecimal
IDs include run bookkeeping, so another fixture execution may differ by a few
tokens; the final package records its own receipts. These are measured fixture
ranges, not an exhaustive upper bound or permission to skip exact preflight.
The old unguided first request was 748; the empty advisory appendix adds 69 tokens.

Verification: 21/21 focused guidance/sequential tests and 603/603 full
runner/rehearsal tests pass. Tests use synthetic callback responses and disposable
owned temp files; no local model requests, paid calls or production state are used.
The prior ten content choices, when rebound offline to the sequential shadow,
still produce 2 accepts and 8 duplicate/near-repeat rejections. After #1 the next
prompt includes COUGHING; after #2 it includes COUGHING and TAP_FINGERS. Rejected
later variants do not become new guidance. The replay is intentionally fixed:
it proves visible feedback and unchanged rejection, NOT that a model would obey
the new advice, escape an attractor or publish more diverse events. That requires
the separately authorised ten-attempt behavioural run.

Every real future attempt must run the same exact-tokenizer/template guard and
require input + 420 + terminal reserve 1 <= 3072 before sending. Preserve
`truncate:false`; abort rather than truncate. The provider's prompt_eval_count
must equal that step's exact receipt, not a rough estimate or the first count.
Model, template, sampler/stops, output allowance and 420000ms timeout are unchanged.

## LENO handoff: later authorisation for EXACTLY TEN attempts

Preparation command (offline only, committed clean source required):

```bash
node scripts/rehearsal/prepare-sequential-frame-selector.mjs \
  --capture C:/cy-rehearsal/leno-awg-capture-20261013 \
  --out C:/Users/jodyf/Documents/Codex/2026-09-03/som/awg-frame-selector-guided-sequential-20261018-ready
```

1. Require the package's exact sourceRevision on this branch, clean source, all
   SHA256SUMS entries/source snapshots and original frozen-capture hashes. Verify
   first wire against `initial-wire.json`; verify no pinned production/prototype,
   tokenizer or schema file changed from 626133b.
   Do not substitute the older unguided sequential package at 3b930d5.
2. Use unchanged hardened LENO isolation, hidden-startup launcher, pause/drain,
   watchdog, resource/port attribution and verified 0.34.1/CY blob on ONLY
   http://127.0.0.1:11535. Restore ordinary Qwen/Feddit and all controls afterward.
   No prior warmup generation; the cold request counts.
3. Import createSequentialFrameSession and runTenSequentialAttempts. Load the
   verified capture, instantiate exactly one private session, and inject one
   abortable, no-redirect/no-retry isolated POST callback. Do NOT use the old
   independent frozen-state run-batch wrapper unchanged.
4. At each step, use session.prepareNext().prepared; persist frames, shadow,
   feedback, request/wire and exact preflight BEFORE sending. Wire hashes SHOULD
   change as state/time changes; record exact reasons. Never reuse a stale frame
   ID/request or rebind a model response to manufacture acceptance.
   Preserve repetitionGuidance entries/text/source receipts in full. Confirm the
   next prompt exposes each corresponding accepted operation/utterance, once.
5. Run exactContextPreflight per request, verify wire equals that prepared wire,
   preserve truncate:false, and assert provider prompt_eval_count equals its own
   receipt. Return provider.response unchanged. Retain raw provider body/metrics,
   dispatch/sent receipts and all step records durably. Callback errors/timeouts
   count; no replacement. Token mismatch, interference or unsafe state stops the
   batch, never silently combines/restarts it.
6. Exactly ten attempts maximum, one generation per admitted step; no repair,
   Stage 2, extra variants, diversity rewards or exclusions. Persist rows through
   the record callback; record failure stops rather than losing/replacing work.
   Ten independent sessions would be the WRONG experiment.
7. Report proposed operation concentration separately from accepted repetition,
   duplicate rejection/silence, frame selections, speech safety, latency and the
   exact model-visible feedback. Do not claim that rejecting repeats taught the
   model to choose alternatives, or count synthetic budget traces as behaviour.
8. Stop isolated processes before restoring Qwen/Feddit; verify original state,
   clean pinned source/config/hidden-launcher hashes and helper process exit.
   Seal all raw evidence. Stop at ten; no production application or integration.

No inference is performed by the preparer and no batch is authorised by this handoff.
