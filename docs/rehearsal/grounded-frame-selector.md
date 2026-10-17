# Mechanically grounded frame-selector prototype

REHEARSAL ONLY. No production import, transport, scheduler change, state application,
publication, merge, deployment, server start or inference. Based on pinned reduced
semantic-core commit aaf8f5a07ca6c955ca7d5f1a62155f0336cdd500 and the verified
13 October production-faithful capture. Branch:
`feature/awg-grounded-frame-selector-20261017`.

## Frozen frames

All three bind the complete capture + frozen now + permission policy fingerprint.
IDs hash each complete immutable record, including state, revision bindings,
roles, channel, identity, effects, prerequisites and content-slot schema. A policy
catalogue change also changes the permission fingerprint and therefore frame IDs.

State fingerprint:
`6b1e70ec8335ab1d137b947d28f35871a1db1f08dcebfdef517727df56dce806`.

| ID | Domain | Bound geometry / roles |
|---|---|---|
| gf1:cy_in_place:d73ffcc8c27c8943 | CY_IN_PLACE | Cy acts and directly observes at CELL; no other participant |
| gf1:adjacent_nonverbal:4d4c648e93f97e71 | ADJACENT_NONVERBAL | Unidentified ephemeral sound source; Cy hears from CELL; sound origin LANDING |
| gf1:adjacent_speech:115f7f92014af5c7 | ADJACENT_SPEECH | Unidentified ephemeral speaker; no fixed addressee; Cy hears from CELL; sound origin LANDING |

Every frame has empty permitted effects, only known Cy SELF presence, no NPC
presence transition, and no Cy relocation. The anonymous source is not a cast ID,
new person record, recognised voice, relationship or persistent location claim.
Prerequisites are state:current, actor:cy, the origin/channel refs and a versioned
permission-rule ref. Permission rules describe allowed NEW activity, not evidence
that activity has already occurred. Their small bodily/acoustic vocabulary is
explicitly authored capability policy, not an extracted fact or incident story.

No eligible NPC is promoted to a contact frame. No historical record, resolved
thread or unavailable object creates a candidate. The copied original history and
world state remain intact for downstream contradiction/duplicate validation.

Geometry is state-dependent: only CELL supplies these adjacent-hearing frames;
other AWG-eligible current locations can supply the self frame only. Active search,
lockdown or unavailable locations supply no frames. Named-contact/object/thread
capabilities are intentionally not implemented by this first conservative prototype,
even if another capture contains entities. This is not a general affordance engine.

## Exact response contract / order

`grounded-frame-selector-schema.json` is the exact frozen model-facing schema.
It has three oneOf branches, in body -> non-verbal -> speech order. Every branch
requires frameId then content and rejects additional fields. Each frame ID is const,
and only that frame's content schema is available under it. No NO_EVENT branch.

| Frame | content property order | Choices |
|---|---|---|
| Body | operationId -> modifier (optional) | SHIFT_WEIGHT / STRETCH_HANDS / TAP_FINGERS; modifier null / SLOWLY / BRIEFLY |
| Non-verbal | operationId -> detail (optional) | FOOTSTEPS / KNOCKING / COUGHING; detail null / FAINT / BRIEF / IRREGULAR |
| Speech | utterance | One short lower-case ASCII utterance, 1-120 chars, matching the full compositional grammar |

There is no free-form occurrence, participant list, speaker/addressee ID,
observation account, location/access, presence array, reference list, effect or
family choice. Optional modifier/detail omission and explicit null are both valid.
Duplicate JSON keys are rejected rather than silently keeping the last value.

### Deliberately narrow speech boundary

Arbitrary prose cannot be deterministically certified as grounded. Rather than
claiming an NL safety oracle, the prototype uses one full-string compositional
grammar, shared by the JSON schema and runtime validator. It allows greetings,
contact/availability questions, and current anonymous self-availability, optionally
one greeting followed by one clause. It does not enumerate whole utterances.
The vocabulary permits ordinary combinations, not reports about names, property,
history, movement, hidden actions, motives, relationships or instructions.

No substring extraction, punctuation removal, rewriting or candidate repair occurs.
Out-of-language speech is rejected unchanged. This is intentionally much narrower
than general dialogue and its rejection rate is part of a future behavioural test.
The grammar is tested offline in JS; actual provider grammar execution and model
selection behaviour have NOT been tested with inference in this task.

## Deterministic rendering and original validator

The only examples are committed deterministic test fixtures, not model outputs:

* TAP_FINGERS + BRIEFLY -> Cy briefly taps his fingers against his palm in the cell.
* FOOTSTEPS + FAINT -> Cy hears faint footsteps from the landing.
* Anonymous utterance -> Cy hears an unidentified voice say "hello, anyone still awake?" from the landing.

The renderer supplies the actor, verb account, origin/observer phrasing and exact
utterance quotation. It never inserts another name or invents a Cy reply. Heard
speech remains heard speech, not a true information claim. Participants are [cy];
objects/informationClaims/effects are empty and thread.action is NONE. Family is
derived after compilation: WING_ACTIVITY for self, OVERHEARD_ACTIVITY for hearing.

The unchanged production materialiser and validator run on the compiled proposal.
No error is waived: compatibilityExceptions is always empty. Natural canonical
"hears ... from the landing" preserves the separate sound origin without claiming
Cy moved onto the landing; it passes the original location-cue validator. Neither
prior rehearsal exception is needed or imported. Exact/near duplicate, minimum
spacing, window, privacy, chronology and all other legacy errors still reject.
No source prose is discarded to obtain that result; the model cannot supply prose
outside the typed slots in the first place.

