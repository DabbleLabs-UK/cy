# One-call grounded AWG proposal - rehearsal handoff

The original 6ad0e7a preparation below is retained as design history, NOT the
current run instruction. The 17 October context audit found provider-side input
truncation. Use [the corrected token-budget handoff](one-call-context-budget.md)
and its new verified package, mandatory exact-token preflight and truncate=false
transport envelope. Do not reuse the old -ready request or unguarded harness.

PREPARED ONLY. No model inference has been run for this prototype. No production
integration, merge, deployment or runner restart is authorised by this handoff.

Branch: `feature/awg-one-call-grounded-proposal-20261017`, based on grounded
prototype `f4580921d11c2b6af02048528a7af034c6a28aab` and its verified frozen
production capture. The old two-stage prototype remains unchanged for comparison.

## Architecture

The existing outer AWG scheduler remains the conceptual admission authority:
45-minute attempt spacing, 30-minute event spacing, four accepted events per six
hours, waking idle reservation, maintenance/priority/location/continuity gates.
This prototype does not implement another scheduler, admission probability,
minimum output rate, actor quota or family rotation. `admitted: true` in the
injected attempt interface means a caller has already granted one attempt; it
does not itself establish production eligibility.

One admitted attempt can invoke one injected generator exactly once. There is no
model-facing decision/abstention branch and no second realiser. A response is a
self-sufficient concrete proposal with downstream classification. A deterministic
encoder supplies the existing canonical EVENT/CONTINUATION boilerplate; original
production materialisation assigns machine fields and the production validator is
reused. No candidate is ever applied by this code.

Invalid JSON, property order, unavailable entities, missing prerequisites,
unsupported presence/access/effects, duplication, stale state, transport failure,
timeout or cancellation produces `NO_WORLD_EVENT`, with its actual reason. There
is no extraction from fences, repair, prose replacement, immediate regeneration or
conversion of a failed proposal into an accepted event. Rejections must count as
attempts in any later harness; they are not replacement allowances.

The injected interface has the production 420000-ms default deadline and passes an
AbortSignal. A future transport must honour it by closing the HTTP request. The
interface counts generator invocations, not unverifiable network activity inside
an arbitrary callback. A future hardened harness must independently count sends,
enforce one send per callback, and stop its owned request/server before restoration
if cancellation cannot be confirmed. Unit tests use fakes only.

## Packet and scope

The original mechanical packet is reused: canonical location/regime, eligible
cast without blurbs, usable on-location objects and allowed transitions,
continuable threads, explicitly active episodes, historical positive world facts
and possible observation channels. Private correspondence, autobiography and
generated expression are not positive world evidence.

Additions are deterministic:

- A current-location origin and, only when Cy is in CELL, an explicitly scoped
  cell-to-landing audible origin. This is a rehearsal compatibility boundary based
  on existing landing movement/partial-hearing concepts, not a new authoritative
  NPC location map or proof of current landing activity.
- Current presence may be supported by an active, directly observed search episode
  explicitly recording Cy present and its officer. A historical record, roster or
  offscreen episode cannot support current co-presence. Production would still
  withhold admission during an active search.
- Movable-object mention aliases come only from the supplied usable object type
  and bounded noun matches in its stored name/label/description. No message content
  is exposed by alias extraction.

The real frozen packet has 15 eligible actors, no usable objects, no continuable
threads, no confirmed other-actor presence, and 11 historical positive facts. Its
state is CELL/CELL_TIME at frozen nowMs=1791925108359. Sparse state still permits
ordinary self activity, anonymous audible surroundings, a supported new arrival
or conversation; no incident, object or thread is manufactured to fill the packet.

As in the original grounded prototype, new object creation and new thread opening
are intentionally unsupported. Existing supported transitions can be encoded when
the packet actually supplies them. In this frozen packet `effects` is exactly an
empty array: maxItems=0. It is not an instruction to invent a durable effect.

Drought activation is recorded only in the non-model-facing preparation trace.
It never alters the schema, prompt or allowed effect count. The capture fingerprint
still changes honestly when input state changes.

## Exact model-facing property order

All object schemas forbid additional properties and require their listed fields.

```text
actors
occurrence
  eventType
  summary
  originLocation
  presence[]
    actorId
    mode
    sourceRef
target
  null, or kind -> id
observation
  observerId
  access
  summary
sourceRefs
effects[]
  OBJECT_TRANSITION: kind -> objectId -> operation -> holderId
  THREAD_TRANSITION: kind -> threadId -> operation -> summary
classification
  eventFamily
```

`classification` is the final top-level field; classification-first responses are
rejected rather than reordered. The family enum remains the existing production
enum, in its original order. There is no early family discriminator or arbitrary
split. This does not prove the model will avoid actor/family bias.

Presence schema branches are state-specific: Cy has SELF; eligible officers can
newly ARRIVE at the cell; other actors can become identifiable by explicitly
calling their own name through an audible channel. Outside cell, eligible actors
can newly ARRIVE. CURRENT_EPISODE branches exist only for supplied confirmed
presence. A named but unseen voice is not automatically recognised.

`sourceRefs` must cover current state, every actor, the target, origin and channel;
episode presence also requires its exact episode ref. Refs support prerequisites,
not proof that the newly proposed occurrence already existed.

The full exact schema, with all frozen enum/reference values, is in the prepared
`model-facing-schema.json`; `property-order.json` is its compact order record.
No raw frozen capture or resulting model request is committed to Git.

## Adjacent hearing and the legacy validator

