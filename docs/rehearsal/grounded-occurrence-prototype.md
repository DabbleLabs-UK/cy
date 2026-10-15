# Grounded occurrence selection - offline rehearsal prototype

This is NOT production integration and is not imported by the runner. It does not
send requests, load configuration/credentials, acquire leases, apply candidates,
write a checkpoint, publish, or start a model. The preparation CLI additionally
disables fetch/HTTP/TCP. There is no host, provider, inference or execution switch.

## What is being tested later

Select a concrete occurrence before asking for a family label. The first request
sees a mechanically extracted affordance packet, never an AI-authored incident
menu. It can return NO_EVENT, conversation or non-conversational activity. No
quotas, rotation, randomness outside the captured sampler, forced action or drama
are introduced. Absence of persistent effects is not a failure.

This prototype intentionally has a strict first realiser: stage 2 classifies and
encodes the checked occurrence rather than writing a second, potentially different
scene. Objective/action text, participants, observations, claims, object operations
and thread effects are bound by schema constants and checked again after parsing.
Only the compatible downstream eventFamily remains selectable. No extra prose,
dialogue, actor or side-effect is admitted. This is deliberate experimental
isolation, not a claim that free-form semantic equivalence can be proved by code.

## Input and provenance

The preparation command verifies every entry in the existing bundle checksum
manifest and reconstructs the frozen production system/prompt/format through the
current AWG code. It refuses an AWG module fingerprint mismatch. Production
lineage 85a2b7e and the captured 97decfa AWG module have the same SHA-256:
`fe57c584867f0b7cda318bed10dc1866e01212690eb2f2ebed23322e99ed8b87`.

Nothing is taken from a different experiment's altered prompt or schema.

The packet contains:

* Canonical current location/activity/entry source and the captured current-regime
  fact, plus the London clock derived from frozen nowMs.
* IDs, names and officer/inmate roles from the production cast, restricted by
  selectAwgGenerationFacts and the captured plausibleCastIds. No blurbs/personality
  or metaphor is passed. Other actors are explicitly only plausible, not confirmed
  present. This reuses the existing eligibility predicate; it does not invent NPC
  positions or a new attendance simulation.
* Only usable, on-location objects and a conservative subset of feasible operations:
  physical transfer/confiscation with eligible holder IDs; existing-message legal
  lifecycle operations from isAllowedMessageTransition. New object creation is
  outside this first prototype. No unread message content enters stage 1.
* Only continuable canonical threads, including their original source event IDs,
  with UPDATE/RESOLVE possible. Resolved, premature and incompatible threads remain
  unavailable. New thread opening is outside this first prototype.
* Up to twelve positive world records from the previous six hours. Recorded text
  and original IDs are copied, not rewritten or expanded. Their temporal label
  says HISTORICAL_NOT_ONGOING_OR_COPRESENCE. Visitor, private correspondence,
  expression and memory records are not admitted as world facts. Legacy timestamp
  strings are interpreted in Europe/London, never in the host's timezone; ambiguous
  or nonexistent DST times are excluded instead of guessed.
* Explicitly active routine/exercise/search episode records only. There is no
  scripted list of possible incidents. A completed search does not create a new
  confiscation or prove that its officer is still present.
* Production-compatible direct/heard/world-only observation constraints. These
  describe possible channels, not a claim that a sound or actor currently exists.
  This prototype does not support unexplained CY_LEARNS_LATER access.

Bounds are 15 actors, 8 objects, 8 threads, 12 recent facts, 300 characters per
selected occurrence/observation string and 24,000 bytes per packet. Object/thread
truncation counts are explicit. Overflow of the whole packet fails closed.

## Frozen-capture packet inspected before inference

The exact generated artifact is `affordance-packet.json` in the operator's explicit
local output directory. It is intentionally not copied into production or committed
with raw captures. Its byte SHA-256 in the first preparation is
`30793a1d33d8b1bbaab7f3b0cf1fc84eecfd836c35a915dfc29abae753d5787b`.

Capture request-file SHA-256:
`8b753c07aae5905c8c32a1510964c18c8e28f068ebcd69616ad5fadadba53845`.
Original request core SHA-256:
`b055a57ecd214bda9b229e219392bcb34d8fba8c6301c001cc159009c3debc50`.

| Packet component | Exact frozen-capture result |
| --- | --- |
| nowMs | 1791925108359 |
| Clock | 13 October 2026, 21:58:28 Europe/London |
| Current location / activity | CELL / cell / CELL_TIME |
| Entry source | env-2a834151-1b4b-4f71-9dae-c6e539b73d2c |
| Regime | Captured 21:58 'banged up for the night' current-state fact |
| Self | cy |
| Plausible, NOT confirmed present | root, reg, bill, mark, nick, fisher, ping, daemon, locke, keyes, bailey, proctor, sweep, trace |
| Usable objects | Empty; all nine retained objects are CONFISCATED |
| Continuable threads | Empty; all seven retained threads are RESOLVED |
| Explicit active interaction episodes | Empty |
| New object/thread creation | Unsupported by this prototype |
| Observation access | CY_DIRECT, CY_PARTIAL_HEARD, WORLD_ONLY, with participation constraints |
| Omitted usable objects / continuable threads | 0 / 0 |

