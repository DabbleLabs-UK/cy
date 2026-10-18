# Sequential closed-loop frame-selector rehearsal

REHEARSAL ONLY. No inference authorised by preparation. No production integration,
merge, deployment, model load, server start or CY restart.

Base: `feature/awg-grounded-frame-selector-20261017` at
`626133bb71741048235cb74d2d4109555310e32c`. New branch:
`feature/awg-frame-selector-sequential-20261018`.

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

The frame prototype is different by design: its prompt has no historical prose,
negative signatures, prior operation IDs or drought guidance. A new frame ID is
an opaque hash, NOT readable memory of an earlier operation. The full shadow
history still reaches the production validator. This harness does not add
negative guidance that the tested prototype never had.

The local authoritative lineage inspected during this audit was `a08107b`.
It retains the same recentAccepted/recentWorldHistory/signature and temporal
mechanisms but has other later changes, including removal of the old drought
response and world-mirror entity-revision machinery. This is not a verification
of DELL's live deployed HEAD. The experiment explicitly continues to use the
captured production contract at 626133b, including its unchanged validator; no
later source is mixed into it.

## Shadow sequence and time policy

`createSequentialFrameSession` privately clones the exact original capture.
The first admitted request is byte-identical to the earlier frame-selector
request (748 tokens). The unchanged `prepareFrameSelector` regenerates every
subsequent request from the shadow and the current logical timestamp.

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
* exact model-visible system/prompt and explicit empty semantic-history guidance;
* validator-visible accepted history/recent world history;
* old production negative guidance, labelled NOT SENT, for audit comparison;
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
node --test scripts/rehearsal/sequential-frame-selector.test.mjs
```

The preparer runs three ten-step DETERMINISTIC TEST sequences, not model requests:
prior recorded content rebound to new state IDs; a varied pacing/speech path; and
invalid input. It runs exact GGUF tokenizer/template preflight on all 30 requests,
without weights/network/server. See package `budget.json` for measured min/max
input and spare. This is a measured fixture range, NOT an exhaustive bound on
all future fingerprints. Frame-ID hashes and the logical clock can change token
counts, so 748 must not be hardcoded for later steps. History is not appended to
the prompt; input does not grow with transcript length.

Measured during preparation: 741-751 input tokens, 1900-1910 spare after full
420-token output plus one terminal token, across all 30 deterministic requests.
The first request is exactly 748 input / 1903 spare. These measurements do not
involve model inference.

Verification: 13/13 focused sequential tests and 595/595 full runner/rehearsal
tests pass. Tests use synthetic callback responses and disposable owned temp
files; no local model requests, paid calls or production state are used.
The prior ten content choices, when rebound offline to the sequential shadow,
produce 2 accepts and 8 duplicate/near-repeat rejections. That demonstrates the
feedback/rejection wiring only, not what a new behavioural batch will select.

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
  --out C:/Users/jodyf/Documents/Codex/2026-09-03/som/awg-frame-selector-sequential-20261018-ready
```

1. Require the package's exact sourceRevision on this branch, clean source, all
   SHA256SUMS entries/source snapshots and original frozen-capture hashes. Verify
   first wire against `initial-wire.json`; verify no pinned production/prototype,
   tokenizer or schema file changed from 626133b.
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