Cy's canonical location remains cell. `originLocation: landing` describes the
source of a partially heard occurrence, not Cy moving there. Anonymous footsteps
need no invented identifiable person. Named actors require independently checked
presence/identity establishment; eligibility does not provide it.

The existing production validator uses a broad location-substring rule and rejects
even "Cy hears footsteps on the landing outside his cell." The rehearsal checker
therefore retains TWO explicit verdicts:

- `legacyValidation`: the unmodified production verdict on unchanged prose;
- the prototype verdict, with an inspectable `CELL_LANDING_PARTIAL_HEARING`
  compatibility exception for OBJECTIVE_LOCATION_CONTRADICTION only.

That exception is available only for the declared cell/landing audible boundary,
partial hearing, Cy staying in cell, no visual/content claims, no physical object
target/effect, valid references/presence, and no other-location or movement claim.
No actor, object, privacy, duplicate or other production error is waived. A second
family-independent production preflight prevents RUMOUR classification bypassing
physical checks. All original model and candidate text is retained unchanged.

This is not a production-validator modification or a claim of drop-in equivalence
for adjacent hearing. Any later integration must explicitly port/review this small
scope-aware correction; a legacy rejection is never hidden in the rehearsal readout.

## Grounding limits

Checks cover canonical actors, named-actor patterns, known/common movable-object
terms and handled-object noun phrases, authoritative locations, source references,
presence establishment and typed transitions. Floor/wall/door/body activity and
anonymous sounds are not fabricated inventory. Ordinary lowercase "a mark on the
wall" is not mistaken for the inmate Mark.

These bounded lexical checks are NOT a universal entity recogniser or semantic
truth oracle. Unusual paraphrases, unsupported motives, unseen detail and generic
property synonyms still require human review in the later rehearsal. A mechanical
pass certifies the documented constraints, not that a new happening is worthwhile.
Do not count category diversity alone as scientific success.

## Prepared LENO package (authoritative for this prototype)

```text
C:/Users/jodyf/Documents/Codex/2026-09-03/som/awg-one-call-preparation-20261017-ready/
  affordance-packet.json
  one-call-request.json
  one-call-wire-body.json
  model-facing-schema.json
  property-order.json
  trace.json
  verification.json
  SHA256SUMS.txt
```

Use the `-ready` directory, not earlier same-day preparation drafts. Those drafts
were never sent to a model. The request/schema hashes are:

- Request JSON: `294aee0fc699c5801ab386eb82689c6cd7e7abc9d689bfde528e62195fe9a9ff`
- Exact wire body: `12353df1a4b020406517d702de4b9367d45465a7e40ab0e3bfc1cd1a554ce5e6`
- Exact schema JSON: `848e712670bac6e370ff4f1b653258a64aa56f2b84b68826065df08bad703f8c`

The wire body adds only stream=false and keep_alive=5m to the prepared request.
The model and full stochastic options/stops are copied from the verified capture:
temperature 0.65, top_p 0.9, repeat_penalty 1.1, repeat_last_n 128,
num_predict 420, num_ctx 3072 and num_thread 4. No temperature-zero diagnostic,
provider switch, framing change or model call has been used here.

Offline reproduction, with a NEW output directory:

```bash
node scripts/rehearsal/prepare-one-call-grounded-proposal.mjs \
  --capture C:/cy-rehearsal/leno-awg-capture-20261013 \
  --out C:/Users/jodyf/Documents/Codex/2026-09-03/som/awg-one-call-preparation-NEW
```

Preparation disables fetch/HTTP/TCP and has no --run/host/provider/model switch.
It verifies the capture checksums and reconstructs the original production request
before building this treatment. It writes only a new explicitly chosen directory
outside capture, code, CY runtime, model stores and Feddit roots. Optional --proposal
reads a saved synthetic/rehearsal response and performs deterministic checks only.

After SEPARATE future inference authorisation, the operator must:

1. Verify branch/commit, package hashes and all request invariants; record baseline
   LENO/Feddit/Qwen state and use the existing hardened drain/isolation procedure.
2. Preserve the corrected hidden-startup launcher. Verify isolated Ollama 0.34.1
   at exactly http://127.0.0.1:11535, model tag
   hf.co/mlabonne/Meta-Llama-3.1-8B-Instruct-abliterated-GGUF:Q5_K_M and blob SHA-256
   7afb333a43c3cd660e0a9720828ae963336796377dbf189c6a33a403527c6785.
3. Have the separately reviewed transport send the frozen wire bytes once per
   authorised sample. Use normal stochastic settings. No gate, Stage 2, repair,
   retries, replacements, alternate arms or silent candidate modifications.
4. Record send count, raw provider output, parsed fields, refs, presence/origin,
   deterministic errors, canonical proposal, original legacy verdict, any scoped
   compatibility exception and latency. Count every timeout/error/rejection.
5. Stop owned experimental requests/processes before restoring Feddit/Qwen and
   normal update behaviour. Do not contact :11434 for experimental generation.

No such batch is authorised or run by this implementation task. The previous
neutral-gate result is not evidence of this prototype's behavioural success.

## Verification

- 37 new focused tests plus 21 existing grounded-prototype tests: 58/58 pass.
- Full existing runner suite: 479/479 pass outside the restricted Windows sandbox.
  The first sandboxed run hit 21 temporary-file rename EPERM failures; no production
  code or test expectation was weakened to obtain the passing rerun.
- Capture's seven checksums and original production AWG fingerprint pass.
- Offline request construction succeeds with network access disabled.
- No runner, provider, server, public asset or production schema file is changed.