All eleven retained recent-world records appear as historical positive context,
with the full original IDs and exact wording in the JSON:

| London time | Recorded content (summary here; JSON preserves exact wording) |
| --- | --- |
| 21:03:21.490 | no eggs |
| 21:08:16.925 | Sweep tells Locke which cells get cleared; Cy catches unspecified numbers |
| 21:11:17.216 | no eggs |
| 21:16:32.551 | Unidentified person screaming an indistinct word |
| 21:23:28.070 | Lockdown ended |
| 21:28:03.387 | Lockdown started |
| 21:32:28.702 | Laughter stops abruptly |
| 21:39:59.231 | Keyes demands an item before a search |
| 21:40:04.227 | Handover/search resolved |
| 21:47:19.797 | Sweep/Locke remark repeats |
| 21:56:10.483 | Lockdown ended |

The pipeline does not turn any of these into an automatically selected new event.
The generic handover's unnamed item does not become a usable object. The historic
Sweep remark does not establish a new removal, exact cell numbers or current
co-presence. This packet may legitimately produce NO_EVENT.

## Stage boundary

Stage 1 returns only `{decision:"NO_EVENT"}` or an OCCURRENCE containing actors,
one eventType/summary, optional typed target/operation, an observer/access/summary
and supporting packet refs. It has no eventFamily property. Target kinds identify
concrete entities, not event-family categories.

The checker reconstructs the packet and rejects tampering/stale state. Required
refs include current state, every actor, any target and the observation channel.
Unknown actors, missing refs, unavailable objects/threads, illegal holder/operation
combinations and incompatible observation access fail before stage 2 exists.
The unchanged production materialiser/validator also checks the selected sketch
for location contradictions, participant/identity mismatches, message knowledge,
privacy, continuity and pacing. An initial neutral WING_ACTIVITY encoding is used
internally for family-independent safety checks, not exposed as a stage-1 option;
this prevents a later RUMOUR label from bypassing location checks. Compatible
family encodings are then discovered downstream through the original validator.

Stage 2 uses the original frozen system, model, options and prompt/context prefix,
followed by the checked sketch. Existing production parsing/materialisation/
validation functions are imported unchanged. No result is applied. The raw stage-2
response is retained without stripping or repair. Any drift, including extra claims
or rewritten observation text, is rejected before production validation.

Mechanical validity is not proof of a worthwhile or true new occurrence. In
particular, the production roster says little about actual NPC whereabouts and
free-form stage-1 text can still be ungrounded. Human review must assess selection
specificity, causal support and knowledge claims. EXACT_SKETCH_BINDING certifies
that realisation did not change the selection, not that the selection was good.

## Offline commands

```bash
node --test scripts/rehearsal/grounded-occurrence.test.mjs
node scripts/rehearsal/prepare-grounded-occurrence.mjs \
  --capture C:/cy-rehearsal/leno-awg-capture-20261013 \
  --out C:/Users/jodyf/Documents/Codex/2026-09-03/som/awg-grounded-preparation-NEW
```

The output must be a new, explicitly chosen local directory outside the repository,
capture, model stores and runtime roots. Existing outputs are never overwritten.
No request is sent. To inspect synthetic/saved results offline, add `--selection`
and optionally `--proposal` paths. Invalid selections and NO_EVENT do not produce
a stage-2 request. No execution switch exists.

Artifacts include the exact packet, prepared request(s), verification hashes and
a trace with raw/parsed selection, source refs, precondition result, stage-2 raw/
parsed proposal, fidelity and original validation. Preparation/check durations are
measured separately; inference latencies remain null until supplied by a future
explicitly authorised measurement harness. Null is not zero latency.

Model, temperature, output/context limits and stops are copied from the capture.
This prototype has not tested behavioural quality or authorised a batch. Any future
inference still requires a separate operator instruction and the hardened isolated
LENO procedure. It must not be invoked from the live runner.

## Verification of this implementation

* 21 offline prototype tests pass, including strict stage separation, forbidden CLI
  inference options, source/actor/entity checks, canonical object/message/thread
  transitions, observation/location constraints, privacy and adversarial realiser
  drift in every mutable-looking field.
* All 479 existing runner tests pass. The first sandboxed run encountered temporary
  fixture atomic-rename EPERM errors; the identical offline suite passed outside the
  sandbox. No production fix or relaxation was made for those test-environment errors.
* The real capture's seven file checksums and current AWG fingerprint pass. Its
  production context is reconstructed exactly before preparing either stage.
* A synthetic, explicitly non-model conversation sketch using the real frozen
  packet passes the two-stage offline encoder and unchanged production validator.
  It produces VALIDATED_NOT_APPLIED and leaves the capture unchanged. This tests
  plumbing only, not natural model selection or quality.
* Syntax, manifest JSON and git whitespace checks pass. No runner runtime file was
  changed, and the production AWG module retains its captured SHA-256.