IDs/fingerprints/revision bindings and the complete frame set are revalidated.
The frame source is checked before and after preflight and after inference.
Unknown/stale IDs, changed revisions/location/history, tampered slots/frames,
invalid JSON/content, cancellation, timeout or downstream rejection fail closed.
No repair, replacement, state apply or publication function is provided.

## Real exact token budget

Pinned original GGUF tokenizer, embedded template and Ollama 0.34.1 build metadata:

| Accounting | Previous semantic core | Frame selector |
|---|---:|---:|
| Complete input, including system/template/BOS | 2251 | 748 |
| Context | 3072 | 3072 |
| Maximum output | 420 | 420 |
| Terminal reserve | 1 | 1 |
| Spare after full output | 400 | 1903 |

Frame IDs and compact permissions replace the roster, old prose/facts and repeated
role/access instructions. Full authoritative frozen input remains in the package;
history is deliberately not model-facing inspiration. No model, template, stop,
sampler, temperature, thread count, output limit, timeout or production memory
requirement changed. The exact tokenizer preflight loads metadata, not weights.

Model: hf.co/mlabonne/Meta-Llama-3.1-8B-Instruct-abliterated-GGUF:Q5_K_M.
Tag digest: c6ec899cdf5f8e3f55350f7fc28735be2f77556c011f71a5bf6402556aba1cc8.
Blob SHA-256: 7afb333a43c3cd660e0a9720828ae963336796377dbf189c6a33a403527c6785.
Original options: temperature 0.65, top_p 0.9, repeat_penalty 1.1,
repeat_last_n 128, num_thread 4, and the captured stop list, all copied unchanged.

The mandatory per-attempt guard checks request fingerprint, tokenizer/profile,
3072 context and sufficient full-output headroom before invoking a callback.
The complete wire has stream:false, keep_alive:"5m", truncate:false. The 420000ms
timeout starts after successful preflight. The outer admitted flag and current
location availability are not substitutes for production cadence: no scheduler is
wired here, and the existing outer cadence remains unchanged.

## Offline preparation and tests

From this worktree, with the verified original capture and isolated model metadata:

```bash
node --test scripts/rehearsal/grounded-frame-selector.test.mjs
node scripts/rehearsal/prepare-grounded-frame-selector.mjs \
  --capture C:/cy-rehearsal/leno-awg-capture-20261013 \
  --out C:/Users/jodyf/Documents/Codex/2026-09-03/som/awg-frame-selector-preparation-20261017-ready
```

The preparer requires clean committed source and unchanged production paths,
disables networking, has no inference mode, and only creates a new external
directory. It verifies the original capture/request/source equivalence and runs
the exact metadata-only preflight. It exports full immutable frames, exact schema,
request, byte-identical wire, token receipts, source-closure hashes, source revision,
byte-preserved source snapshots, test-only renderer examples, this handoff and a byte-preserved copy of the complete
checksummed original capture. SHA256SUMS.txt seals every package file recursively.
No artifact is a generated real-world event or enters memory/continuation.

The source worktree and all earlier rehearsal artifacts/captures are preserved.
Only new rehearsal modules, tests, fixtures/docs and narrow LF attributes change.
Production imports, runner/public/config/database files and cadence remain untouched.

Verification: 582/582 full runner/rehearsal tests passed, including 19 focused tests
covering exact frozen frames, bindings/revisions,
content/identity/property/history safety, duplicate keys and type-coercion attacks,
stale/cancelled/timed-out attempts, canonical rendering, original validation and
exact metadata-only tokenizer preflight. Sandbox-only EPERM temp rename failures
required the established narrowly
permitted test execution with an owned external temporary directory. No provider
or production service is used by those tests.

## LENO handoff: EXACTLY TEN sends only after separate authorisation

1. Pin the exact sourceRevision in verification.json on this branch. Require clean
   source; verify all package hashes and every prototype-source.json entry.
2. Import readVerifiedCapture from the existing preparer against the package's
   frozen-capture directory. Rebuild with prepareFrameSelector(capture,{nowMs});
   require the bound frames, request/schema and wire to equal the saved artifacts.
   Do not use the older semantic-core or full-contract request/wrapper.
3. Repeat exactContextPreflight on the complete request before isolation and before
   every eventual send. Require input=748, context=3072, output=420, spare=1903,
   fits=true, initialTruncation=false and truncate:false. Never silently truncate.
4. Use the unchanged hardened LENO pause/drain/watchdog/isolation/restoration
   procedure and corrected hidden-startup launcher. Verify version 0.34.1 and
   original CY blob/tag. Strictly allow only http://127.0.0.1:11535 for inference;
   ordinary :11434 must be stopped/refused. Do not alter Feddit updates/config.
5. A future authorised transport calls runFrameSelectorAttempt, NOT runSemanticAttempt.
   The injected generator receives the COMPLETE wire object. Check byte equality
   and SHA-256 before its one abortable POST. Return provider.response unchanged.
   Keep every sample independent: no prior output is fed into subsequent requests.
6. Count exactly 10 actual sends, including cold timeout/errors. No warm-up
   generation, repair, replacement, variant, Stage 2 or 11th send. A preflight
   failure is zero sends and aborts sampling; input-count mismatch or server
   truncation warning stops the batch. Do not replace failed or interrupted sends.
7. Retain each raw provider body, parsed selection, complete frame, compiled
   account, roles/access/identity/presence/refs/effects/family, original production
   validation, precise rejection, metrics and per-attempt preflight. Record frame
   order/selection and repeated content; do not fix bias with rotation or bonuses.
   Passing deterministic fixtures is not evidence of good natural selection.
8. Stop all owned isolated processes first; restore original ordinary
   Ollama/Qwen/Feddit controls and verify configuration/launcher hashes. Wait for
   controller/watchdog/sampler exit. Seal evidence and stop after the ten results.

This preparation authorises NONE of those inference sends. No merge/deploy/restart.
